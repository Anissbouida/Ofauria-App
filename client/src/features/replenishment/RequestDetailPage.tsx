import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { ASSIGNED_ROLE_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Package, CheckCircle2, Clock, Truck,
  ClipboardCheck, AlertTriangle, XCircle, PackageCheck,
} from 'lucide-react';

/* ─── Constants ─── */

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Envoyee',
  acknowledged: 'Prise en charge',
  preparing: 'En preparation',
  transferred: 'Transfere',
  partially_delivered: 'Partiellement livre',
  closed: 'Cloture',
  closed_with_discrepancy: 'Cloture (ecart)',
  cancelled: 'Annule',
};

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-yellow-100 text-yellow-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  preparing: 'bg-indigo-100 text-indigo-700',
  transferred: 'bg-purple-100 text-purple-700',
  partially_delivered: 'bg-teal-100 text-teal-700',
  closed: 'bg-green-100 text-green-700',
  closed_with_discrepancy: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-50 text-blue-600', normal: 'bg-gray-50 text-gray-600',
  high: 'bg-orange-50 text-orange-600', urgent: 'bg-red-100 text-red-700',
};

const STEPPER_STEPS = [
  { key: 'submitted', label: 'Envoyee', icon: Package },
  { key: 'acknowledged', label: 'Prise en charge', icon: ClipboardCheck },
  { key: 'preparing', label: 'En preparation', icon: PackageCheck },
  { key: 'transferred', label: 'Transfere', icon: Truck },
  { key: 'closed', label: 'Cloture', icon: CheckCircle2 },
];

