import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replenishmentApi } from '../../api/replenishment.api';
import { useAuth } from '../../context/AuthContext';
import { useWorkshops } from '../../api/production.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { getApiErrorMessage } from '../../utils/api-error';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ListKpi } from '../sales/ListTemplate';
import '../production/production.css';
import {
  ArrowLeft, Package, CheckCircle2, Clock, Truck,
  ClipboardCheck, AlertTriangle, XCircle, PackageCheck,
  Loader2, User, Calendar, Hash, ChefHat, Layers, ArrowRight,
  ShoppingBag, Send, type LucideIcon,
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

/** Étiquette de statut commune : transféré = à réceptionner par la boutique, écart = à traiter. */
const STATUS_TAG: Record<string, { tone: StatusTone; icon?: LucideIcon }> = {
  submitted: { tone: 'progress', icon: Send },
  acknowledged: { tone: 'progress' },
  partially_received: { tone: 'progress', icon: Truck },
  preparing: { tone: 'progress', icon: PackageCheck },
  transferred: { tone: 'todo', icon: Truck },
  partially_delivered: { tone: 'progress', icon: Truck },
  closed: { tone: 'done' },
  closed_with_discrepancy: { tone: 'blocked' },
  cancelled: { tone: 'cancelled' },
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
  // Routes selon la nature de l'article (mig 469) :
  purchase: 'À acheter',       // revente : appro par achat, pas production
  service: 'Prestation',       // service/abonnement : intangible, rien à approvisionner
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  stock: 'bg-emerald-100 text-emerald-700',
  production: 'bg-blue-100 text-blue-700',
  mixed: 'bg-amber-100 text-amber-700',
  purchase: 'bg-purple-100 text-purple-700',
  service: 'bg-gray-100 text-gray-600',
};

/* ─── Component ─── */

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isAdmin = ['admin', 'manager'].includes(user?.role || '');
  // Direction ou membre d'un atelier (mig 511).
  const ws = useWorkshops();
  const isResponsable = ['admin', 'manager'].includes(user?.role || '') || ws.mine.length > 0;
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
    <div className="odoo-scope pd"><div className="pd-page">
      <section className="prj-panel sal-empty"><Loader2 size={24} className="animate-spin" /><span>Chargement...</span></section>
    </div></div>
  );

  if (!request) return (
    <div className="odoo-scope pd"><div className="pd-page">
      <section className="prj-panel sal-empty">
        <Package size={28} style={{ opacity: 0.4 }} />
        <strong>Demande non trouvée</strong>
        <button onClick={() => navigate('/replenishment')} className="odoo-btn-secondary"><ArrowLeft size={14} /> Retour</button>
      </section>
    </div></div>
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
  request: Record<string, any>;
  navigate: ReturnType<typeof useNavigate>;
  user: Record<string, any> | null;
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
  const ws = useWorkshops(); // libellé de l'atelier (mig 511)
  const items = (request.items || []) as Record<string, any>[];
  const displayStatus = (request.display_status as string) || (request.status as string);
  const currentStep = stepIndex(displayStatus);
  const status = request.status as string;
  const assignedRole = request.assigned_role as string;
  const productionPlans = (request.production_plans || []) as Record<string, any>[];

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

  const statusTag = STATUS_TAG[displayStatus] || STATUS_TAG.submitted;
  const priorityTagClass = request.priority === 'urgent' ? 'odoo-tag-red'
    : request.priority === 'high' ? 'odoo-tag-orange'
    : request.priority === 'low' ? 'odoo-tag-blue'
    : 'odoo-tag-grey';

  return (
    <div className="odoo-scope pd">
      {/* ══════ BARRE : retour + fil d'Ariane ══════ */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/replenishment')} className="odoo-pager-btn" title="Retour">
          <ArrowLeft size={14} />
        </button>
        <div className="odoo-breadcrumb">
          <ShoppingBag size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/replenishment')}>Demandes boutique</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">
            #{request.request_number || (request.id as string).slice(0, 8).toUpperCase()}
          </span>
        </div>
      </div>

      <div className="pd-page">
      {/* ══════ EN-TÊTE DE FICHE : numéro, statut, priorité, méta, étapes ══════ */}
      <section className="prj-panel prj-hero pd-hero">
        <div className="prj-hero-top">
          <span className="prj-hero-icon"><ShoppingBag size={22} /></span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>#{request.request_number || (request.id as string).slice(0, 8).toUpperCase()}</h1>
              <StatusTag tone={statusTag.tone} icon={statusTag.icon} label={STATUS_LABELS[displayStatus] || displayStatus} />
              <span className={`odoo-tag ${priorityTagClass}`}>{PRIORITY_LABELS[request.priority as string] || request.priority}</span>
            </div>
            <div className="prj-hero-meta">
              {request.requested_by_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {request.requested_by_name as string}
                </span>
              )}
              {request.created_at && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={12} /> {format(new Date(request.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr })}
                </span>
              )}
              {rc && (
                <span className="odoo-tag odoo-tag-purple">
                  <ChefHat size={10} /> {assignedRole === 'general' ? 'Général' : ws.label(assignedRole)}
                </span>
              )}
              {isPartialTransfer && (
                <span className="odoo-tag odoo-tag-blue">{receivedItems.length}/{items.length} reçu(s)</span>
              )}
              {request.acknowledged_by_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ClipboardCheck size={12} /> Pris en charge par {request.acknowledged_by_name as string}
                </span>
              )}
              {request.transferred_by_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Truck size={12} /> Transféré par {request.transferred_by_name as string}
                </span>
              )}
            </div>
          </div>
          {(isAdmin || isStoreStaff) && ['submitted', 'acknowledged', 'partially_received'].includes(status) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="odoo-btn-danger">
                <XCircle size={13} /> Annuler
              </button>
            </div>
          )}
        </div>

        {/* ══════ ÉTAPES ══════ */}
        {status !== 'cancelled' && (
          <ol className="ui-timeline">
            {STEPPER_STEPS.map((step, i) => {
              const isActive = i <= currentStep;
              const isCurrent = i === currentStep;
              const done = isActive && i < currentStep;
              return (
                <li key={step.key} className={`ui-timeline-step ${done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
                  <span className="ui-timeline-dot">{done ? <CheckCircle2 size={12} /> : i + 1}</span>
                  <span className="ui-timeline-label">
                    {isCurrent && displayStatus === 'partially_delivered' && step.key === 'acknowledged'
                      ? 'Partiellement livré'
                      : step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ══════ INDICATEURS ══════ */}
      <div className="prj-kpis">
        <ListKpi label="Articles" value={String(items.length)} />
        <ListKpi label="Reçus" value={String(receivedItems.length)} tone={receivedItems.length > 0 ? 'green' : undefined} />
        <ListKpi label="Prêts" value={String(readyItems.length)} />
        <ListKpi label="En attente" value={String(pendingItems.length)} tone={pendingItems.length > 0 ? 'orange' : undefined} />
      </div>

      {/* Cancelled banner */}
      {status === 'cancelled' && (
        <StatusBanner tone="neutral" icon={XCircle} title="Demande annulée">
          Cette demande a été annulée et ne sera pas traitée.
        </StatusBanner>
      )}

      {/* Production status banner */}
      {hasProductionItems && !['cancelled', 'closed', 'closed_with_discrepancy'].includes(status) && (
        <StatusBanner tone={productionComplete ? 'success' : 'info'} icon={productionComplete ? CheckCircle2 : Clock}
          title={productionComplete ? 'Production terminée' : 'Production en cours'}
          actions={productionPlans.length > 0 ? (
            <button onClick={() => navigate(`/production/${productionPlans[0].id}`)} className="odoo-btn-secondary">
              Voir le plan <ArrowRight size={12} />
            </button>
          ) : undefined}>
          {productionComplete
            ? 'Tous les articles ont été produits.'
            : pendingProductionItems.length > 0
              ? `${pendingProductionItems.length} article(s) en attente de production — les articles en stock peuvent être transférés immédiatement`
              : `${items.filter(i => i.source_type === 'production' || i.source_type === 'mixed').length} article(s) en production`
          }
        </StatusBanner>
      )}

      {/* ══════════════ ACTION PANELS BY STATUS ══════════════ */}

      {/* SUBMITTED: Responsable can acknowledge */}
      {status === 'submitted' && isResponsable && isMyRequest && (
        <StatusBanner tone="warning" icon={Clock} title="Nouvelle demande en attente"
          actions={
            <button onClick={() => acknowledgeMutation.mutate()} disabled={acknowledgeMutation.isPending} className="odoo-btn-primary">
              {acknowledgeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
              {acknowledgeMutation.isPending ? 'Prise en charge...' : 'Prendre en charge'}
            </button>
          }>
          Prenez en charge cette demande pour commencer le traitement.
        </StatusBanner>
      )}

      {status === 'submitted' && (!isResponsable || !isMyRequest) && (
        <StatusBanner tone="warning" icon={Clock} title="En attente de prise en charge">
          Le responsable n'a pas encore pris en charge cette demande.
        </StatusBanner>
      )}

      {/* ACKNOWLEDGED: Responsable fills preparation form */}
      {(status === 'acknowledged' || status === 'partially_received') && isResponsable && isMyRequest && (
        <section className="prj-panel" style={{ overflow: 'hidden' }}>
          <div className="prj-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="flex items-center gap-3">
              <span className="kl-ic b"><PackageCheck size={16} /></span>
              <div>
                <div>Préparation des articles</div>
                <p style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0, color: 'var(--theme-text-muted)', margin: '2px 0 0' }}>
                  {!hasPreparableItems
                    ? 'Aucun article prêt — en attente de production'
                    : pendingProductionItems.length > 0
                      ? `${preparableItems.length} article(s) pret(s) — ${pendingProductionItems.length} en attente de production`
                      : 'Renseignez les quantites a envoyer au magasin et a garder en stock'}
                </p>
              </div>
            </div>
            <button onClick={handleStartPreparing} disabled={prepareMutation.isPending || !hasPreparableItems}
              className="odoo-btn-primary">
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
                    <div className="text-[10px] text-gray-400">Demande</div>
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
        </section>
      )}

      {(status === 'acknowledged' || status === 'partially_received') && (!isResponsable || !isMyRequest) && (
        <StatusBanner tone="info" icon={ClipboardCheck} title="Demande prise en charge">
          Le responsable prepare votre commande.
        </StatusBanner>
      )}

      {/* PREPARING: Responsable can validate transfer */}
      {status === 'preparing' && isResponsable && isMyRequest && (
        <StatusBanner tone="info" icon={Truck} title="Préparation en cours"
          actions={
            <button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending} className="odoo-btn-primary">
              {transferMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              {transferMutation.isPending ? 'Transfert en cours...' : 'Valider le transfert'}
            </button>
          }>
          Une fois les articles prets, validez le transfert vers le magasin.
        </StatusBanner>
      )}

      {status === 'preparing' && (!isResponsable || !isMyRequest) && (
        <StatusBanner tone="info" icon={PackageCheck} title="En préparation">
          Vos articles sont en cours de préparation.
        </StatusBanner>
      )}

      {/* TRANSFERRED: Cashier confirms reception */}
      {status === 'transferred' && isStoreStaff && (
        <section className="prj-panel" style={{ overflow: 'hidden' }}>
          <div className="prj-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="flex items-center gap-3">
              <span className="kl-ic b"><Truck size={16} /></span>
              <div>
                <div>Confirmation de réception</div>
                <p style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0, color: 'var(--theme-text-muted)', margin: '2px 0 0' }}>
                  {pendingItems.length > 0
                    ? `Transfert partiel — ${readyItems.length} article(s) a confirmer, ${pendingItems.length} en attente`
                    : 'Vérifiez les quantités reçues article par article'}
                </p>
              </div>
            </div>
            <button onClick={handleConfirmReception} disabled={receptionMutation.isPending}
              className="odoo-btn-primary">
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
                    <div className="text-[10px] text-gray-400">Attendu</div>
                    <div className="text-sm font-bold text-gray-700">{expected}</div>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <div className="text-[10px] text-gray-400">Reçu</div>
                    <input type="number" min={0} value={received}
                      onChange={(e) => setReceptionValue(itemId, 'qtyReceived', parseInt(e.target.value) || 0)}
                      className={`w-16 text-center py-1.5 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 ${diff !== 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                  </div>
                  <div className="text-center flex-shrink-0 w-12">
                    <div className="text-[10px] text-gray-400">Ecart</div>
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
        </section>
      )}

      {status === 'transferred' && !isStoreStaff && (
        <StatusBanner tone="info" icon={Truck} title="Transféré — en attente de réception">
          La caissière doit confirmer la réception des articles.
        </StatusBanner>
      )}

      {/* CLOSED: Summary */}
      {(status === 'closed' || status === 'closed_with_discrepancy') && (
        <StatusBanner tone={status === 'closed_with_discrepancy' ? 'orange' : 'success'}
          icon={status === 'closed_with_discrepancy' ? AlertTriangle : CheckCircle2}
          title={status === 'closed_with_discrepancy' ? 'Clôturé avec écart' : 'Clôturé — tout est conforme'}>
          {request.closed_by_name && (
            <>Confirmé par {request.closed_by_name as string} le {request.closed_at ? format(new Date(request.closed_at as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : ''}</>
          )}
        </StatusBanner>
      )}

      {/* ══════════════ ITEMS TABLE (always visible) ══════════════ */}
      <section className="prj-panel" style={{ overflow: 'hidden' }}>
        <div className="prj-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Layers size={16} /> Articles
          <small style={{ fontSize: 13, fontWeight: 500, color: 'var(--theme-text-muted)' }}>{items.length} article(s)</small>
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
                  <div className="text-[10px] text-gray-400">Demande</div>
                  <div className="text-sm font-bold text-gray-700">{(item.requested_quantity as number) || 0}</div>
                </div>
                {/* Prep details */}
                {showPrepDetails && (
                  <>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400">Source</div>
                      <div className="text-xs text-gray-500">{(item.source as string) === 'production' ? 'Prod.' : 'Stock'}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400">Magasin</div>
                      <div className="text-sm font-semibold text-indigo-700">{qtyToStore}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400">Stock</div>
                      <div className="text-sm text-gray-500">{(item.qty_to_stock as number) || 0}</div>
                    </div>
                  </>
                )}
                {/* Reception details */}
                {isClosed && (
                  <>
                    <div className="text-center flex-shrink-0 w-14">
                      <div className="text-[10px] text-gray-400">Reçu</div>
                      <div className="text-sm font-semibold">{qtyReceived ?? '\u2014'}</div>
                    </div>
                    <div className="text-center flex-shrink-0 w-12">
                      <div className="text-[10px] text-gray-400">Ecart</div>
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
      </section>
      </div>{/* /pd-page */}
    </div>
  );
}
