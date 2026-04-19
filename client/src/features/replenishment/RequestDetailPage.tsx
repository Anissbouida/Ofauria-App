import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { ASSIGNED_ROLE_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import {
  ArrowLeft, Package, CheckCircle2, Clock, Truck,
  ClipboardCheck, AlertTriangle, XCircle, PackageCheck,
  Loader2, User, Calendar, Hash, ChefHat, Layers, ArrowRight,
} from 'lucide-react';

/* ─── Constants ─── */

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Envoyée',
  acknowledged: 'Prise en charge',
  partially_received: 'Réception partielle',
  preparing: 'En préparation',
  transferred: 'Transféré',
  partially_delivered: 'Partiellement livré',
  closed: 'Clôturé',
  closed_with_discrepancy: 'Clôturé (écart)',
  cancelled: 'Annulé',
};

const STATUS_GRADIENT: Record<string, string> = {
  submitted: 'from-yellow-500 to-amber-500',
  acknowledged: 'from-blue-500 to-blue-600',
  partially_received: 'from-teal-500 to-teal-600',
  preparing: 'from-indigo-500 to-indigo-600',
  transferred: 'from-purple-500 to-violet-500',
  partially_delivered: 'from-teal-500 to-teal-600',
  closed: 'from-emerald-500 to-green-500',
  closed_with_discrepancy: 'from-orange-500 to-orange-600',
  cancelled: 'from-gray-400 to-gray-500',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente',
};

const STEPPER_STEPS = [
  { key: 'submitted', label: 'Envoyée', icon: Package },
  { key: 'acknowledged', label: 'Prise en charge', icon: ClipboardCheck },
  { key: 'preparing', label: 'En préparation', icon: PackageCheck },
  { key: 'transferred', label: 'Transféré', icon: Truck },
  { key: 'closed', label: 'Clôturé', icon: CheckCircle2 },
];