function stepIndex(status: string): number {
  if (status === 'cancelled') return -1;
  if (status === 'closed_with_discrepancy') return 4;
  if (status === 'partially_delivered') return 1; // Shows at "acknowledged" step with special label
  const idx = STEPPER_STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

const ROLE_COLORS: Record<string, string> = {
  baker: 'bg-amber-50 border-amber-200 text-amber-800',
  pastry_chef: 'bg-pink-50 border-pink-200 text-pink-800',
  viennoiserie: 'bg-orange-50 border-orange-200 text-orange-800',
  beldi_sale: 'bg-green-50 border-green-200 text-green-800',
  general: 'bg-gray-50 border-gray-200 text-gray-800',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  stock: 'Depuis le stock',
  production: 'En production',
  mixed: 'Mixte',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  stock: 'bg-green-100 text-green-700',
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

  // Preparation form state
  const [prepItems, setPrepItems] = useState<Record<string, { qtyToStore: number; qtyToStock: number; source: string }>>({});
  // Reception form state
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
      toast.success('Demande prise en charge');
    },
    onError: () => toast.error('Erreur'),
  });

  const prepareMutation = useMutation({
    mutationFn: (items: { itemId: string; qtyToStore: number; qtyToStock: number; source: string }[]) =>
      replenishmentApi.startPreparing(id!, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      toast.success('Preparation lancee');
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      const msg = err?.response?.data?.error?.message || 'Erreur';
      toast.error(msg);
    },
  });

  const transferMutation = useMutation({
    mutationFn: () => replenishmentApi.transfer(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      toast.success('Transfert valide');
    },
    onError: () => toast.error('Erreur'),
  });

  const receptionMutation = useMutation({
    mutationFn: (items: { itemId: string; qtyReceived: number; notes?: string }[]) =>
      replenishmentApi.confirmReception(id!, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      if (data?.status === 'closed_with_discrepancy') {
        toast('Reception confirmee avec ecart', { icon: '⚠️' });
      } else {
        toast.success('Reception confirmee');
      }
    },
    onError: () => toast.error('Erreur'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => replenishmentApi.cancel(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment', id] });
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      toast.success('Demande annulee');
    },
    onError: () => toast.error('Erreur'),
  });

  /* ─── Loading / not found ─── */

  if (isLoading) return <p className="text-gray-500 p-6">Chargement...</p>;
  if (!request) return <p className="text-gray-500 p-6">Demande non trouvee</p>;

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

  // Check if current chef can act on this request
  const isMyRequest = !assignedRole || assignedRole === user?.role || isAdmin;

  // Item-level classification
  const pendingItems = items.filter(i => i.status === 'pending');
  const receivedItems = items.filter(i => i.status === 'received' || i.status === 'received_with_discrepancy');
  const readyItems = items.filter(i => i.status === 'ready');

  // Production status helpers
  const hasProductionItems = items.some(i => i.source_type === 'production' || i.source_type === 'mixed');
  const productionComplete = productionPlans.length === 0 || productionPlans.every(p => p.status === 'completed');

  // Items eligible for preparation: pending items whose production item is produced/completed (or from stock)
  const preparableItems = pendingItems.filter(i => {
    if (i.source_type === 'stock') return true;
    if (i.source_type === 'production' || i.source_type === 'mixed') {
      // Check item-level production status first (partial production), fallback to plan status
      const prodItemStatus = i.production_item_status as string | null;
      const prodPlanStatus = i.production_status as string | null;
      const itemProduced = prodItemStatus === 'produced' || prodItemStatus === 'transferred' || prodItemStatus === 'received';
      const planCompleted = prodPlanStatus === 'completed';
      // If production item is cancelled, item can't be prepared
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

  /* ─── Handlers ─── */

  const handleStartPreparing = () => {
    // Only prepare items that are preparable (pending + production done or from stock)
    const itemsToSend = preparableItems.map((item) => {
      const itemId = item.id as string;
      const p = prepItems[itemId] || { qtyToStore: item.requested_quantity as number, qtyToStock: 0, source: 'stock' };
      return { itemId, qtyToStore: p.qtyToStore, qtyToStock: p.qtyToStock, source: p.source };
    });
    prepareMutation.mutate(itemsToSend);
  };

  const handleConfirmReception = () => {
    // Only confirm items that are ready (transferred)
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
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/replenishment')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-bakery-chocolate">
              Demande #{request.request_number || (request.id as string).slice(0, 8).toUpperCase()}
            </h1>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[displayStatus] || STATUS_COLORS.submitted}`}>
              {STATUS_LABELS[displayStatus] || displayStatus}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[request.priority as string] || PRIORITY_COLORS.normal}`}>
              {PRIORITY_LABELS[request.priority as string] || request.priority}
            </span>
            {assignedRole && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                ROLE_COLORS[assignedRole]?.replace('border-', 'bg-').split(' ').filter(c => c.startsWith('bg-') || c.startsWith('text-')).join(' ') || 'bg-gray-100 text-gray-600'
              }`}>
                {ASSIGNED_ROLE_LABELS[assignedRole]}
              </span>
            )}
            {isPartialTransfer && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                {receivedItems.length}/{items.length} recu(s)
              </span>
            )}
          </div>
        </div>

        {/* Cancel button */}
        {(isAdmin || isStoreStaff) && ['submitted', 'acknowledged'].includes(status) && (
          <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 flex items-center gap-2">
            <XCircle size={16} /> Annuler
          </button>
        )}
      </div>

      {/* Stepper */}
      {status !== 'cancelled' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            {STEPPER_STEPS.map((step, i) => {
              const isActive = i <= currentStep;
              const isCurrent = i === currentStep;
              const Icon = step.icon;
              return (
                <div key={step.key} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isCurrent ? 'bg-primary-600 text-white ring-4 ring-primary-100' :
                      isActive ? 'bg-primary-600 text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isActive && i < currentStep ? <CheckCircle2 size={18} /> : <Icon size={18} />}
                    </div>
                    <span className={`mt-1.5 text-xs font-medium ${
                      isCurrent && displayStatus === 'partially_delivered' && step.key === 'acknowledged'
                        ? 'text-teal-700'
                        : isActive ? 'text-primary-700' : 'text-gray-400'
                    }`}>
                      {isCurrent && displayStatus === 'partially_delivered' && step.key === 'acknowledged'
                        ? 'Partiellement livre'
                        : step.label}
                    </span>
                  </div>
                  {i < STEPPER_STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 ${i < currentStep ? 'bg-primary-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {status === 'cancelled' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-center gap-3">
          <XCircle size={24} className="text-gray-400" />
          <div>
            <p className="font-semibold text-gray-700">Demande annulee</p>
            <p className="text-sm text-gray-500">Cette demande a ete annulee et ne sera pas traitee.</p>
          </div>
        </div>
      )}

      {/* Production status banner */}
      {hasProductionItems && !['cancelled', 'closed', 'closed_with_discrepancy'].includes(status) && (
        <div className={`border rounded-xl p-4 flex items-center gap-3 ${
          productionComplete ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'
        }`}>
          {productionComplete ? (
            <CheckCircle2 size={20} className="text-green-600 flex-shrink-0" />
          ) : (
            <Clock size={20} className="text-blue-600 flex-shrink-0" />
          )}
          <div className="flex-1">
            <h4 className={`font-semibold text-sm ${productionComplete ? 'text-green-800' : 'text-blue-800'}`}>
              {productionComplete ? 'Production terminee' : 'Production en cours'}
            </h4>
            <p className={`text-xs mt-0.5 ${productionComplete ? 'text-green-600' : 'text-blue-600'}`}>
              {productionComplete
                ? 'Tous les articles ont ete produits.'
                : pendingProductionItems.length > 0
                  ? `${pendingProductionItems.length} article(s) en attente de production — les articles en stock peuvent etre transferes immediatement`
                  : `${items.filter(i => i.source_type === 'production' || i.source_type === 'mixed').length} article(s) en production`
              }
            </p>
          </div>
          {productionPlans.length > 0 && (
            <button
              onClick={() => navigate(`/production/${productionPlans[0].id}`)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 flex-shrink-0"
            >
              Voir le plan
            </button>
          )}
        </div>
      )}

      {/* Info section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs uppercase tracking-wide">Demandeur</span>
            <p className="font-medium text-gray-800 mt-0.5">{request.requested_by_name as string || '—'}</p>
          </div>
          <div>
            <span className="text-gray-400 text-xs uppercase tracking-wide">Date</span>
            <p className="font-medium text-gray-800 mt-0.5">
              {request.created_at
                ? format(new Date(request.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr })
                : '—'}
            </p>
          </div>
          {request.acknowledged_by_name && (
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Pris en charge par</span>
              <p className="font-medium text-gray-800 mt-0.5">{request.acknowledged_by_name as string}</p>
            </div>
          )}
          {request.transferred_by_name && (
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-wide">Transfere par</span>
              <p className="font-medium text-gray-800 mt-0.5">{request.transferred_by_name as string}</p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ ACTION PANELS BY STATUS ═══ */}

      {/* SUBMITTED: Responsable can acknowledge */}
      {status === 'submitted' && isResponsable && isMyRequest && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
          <Clock size={32} className="mx-auto text-yellow-600 mb-3" />
          <h3 className="font-bold text-yellow-800 text-lg mb-1">Nouvelle demande en attente</h3>
          <p className="text-sm text-yellow-700 mb-4">Prenez en charge cette demande pour commencer le traitement.</p>
          <button onClick={() => acknowledgeMutation.mutate()} disabled={acknowledgeMutation.isPending}
            className="btn-primary px-8 py-3 text-base">
            {acknowledgeMutation.isPending ? 'Prise en charge...' : 'Prendre en charge'}
          </button>
        </div>
      )}

      {status === 'submitted' && (!isResponsable || !isMyRequest) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 flex items-center gap-3">
          <Clock size={24} className="text-yellow-600" />
          <div>
            <p className="font-semibold text-yellow-800">En attente de prise en charge</p>
            <p className="text-sm text-yellow-600">Le responsable n'a pas encore pris en charge cette demande.</p>
          </div>
        </div>
      )}

      {/* ACKNOWLEDGED: Responsable fills preparation form */}
      {status === 'acknowledged' && isResponsable && isMyRequest && (
        <div className="bg-white rounded-xl shadow-sm border border-blue-200 overflow-hidden">
          <div className="bg-blue-50 px-6 py-4 border-b border-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PackageCheck size={20} className="text-blue-600" />
              <div>
                <h3 className="font-bold text-blue-800">Preparation des articles</h3>
                <p className="text-xs text-blue-600 mt-0.5">
                  {!hasPreparableItems
                    ? 'Aucun article pret — en attente de production'
                    : pendingProductionItems.length > 0
                      ? `${preparableItems.length} article(s) pret(s) — ${pendingProductionItems.length} en attente de production (transfert partiel possible)`
                      : 'Renseignez les quantites a envoyer au magasin et a garder en stock'}
                </p>
              </div>
            </div>
            <button onClick={handleStartPreparing} disabled={prepareMutation.isPending || !hasPreparableItems}
              className={`btn-primary flex items-center gap-2 ${!hasPreparableItems ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <PackageCheck size={16} />
              {prepareMutation.isPending ? 'En cours...' : !hasPreparableItems ? 'En attente de production' : pendingProductionItems.length > 0 ? 'Preparer le lot disponible' : 'Commencer la preparation'}
            </button>
          </div>

          {/* Already received items (from previous partial transfers) */}
          {receivedItems.length > 0 && (
            <div className="bg-green-50/50 px-6 py-2 border-b border-green-100">
              <p className="text-xs text-green-700 font-medium">
                {receivedItems.length} article(s) deja recu(s) lors d'un transfert precedent
              </p>
            </div>
          )}

          <table className="w-full">
            <thead className="bg-blue-50/50 border-b border-blue-100">
              <tr>
                <th className="text-left px-6 py-2.5 text-xs font-medium text-blue-700 uppercase">Produit</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Origine</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Statut</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Demande</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Source</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Vers magasin</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-blue-700 uppercase">Vers stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-50">
              {items.map((item) => {
                const itemId = item.id as string;
                const requestedQty = (item.requested_quantity as number) || 0;
                const itemStatus = item.status as string;
                const isReceived = itemStatus === 'received' || itemStatus === 'received_with_discrepancy';
                const isPreparable = preparableItems.some(pi => pi.id === item.id);
                const isWaitingProduction = pendingProductionItems.some(pi => pi.id === item.id);
                return (
                  <tr key={itemId} className={`${isReceived ? 'bg-green-50/30 opacity-60' : isWaitingProduction ? 'bg-amber-50/30 opacity-60' : 'hover:bg-blue-50/30'}`}>
                    <td className="px-6 py-3">
                      <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                      <div className="text-xs text-gray-400">{item.category_name as string}</div>
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SOURCE_TYPE_COLORS[item.source_type as string] || ''}`}>
                        {SOURCE_TYPE_LABELS[item.source_type as string] || '—'}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3">
                      {isReceived ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Deja recu</span>
                      ) : isWaitingProduction ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">En production</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">Pret</span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3 text-sm font-bold text-gray-800">{requestedQty}</td>
                    {isPreparable ? (
                      <>
                        <td className="text-center px-4 py-3">
                          <select value={getPrepValue(itemId, 'source', item.source_type === 'production' ? 'production' : 'stock') as string}
                            onChange={(e) => setPrepValue(itemId, 'source', e.target.value)} className="input text-sm py-1.5 w-28">
                            <option value="stock">Stock</option>
                            <option value="production">Production</option>
                          </select>
                        </td>
                        <td className="text-center px-4 py-3">
                          <input type="number" min={0} value={getPrepValue(itemId, 'qtyToStore', requestedQty) as number}
                            onChange={(e) => setPrepValue(itemId, 'qtyToStore', parseInt(e.target.value) || 0)}
                            className="input text-sm py-1.5 w-20 text-center" />
                        </td>
                        <td className="text-center px-4 py-3">
                          <input type="number" min={0} value={getPrepValue(itemId, 'qtyToStock', 0) as number}
                            onChange={(e) => setPrepValue(itemId, 'qtyToStock', parseInt(e.target.value) || 0)}
                            className="input text-sm py-1.5 w-20 text-center" />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-center px-4 py-3 text-xs text-gray-400">—</td>
                        <td className="text-center px-4 py-3 text-xs text-gray-400">{isReceived ? (item.qty_to_store as number || '—') : '—'}</td>
                        <td className="text-center px-4 py-3 text-xs text-gray-400">{isReceived ? (item.qty_received as number || '—') : '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {status === 'acknowledged' && (!isResponsable || !isMyRequest) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center gap-3">
          <ClipboardCheck size={24} className="text-blue-600" />
          <div>
            <p className="font-semibold text-blue-800">Demande prise en charge</p>
            <p className="text-sm text-blue-600">Le responsable prepare votre commande.</p>
          </div>
        </div>
      )}

      {/* PREPARING: Responsable can validate transfer */}
      {status === 'preparing' && isResponsable && isMyRequest && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 text-center">
          <Truck size={32} className="mx-auto text-indigo-600 mb-3" />
          <h3 className="font-bold text-indigo-800 text-lg mb-1">Preparation en cours</h3>
          <p className="text-sm text-indigo-600 mb-4">Une fois les articles prets, validez le transfert vers le magasin.</p>
          <button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending}
            className="btn-primary px-8 py-3 text-base bg-indigo-600 hover:bg-indigo-700">
            {transferMutation.isPending ? 'Transfert en cours...' : 'Valider le transfert'}
          </button>
        </div>
      )}

      {status === 'preparing' && (!isResponsable || !isMyRequest) && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 flex items-center gap-3">
          <PackageCheck size={24} className="text-indigo-600" />
          <div>
            <p className="font-semibold text-indigo-800">En preparation</p>
            <p className="text-sm text-indigo-600">Vos articles sont en cours de preparation.</p>
          </div>
        </div>
      )}

      {/* TRANSFERRED: Cashier confirms reception */}
      {status === 'transferred' && isStoreStaff && (
        <div className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
          <div className="bg-purple-50 px-6 py-4 border-b border-purple-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck size={20} className="text-purple-600" />
              <div>
                <h3 className="font-bold text-purple-800">Confirmation de reception</h3>
                <p className="text-xs text-purple-600 mt-0.5">
                  {pendingItems.length > 0
                    ? `Transfert partiel — ${readyItems.length} article(s) a confirmer, ${pendingItems.length} en attente`
                    : 'Verifiez les quantites recues article par article'}
                </p>
              </div>
            </div>
            <button onClick={handleConfirmReception} disabled={receptionMutation.isPending}
              className="btn-primary flex items-center gap-2 bg-purple-600 hover:bg-purple-700">
              <CheckCircle2 size={16} />
              {receptionMutation.isPending ? 'Confirmation...' : 'Confirmer la reception'}
            </button>
          </div>
          <table className="w-full">
            <thead className="bg-purple-50/50 border-b border-purple-100">
              <tr>
                <th className="text-left px-6 py-2.5 text-xs font-medium text-purple-700 uppercase">Produit</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-purple-700 uppercase">Attendu</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-purple-700 uppercase">Recu</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-purple-700 uppercase">Ecart</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-purple-700 uppercase">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-50">
              {readyItems.map((item) => {
                const itemId = item.id as string;
                const expected = (item.qty_to_store as number) || 0;
                const received = (getReceptionValue(itemId, 'qtyReceived', expected) as number);
                const diff = received - expected;
                return (
                  <tr key={itemId} className={diff !== 0 ? 'bg-red-50/30' : 'hover:bg-purple-50/30'}>
                    <td className="px-6 py-3">
                      <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                      <div className="text-xs text-gray-400">{item.category_name as string}</div>
                    </td>
                    <td className="text-center px-4 py-3 text-sm font-semibold text-gray-700">{expected}</td>
                    <td className="text-center px-4 py-3">
                      <input type="number" min={0} value={received}
                        onChange={(e) => setReceptionValue(itemId, 'qtyReceived', parseInt(e.target.value) || 0)}
                        className={`input text-sm py-1.5 w-20 text-center ${diff !== 0 ? 'border-red-300 bg-red-50' : ''}`} />
                    </td>
                    <td className="text-center px-4 py-3">
                      {diff === 0 ? <CheckCircle2 size={18} className="mx-auto text-green-500" /> :
                        <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>{diff > 0 ? '+' : ''}{diff}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <input type="text" placeholder="Note..." value={(getReceptionValue(itemId, 'notes', '') as string)}
                        onChange={(e) => setReceptionValue(itemId, 'notes', e.target.value)} className="input text-sm py-1.5 w-full" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pendingItems.length > 0 && (
            <div className="bg-amber-50 px-6 py-3 border-t border-amber-200">
              <p className="text-xs text-amber-700">
                <AlertTriangle size={12} className="inline mr-1" />
                {pendingItems.length} article(s) en attente de production — un autre transfert sera necessaire apres la production.
              </p>
            </div>
          )}
        </div>
      )}

      {status === 'transferred' && !isStoreStaff && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 flex items-center gap-3">
          <Truck size={24} className="text-purple-600" />
          <div>
            <p className="font-semibold text-purple-800">Transfere — en attente de reception</p>
            <p className="text-sm text-purple-600">La caissiere doit confirmer la reception des articles.</p>
          </div>
        </div>
      )}

      {/* CLOSED: Summary */}
      {(status === 'closed' || status === 'closed_with_discrepancy') && (
        <div className={`border rounded-xl overflow-hidden ${status === 'closed_with_discrepancy' ? 'border-orange-200' : 'border-green-200'}`}>
          <div className={`px-6 py-4 flex items-center gap-3 ${status === 'closed_with_discrepancy' ? 'bg-orange-50 border-b border-orange-200' : 'bg-green-50 border-b border-green-200'}`}>
            {status === 'closed_with_discrepancy' ? <AlertTriangle size={20} className="text-orange-600" /> : <CheckCircle2 size={20} className="text-green-600" />}
            <div>
              <h3 className={`font-bold ${status === 'closed_with_discrepancy' ? 'text-orange-800' : 'text-green-800'}`}>
                {status === 'closed_with_discrepancy' ? 'Cloture avec ecart' : 'Cloture — tout est conforme'}
              </h3>
              {request.closed_by_name && (
                <p className={`text-xs mt-0.5 ${status === 'closed_with_discrepancy' ? 'text-orange-600' : 'text-green-600'}`}>
                  Confirme par {request.closed_by_name as string} le {request.closed_at ? format(new Date(request.closed_at as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Items table (always visible) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Package size={18} className="text-gray-500" />
          <h3 className="font-semibold text-gray-800">Articles ({items.length})</h3>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-6 py-2.5 text-xs font-medium text-gray-500 uppercase">Produit</th>
              <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Origine</th>
              <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Demande</th>
              {['preparing', 'transferred', 'closed', 'closed_with_discrepancy'].includes(status) && (
                <>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Magasin</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Stock</th>
                </>
              )}
              {['closed', 'closed_with_discrepancy'].includes(status) && (
                <>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Recu</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Ecart</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((item) => {
              const qtyToStore = (item.qty_to_store as number) || 0;
              const qtyReceived = item.qty_received as number;
              const diff = qtyReceived !== null && qtyReceived !== undefined ? qtyReceived - qtyToStore : null;
              const hasDiff = diff !== null && diff !== 0;
              return (
                <tr key={item.id as string} className={hasDiff ? 'bg-red-50/30' : ''}>
                  <td className="px-6 py-3">
                    <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                    <div className="text-xs text-gray-400">{item.category_name as string}</div>
                  </td>
                  <td className="text-center px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SOURCE_TYPE_COLORS[item.source_type as string] || ''}`}>
                      {SOURCE_TYPE_LABELS[item.source_type as string] || '—'}
                    </span>
                    {item.source_type === 'mixed' && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {(item.qty_from_stock as number) || 0}s + {(item.qty_to_produce as number) || 0}p
                      </div>
                    )}
                  </td>
                  <td className="text-center px-4 py-3 text-sm font-semibold">{(item.requested_quantity as number) || 0}</td>
                  {['preparing', 'transferred', 'closed', 'closed_with_discrepancy'].includes(status) && (
                    <>
                      <td className="text-center px-4 py-3 text-xs text-gray-500">
                        {(item.source as string) === 'production' ? 'Production' : 'Stock'}
                      </td>
                      <td className="text-center px-4 py-3 text-sm font-semibold text-primary-700">{qtyToStore}</td>
                      <td className="text-center px-4 py-3 text-sm text-gray-500">{(item.qty_to_stock as number) || 0}</td>
                    </>
                  )}
                  {['closed', 'closed_with_discrepancy'].includes(status) && (
                    <>
                      <td className="text-center px-4 py-3 text-sm font-semibold">{qtyReceived ?? '—'}</td>
                      <td className="text-center px-4 py-3">
                        {diff === null ? '—' : diff === 0 ? (
                          <CheckCircle2 size={16} className="mx-auto text-green-500" />
                        ) : (
                          <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