function stepIndex(status: string): number {
  if (status === 'cancelled') return -1;
  if (status === 'closed_with_discrepancy') return 4;
  if (status === 'partially_delivered') return 1;
  const idx = STEPPER_STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

const ROLE_CONFIG: Record<string, { bg: string; text: string }> = {
  baker: { bg: 'bg-amber-100', text: 'text-amber-800' },
  pastry_chef: { bg: 'bg-pink-100', text: 'text-pink-800' },
  viennoiserie: { bg: 'bg-orange-100', text: 'text-orange-800' },
  beldi_sale: { bg: 'bg-green-100', text: 'text-green-800' },
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  stock: 'Depuis le stock',
  production: 'En production',
  mixed: 'Mixte',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  stock: 'bg-emerald-100 text-emerald-700',
  production: 'bg-blue-100 text-blue-700',
  mixed: 'bg-amber-100 text-amber-700',
};

/* ─── Component ─── */

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isAdmin = ['admin', 'manager'].includes(user?.role || '');
  const isResponsable = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');
  const isStoreStaff = ['admin', 'manager', 'cashier', 'saleswoman'].includes(user?.role || '');

  const [prepItems, setPrepItems] = useState<Record<string, { qtyToStore: number; qtyToStock: number; source: string }>>({});
  const [receptionItems, setReceptionItems] = useState<Record<string, { qtyReceived: number; notes: string }>>({});

  const { data: request, isLoading } = useQuery({
    queryKey: ['replenishment', id],
    queryFn: () => replenishmentApi.getById(id!),
    enabled: !!id,
  });

  /* ─── Mutations ─── */

  const acknowledgeMutation = useMutation({
    mutationFn: () => replenishmentApi.acknowledge(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      notify.success('Demande prise en charge');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la prise en charge')),
  });

  const prepareMutation = useMutation({
    mutationFn: (items: { itemId: string; qtyToStore: number; qtyToStock: number; source: string }[]) =>
      replenishmentApi.startPreparing(id!, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      notify.success('Préparation lancée');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la préparation')),
  });

  const transferMutation = useMutation({
    mutationFn: () => replenishmentApi.transfer(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      notify.success('Transfert validé');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors du transfert')),
  });

  const receptionMutation = useMutation({
    mutationFn: (items: { itemId: string; qtyReceived: number; notes?: string }[]) =>
      replenishmentApi.confirmReception(id!, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      if (data?.status === 'closed_with_discrepancy') {
        notify('Réception confirmée avec écart', { icon: '\u26a0\ufe0f' });
      } else {
        notify.success('Réception confirmée');
      }
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la réception')),
  });

  const cancelMutation = useMutation({
    mutationFn: () => replenishmentApi.cancel(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      notify.success('Demande annulée');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de l\'annulation')),
  });

  /* ─── Loading / not found ─── */

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
        <span className="text-gray-500 text-sm">Chargement...</span>
      </div>
    </div>
  );

  if (!request) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Package size={32} className="text-gray-400" />
      </div>
      <p className="text-gray-500">Demande non trouvée</p>
      <button onClick={() => navigate('/replenishment')} className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-1">
        <ArrowLeft size={16} /> Retour
      </button>
    </div>
  );

  return (
    <SubRequestDetailView
      request={request}
      navigate={navigate}
      user={user}
      isAdmin={isAdmin}
      isResponsable={isResponsable}
      isStoreStaff={isStoreStaff}
      acknowledgeMutation={acknowledgeMutation}
      prepareMutation={prepareMutation}
      transferMutation={transferMutation}
      receptionMutation={receptionMutation}
      cancelMutation={cancelMutation}
      prepItems={prepItems}
      setPrepItems={setPrepItems}
      receptionItems={receptionItems}
      setReceptionItems={setReceptionItems}
    />
  );
}

/* ═══════════════════════════════════════════════════════
   REQUEST DETAIL VIEW
   ═══════════════════════════════════════════════════════ */

function SubRequestDetailView({
  request, navigate, user, isAdmin, isResponsable, isStoreStaff,
  acknowledgeMutation, prepareMutation, transferMutation, receptionMutation, cancelMutation,
  prepItems, setPrepItems, receptionItems, setReceptionItems,
}: {
  request: Record<string, unknown>;
  navigate: ReturnType<typeof useNavigate>;
  user: Record<string, unknown> | null;
  isAdmin: boolean;
  isResponsable: boolean;
  isStoreStaff: boolean;
  acknowledgeMutation: { mutate: () => void; isPending: boolean };
  prepareMutation: { mutate: (items: { itemId: string; qtyToStore: number; qtyToStock: number; source: string }[]) => void; isPending: boolean };
  transferMutation: { mutate: () => void; isPending: boolean };
  receptionMutation: { mutate: (items: { itemId: string; qtyReceived: number; notes?: string }[]) => void; isPending: boolean };
  cancelMutation: { mutate: () => void; isPending: boolean };
  prepItems: Record<string, { qtyToStore: number; qtyToStock: number; source: string }>;
  setPrepItems: React.Dispatch<React.SetStateAction<Record<string, { qtyToStore: number; qtyToStock: number; source: string }>>>;
  receptionItems: Record<string, { qtyReceived: number; notes: string }>;
  setReceptionItems: React.Dispatch<React.SetStateAction<Record<string, { qtyReceived: number; notes: string }>>>;
}) {
  const items = (request.items || []) as Record<string, unknown>[];
  const displayStatus = (request.display_status as string) || (request.status as string);
  const currentStep = stepIndex(displayStatus);
  const status = request.status as string;
  const assignedRole = request.assigned_role as string;
  const productionPlans = (request.production_plans || []) as Record<string, unknown>[];

  const isMyRequest = !assignedRole || assignedRole === user?.role || isAdmin;

  const pendingItems = items.filter(i => i.status === 'pending');
  const receivedItems = items.filter(i => i.status === 'received' || i.status === 'received_with_discrepancy');
  const readyItems = items.filter(i => i.status === 'ready');

  const hasProductionItems = items.some(i => i.source_type === 'production' || i.source_type === 'mixed');
  const productionComplete = productionPlans.length === 0 || productionPlans.every(p => p.status === 'completed');

  const preparableItems = pendingItems.filter(i => {
    if (i.source_type === 'stock') return true;
    if (i.source_type === 'production' || i.source_type === 'mixed') {
      const prodItemStatus = i.production_item_status as string | null;
      const prodPlanStatus = i.production_status as string | null;
      const itemProduced = prodItemStatus === 'produced' || prodItemStatus === 'transferred' || prodItemStatus === 'received';
      const planCompleted = prodPlanStatus === 'completed';
      if (prodItemStatus === 'cancelled') return false;
      return itemProduced || planCompleted;
    }
    return true;
  });
  const hasPreparableItems = preparableItems.length > 0;
  const pendingProductionItems = pendingItems.filter(i => {
    if (i.source_type !== 'production' && i.source_type !== 'mixed') return false;
    const prodItemStatus = i.production_item_status as string | null;
    const itemProduced = prodItemStatus === 'produced' || prodItemStatus === 'transferred' || prodItemStatus === 'received';
    const itemCancelled = prodItemStatus === 'cancelled';
    return !itemProduced && !itemCancelled && i.production_status !== 'completed';
  });
  const isPartialTransfer = receivedItems.length > 0;

  const gradient = STATUS_GRADIENT[displayStatus] || STATUS_GRADIENT.submitted;
  const rc = ROLE_CONFIG[assignedRole];

  /* ─── Handlers ─── */

  const handleStartPreparing = () => {
    const itemsToSend = preparableItems.map((item) => {
      const itemId = item.id as string;
      const p = prepItems[itemId] || { qtyToStore: item.requested_quantity as number, qtyToStock: 0, source: 'stock' };
      return { itemId, qtyToStore: p.qtyToStore, qtyToStock: p.qtyToStock, source: p.source };
    });
    prepareMutation.mutate(itemsToSend);
  };

  const handleConfirmReception = () => {
    const itemsToConfirm = readyItems.map((item) => {
      const itemId = item.id as string;
      const r = receptionItems[itemId] || { qtyReceived: (item.qty_to_store as number) || 0, notes: '' };
      return { itemId, qtyReceived: r.qtyReceived, notes: r.notes || undefined };
    });
    receptionMutation.mutate(itemsToConfirm);
  };

  const getPrepValue = (itemId: string, field: 'qtyToStore' | 'qtyToStock' | 'source', defaultVal: unknown) => {
    return prepItems[itemId]?.[field] ?? defaultVal;
  };

  const setPrepValue = (itemId: string, field: string, value: unknown) => {
    setPrepItems(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { qtyToStore: 0, qtyToStock: 0, source: 'stock' }), [field]: value },
    }));
  };

  const getReceptionValue = (itemId: string, field: 'qtyReceived' | 'notes', defaultVal: unknown) => {
    return receptionItems[itemId]?.[field] ?? defaultVal;
  };

  const setReceptionValue = (itemId: string, field: string, value: unknown) => {
    setReceptionItems(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { qtyReceived: 0, notes: '' }), [field]: value },
    }));
  };

  /* ─── Render ─── */

  return (
    <div className="space-y-6">
      {/* ══════════════ HEADER CARD ══════════════ */}
      <div className={`bg-gradient-to-br ${gradient} rounded-2xl p-6 text-white shadow-lg relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white rounded-full" />
        </div>
        <div className="relative">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate('/replenishment')} className="p-2 hover:bg-white/20 rounded-xl transition-colors mt-0.5">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">
                  Demande #{request.request_number || (request.id as string).slice(0, 8).toUpperCase()}
                </h1>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-white/20 backdrop-blur-sm">
                  {STATUS_LABELS[displayStatus] || displayStatus}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/15">
                  {PRIORITY_LABELS[request.priority as string] || request.priority}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-white/80 text-sm flex-wrap">
                {request.requested_by_name && (
                  <span className="flex items-center gap-1.5">
                    <User size={14} /> {request.requested_by_name as string}
                  </span>
                )}
                {request.created_at && (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} /> {format(new Date(request.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr })}
                  </span>
                )}
                {rc && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20 flex items-center gap-1">
                    <ChefHat size={12} /> {ASSIGNED_ROLE_LABELS[assignedRole]}
                  </span>
                )}
                {isPartialTransfer && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/20">
                    {receivedItems.length}/{items.length} recu(s)
                  </span>
                )}
              </div>
            </div>

            {/* Cancel button */}
            {(isAdmin || isStoreStaff) && ['submitted', 'acknowledged', 'partially_received'].includes(status) && (
              <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}
                className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-sm font-medium flex items-center gap-2 transition-colors">
                <XCircle size={16} /> Annuler
              </button>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{items.length}</div>
              <div className="text-xs text-white/70">Articles</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{receivedItems.length}</div>
              <div className="text-xs text-white/70">Reçus</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{readyItems.length}</div>
              <div className="text-xs text-white/70">Prets</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold">{pendingItems.length}</div>
              <div className="text-xs text-white/70">En attente</div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════ STEPPER ══════════════ */}
      {status !== 'cancelled' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between">
            {STEPPER_STEPS.map((step, i) => {
              const isActive = i <= currentStep;
              const isCurrent = i === currentStep;
              const Icon = step.icon;
              return (
                <div key={step.key} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                      isCurrent ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md' :
                      isActive ? 'bg-indigo-600 text-white' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {isActive && i < currentStep ? <CheckCircle2 size={18} /> : <Icon size={18} />}
                    </div>
                    <span className={`mt-2 text-xs font-medium ${
                      isCurrent && displayStatus === 'partially_delivered' && step.key === 'acknowledged'
                        ? 'text-teal-700'
                        : isActive ? 'text-indigo-700' : 'text-gray-400'
                    }`}>
                      {isCurrent && displayStatus === 'partially_delivered' && step.key === 'acknowledged'
                        ? 'Partiellement livré'
                        : step.label}
                    </span>
                  </div>
                  {i < STEPPER_STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-2 rounded-full ${i < currentStep ? 'bg-indigo-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {status === 'cancelled' && (
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0">
            <XCircle size={22} className="text-gray-500" />
          </div>
          <div>
            <p className="font-semibold text-gray-700">Demande annulée</p>
            <p className="text-sm text-gray-500">Cette demande a été annulée et ne sera pas traitée.</p>
          </div>
        </div>
      )}

      {/* Production status banner */}
      {hasProductionItems && !['cancelled', 'closed', 'closed_with_discrepancy'].includes(status) && (
        <div className={`rounded-2xl p-4 flex items-center gap-4 ${
          productionComplete ? 'bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            productionComplete ? 'bg-emerald-100' : 'bg-blue-100'
          }`}>
            {productionComplete ? <CheckCircle2 size={20} className="text-emerald-600" /> : <Clock size={20} className="text-blue-600" />}
          </div>
          <div className="flex-1">
            <h4 className={`font-semibold text-sm ${productionComplete ? 'text-emerald-800' : 'text-blue-800'}`}>
              {productionComplete ? 'Production terminée' : 'Production en cours'}
            </h4>
            <p className={`text-xs mt-0.5 ${productionComplete ? 'text-emerald-600' : 'text-blue-600'}`}>
              {productionComplete
                ? 'Tous les articles ont été produits.'
                : pendingProductionItems.length > 0
                  ? `${pendingProductionItems.length} article(s) en attente de production — les articles en stock peuvent être transférés immédiatement`
                  : `${items.filter(i => i.source_type === 'production' || i.source_type === 'mixed').length} article(s) en production`
              }
            </p>
          </div>
          {productionPlans.length > 0 && (
            <button
              onClick={() => navigate(`/production/${productionPlans[0].id}`)}
              className="text-xs px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 flex-shrink-0 shadow-sm font-medium flex items-center gap-1"
            >
              Voir le plan <ArrowRight size={12} />
            </button>
          )}
        </div>
      )}

      {/* ══════════════ INFO CARDS ══════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <User size={16} className="text-indigo-600" />
            </div>
            <div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">Demandeur</div>
              <div className="text-sm font-medium text-gray-800">{request.requested_by_name as string || '\u2014'}</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Calendar size={16} className="text-blue-600" />
            </div>
            <div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">Date</div>
              <div className="text-sm font-medium text-gray-800">
                {request.created_at ? format(new Date(request.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr }) : '\u2014'}
              </div>
            </div>
          </div>
        </div>
        {request.acknowledged_by_name && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                <ClipboardCheck size={16} className="text-emerald-600" />
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Pris en charge par</div>
                <div className="text-sm font-medium text-gray-800">{request.acknowledged_by_name as string}</div>
              </div>
            </div>
          </div>
        )}
        {request.transferred_by_name && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                <Truck size={16} className="text-purple-600" />
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Transféré par</div>
                <div className="text-sm font-medium text-gray-800">{request.transferred_by_name as string}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════ ACTION PANELS BY STATUS ══════════════ */}

      {/* SUBMITTED: Responsable can acknowledge */}
      {status === 'submitted' && isResponsable && isMyRequest && (
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center mx-auto mb-4">
            <Clock size={28} className="text-white" />
          </div>
          <h3 className="font-bold text-yellow-800 text-lg mb-1">Nouvelle demande en attente</h3>
          <p className="text-sm text-yellow-700 mb-5">Prenez en charge cette demande pour commencer le traitement.</p>
          <button onClick={() => acknowledgeMutation.mutate()} disabled={acknowledgeMutation.isPending}
            className="px-8 py-3 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-base flex items-center gap-2 mx-auto">
            {acknowledgeMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <ClipboardCheck size={18} />}
            {acknowledgeMutation.isPending ? 'Prise en charge...' : 'Prendre en charge'}
          </button>
        </div>
      )}

      {status === 'submitted' && (!isResponsable || !isMyRequest) && (
        <div className="bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
            <Clock size={22} className="text-yellow-600" />
          </div>
          <div>
            <p className="font-semibold text-yellow-800">En attente de prise en charge</p>
            <p className="text-sm text-yellow-600">Le responsable n'a pas encore pris en charge cette demande.</p>
          </div>
        </div>
      )}

      {/* ACKNOWLEDGED: Responsable fills preparation form */}
      {(status === 'acknowledged' || status === 'partially_received') && isResponsable && isMyRequest && (
        <div className="bg-white rounded-2xl shadow-sm border border-blue-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                <PackageCheck size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-blue-800">Préparation des articles</h3>
                <p className="text-xs text-blue-600 mt-0.5">
                  {!hasPreparableItems
                    ? 'Aucun article prêt — en attente de production'
                    : pendingProductionItems.length > 0
                      ? `${preparableItems.length} article(s) pret(s) — ${pendingProductionItems.length} en attente de production`
                      : 'Renseignez les quantites a envoyer au magasin et a garder en stock'}
                </p>
              </div>
            </div>
            <button onClick={handleStartPreparing} disabled={prepareMutation.isPending || !hasPreparableItems}
              className={`px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm ${!hasPreparableItems ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {prepareMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
              {prepareMutation.isPending ? 'En cours...' : !hasPreparableItems ? 'En attente' : pendingProductionItems.length > 0 ? 'Préparer le lot disponible' : 'Commencer la préparation'}
            </button>
          </div>

          {receivedItems.length > 0 && (
            <div className="bg-emerald-50/50 px-6 py-2.5 border-b border-emerald-100 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <p className="text-xs text-emerald-700 font-medium">
                {receivedItems.length} article(s) deja recu(s) lors d'un transfert precedent
              </p>
            </div>
          )}

          <div className="divide-y divide-blue-50">
            {items.map((item) => {
              const itemId = item.id as string;
              const requestedQty = (item.requested_quantity as number) || 0;
              const itemStatus = item.status as string;
              const isReceived = itemStatus === 'received' || itemStatus === 'received_with_discrepancy';
              const isPreparable = preparableItems.some(pi => pi.id === item.id);
              const isWaitingProduction = pendingProductionItems.some(pi => pi.id === item.id);
              return (
                <div key={itemId} className={`px-6 py-3.5 flex items-center gap-4 ${isReceived ? 'bg-emerald-50/30 opacity-60' : isWaitingProduction ? 'bg-amber-50/30 opacity-60' : 'hover:bg-blue-50/30'} transition-colors`}>
                  {/* Left bar */}
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${isReceived ? 'bg-emerald-500' : isWaitingProduction ? 'bg-amber-400' : 'bg-blue-500'}`} />
                  {/* Product */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                    <div className="text-xs text-gray-400">{item.category_name as string}</div>
                  </div>
                  {/* Source type */}
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium flex-shrink-0 ${SOURCE_TYPE_COLORS[item.source_type as string] || ''}`}>
                    {SOURCE_TYPE_LABELS[item.source_type as string] || '\u2014'}
                  </span>
                  {/* Status */}
                  {isReceived ? (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 flex-shrink-0">Deja recu</span>
                  ) : isWaitingProduction ? (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 flex-shrink-0">En production</span>
                  ) : (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 flex-shrink-0">Pret</span>
                  )}
                  {/* Requested qty */}
                  <div className="text-center flex-shrink-0 w-14">
                    <div className="text-[10px] text-gray-400 uppercase">Demande</div>
                    <div className="text-sm font-bold text-gray-800">{requestedQty}</div>
                  </div>
                  {/* Inputs */}
                  {isPreparable ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select value={getPrepValue(itemId, 'source', item.source_type === 'production' ? 'production' : 'stock') as string}
                        onChange={(e) => setPrepValue(itemId, 'source', e.target.value)}
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-24">
                        <option value="stock">Stock</option>
                        <option value="production">Production</option>
                      </select>
                      <div className="text-center">
                        <div className="text-[10px] text-gray-400">Magasin</div>
                        <input type="number" min={0} value={getPrepValue(itemId, 'qtyToStore', requestedQty) as number}
                          onChange={(e) => setPrepValue(itemId, 'qtyToStore', parseInt(e.target.value) || 0)}
                          className="w-16 text-center py-1.5 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-gray-400">Stock</div>
                        <input type="number" min={0} value={getPrepValue(itemId, 'qtyToStock', 0) as number}
                          onChange={(e) => setPrepValue(itemId, 'qtyToStock', parseInt(e.target.value) || 0)}
                          className="w-16 text-center py-1.5 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-48 flex-shrink-0 text-xs text-gray-400 text-center">
                      {isReceived ? `Magasin: ${item.qty_to_store || '\u2014'} | Reçu: ${item.qty_received || '\u2014'}` : '\u2014'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(status === 'acknowledged' || status === 'partially_received') && (!isResponsable || !isMyRequest) && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck size={22} className="text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-blue-800">Demande prise en charge</p>
            <p className="text-sm text-blue-600">Le responsable prepare votre commande.</p>
          </div>
        </div>
      )}

      {/* PREPARING: Responsable can validate transfer */}
      {status === 'preparing' && isResponsable && isMyRequest && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mx-auto mb-4">
            <Truck size={28} className="text-white" />
          </div>
          <h3 className="font-bold text-indigo-800 text-lg mb-1">Préparation en cours</h3>
          <p className="text-sm text-indigo-600 mb-5">Une fois les articles prets, validez le transfert vers le magasin.</p>
          <button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending}
            className="px-8 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-base flex items-center gap-2 mx-auto">
            {transferMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Truck size={18} />}
            {transferMutation.isPending ? 'Transfert en cours...' : 'Valider le transfert'}
          </button>
        </div>
      )}

      {status === 'preparing' && (!isResponsable || !isMyRequest) && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <PackageCheck size={22} className="text-indigo-600" />
          </div>
          <div>
            <p className="font-semibold text-indigo-800">En préparation</p>
            <p className="text-sm text-indigo-600">Vos articles sont en cours de préparation.</p>
          </div>
        </div>
      )}

      {/* TRANSFERRED: Cashier confirms reception */}
      {status === 'transferred' && isStoreStaff && (
        <div className="bg-white rounded-2xl shadow-sm border border-purple-200 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-50 to-violet-50 px-6 py-4 border-b border-purple-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
                <Truck size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-purple-800">Confirmation de réception</h3>
                <p className="text-xs text-purple-600 mt-0.5">
                  {pendingItems.length > 0
                    ? `Transfert partiel — ${readyItems.length} article(s) a confirmer, ${pendingItems.length} en attente`
                    : 'Vérifiez les quantités reçues article par article'}
                </p>
              </div>
            </div>
            <button onClick={handleConfirmReception} disabled={receptionMutation.isPending}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-violet-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
              {receptionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {receptionMutation.isPending ? 'Confirmation...' : 'Confirmer la réception'}
            </button>
          </div>
          <div className="divide-y divide-purple-50">
            {readyItems.map((item) => {
              const itemId = item.id as string;
              const expected = (item.qty_to_store as number) || 0;
              const received = (getReceptionValue(itemId, 'qtyReceived', expected) as number);
              const diff = received - expected;
              return (
                <div key={itemId} className={`px-6 py-4 flex items-center gap-4 ${diff !== 0 ? 'bg-red-50/30' : 'hover:bg-purple-50/30'} transition-colors`}>
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${diff === 0 ? 'bg-purple-500' : 'bg-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                    <div className="text-xs text-gray-400">{item.category_name as string}</div>
                  </div>
                  <div className="text-center flex-shrink-0 w-16">
                    <div className="text-[10px] text-gray-400 uppercase">Attendu</div>
                    <div className="text-sm font-bold text-gray-700">{expected}</div>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <div className="text-[10px] text-gray-400 uppercase">Reçu</div>
                    <input type="number" min={0} value={received}
                      onChange={(e) => setReceptionValue(itemId, 'qtyReceived', parseInt(e.target.value) || 0)}
                      className={`w-16 text-center py-1.5 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 ${diff !== 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                  </div>
                  <div className="text-center flex-shrink-0 w-12">
                    <div className="text-[10px] text-gray-400 uppercase">Ecart</div>
                    {diff === 0 ? <CheckCircle2 size={18} className="mx-auto text-emerald-500 mt-1" /> :
                      <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>{diff > 0 ? '+' : ''}{diff}</span>}
                  </div>
                  <input type="text" placeholder="Note..." value={(getReceptionValue(itemId, 'notes', '') as string)}
                    onChange={(e) => setReceptionValue(itemId, 'notes', e.target.value)}
                    className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 flex-shrink-0" />
                </div>
              );
            })}
          </div>
          {pendingItems.length > 0 && (
            <div className="bg-amber-50 px-6 py-3 border-t border-amber-200 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              <p className="text-xs text-amber-700">
                {pendingItems.length} article(s) en attente de production — un autre transfert sera necessaire apres la production.
              </p>
            </div>
          )}
        </div>
      )}

      {status === 'transferred' && !isStoreStaff && (
        <div className="bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
            <Truck size={22} className="text-purple-600" />
          </div>
          <div>
            <p className="font-semibold text-purple-800">Transféré — en attente de réception</p>
            <p className="text-sm text-purple-600">La caissière doit confirmer la réception des articles.</p>
          </div>
        </div>
      )}

      {/* CLOSED: Summary */}
      {(status === 'closed' || status === 'closed_with_discrepancy') && (
        <div className={`rounded-2xl overflow-hidden ${status === 'closed_with_discrepancy' ? 'border border-orange-200' : 'border border-emerald-200'}`}>
          <div className={`px-6 py-4 flex items-center gap-4 ${status === 'closed_with_discrepancy' ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-200' : 'bg-gradient-to-r from-emerald-50 to-green-50 border-b border-emerald-200'}`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${status === 'closed_with_discrepancy' ? 'bg-orange-100' : 'bg-emerald-100'}`}>
              {status === 'closed_with_discrepancy' ? <AlertTriangle size={22} className="text-orange-600" /> : <CheckCircle2 size={22} className="text-emerald-600" />}
            </div>
            <div>
              <h3 className={`font-bold ${status === 'closed_with_discrepancy' ? 'text-orange-800' : 'text-emerald-800'}`}>
                {status === 'closed_with_discrepancy' ? 'Clôturé avec écart' : 'Clôturé — tout est conforme'}
              </h3>
              {request.closed_by_name && (
                <p className={`text-xs mt-0.5 ${status === 'closed_with_discrepancy' ? 'text-orange-600' : 'text-emerald-600'}`}>
                  Confirmé par {request.closed_by_name as string} le {request.closed_at ? format(new Date(request.closed_at as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ ITEMS TABLE (always visible) ══════════════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center">
            <Layers size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">Articles</h3>
            <span className="text-xs text-gray-500">{items.length} article(s)</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {items.map((item) => {
            const qtyToStore = (item.qty_to_store as number) || 0;
            const qtyReceived = item.qty_received as number;
            const diff = qtyReceived !== null && qtyReceived !== undefined ? qtyReceived - qtyToStore : null;
            const hasDiff = diff !== null && diff !== 0;
            const isClosed = ['closed', 'closed_with_discrepancy'].includes(status);
            const showPrepDetails = ['preparing', 'transferred', 'closed', 'closed_with_discrepancy'].includes(status);

            return (
              <div key={item.id as string} className={`px-6 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors ${hasDiff ? 'bg-red-50/20' : ''}`}>
                {/* Left bar */}
                <div className={`w-1 h-10 rounded-full flex-shrink-0 ${hasDiff ? 'bg-red-400' : isClosed ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                {/* Product */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                  <div className="text-xs text-gray-400">{item.category_name as string}</div>
                </div>
                {/* Source type */}
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium flex-shrink-0 ${SOURCE_TYPE_COLORS[item.source_type as string] || 'bg-gray-100 text-gray-500'}`}>
                  {SOURCE_TYPE_LABELS[item.source_type as string] || '\u2014'}
                </span>
                {item.source_type === 'mixed' && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {(item.qty_from_stock as number) || 0}s + {(item.qty_to_produce as number) || 0}p
                  </span>
                )}
                {/* Demanded */}
                <div className="text-center flex-shrink-0 w-14">
                  <div className="text-[10px] text-gray-400 uppercase">Demande</div>
                  <div className="text-sm font-bold text-gray-700">{(item.requested_quantity as number) || 0}</div>
                </div>
                {/* Prep details */}
                {showPrepDetails && (
                  <>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400 uppercase">Source</div>
                      <div className="text-xs text-gray-500">{(item.source as string) === 'production' ? 'Prod.' : 'Stock'}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400 uppercase">Magasin</div>
                      <div className="text-sm font-semibold text-indigo-700">{qtyToStore}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400 uppercase">Stock</div>
                      <div className="text-sm text-gray-500">{(item.qty_to_stock as number) || 0}</div>
                    </div>
                  </>
                )}
                {/* Reception details */}
                {isClosed && (
                  <>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400 uppercase">Reçu</div>
                      <div className="text-sm font-semibold">{qtyReceived ?? '\u2014'}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-12">
                      <div className="text-[10px] text-gray-400 uppercase">Ecart</div>
                      {diff === null ? <span className="text-gray-300">\u2014</span> : diff === 0 ? (
                        <CheckCircle2 size={16} className="mx-auto text-emerald-500 mt-1" />
                      ) : (
                        <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
