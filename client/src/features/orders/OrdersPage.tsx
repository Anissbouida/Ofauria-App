import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format, startOfDay, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { StageProgress, SelectFilter, type StageDef } from '../../components/purchasing/ProcessBoard';
import {
  ClipboardList, Plus, Phone, Pencil, Search, Eye, X,
  Clock, CheckCircle2, Factory, Truck, Ban, CalendarDays,
  Banknote, CreditCard, Package, PackageCheck, FileText,
  AlertTriangle, Trash2, Loader2, Tag, User, Building2, CalendarClock, Printer, List, SquareKanban,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import OrderFormModal from '../../components/orders/OrderFormModal';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import '../projects/projects.css';
import '../sales/sales.css';

/* ═══════════════════════ Référentiel d'affichage ═══════════════════════ */

type OrderRow = Record<string, any>;

/** Étapes du cycle de vie d'une commande client (même grammaire que les BC / factures). */
const STAGES: StageDef[] = [
  { key: 'pending',       label: 'Brouillon',     hint: 'à confirmer',        icon: Clock },
  { key: 'confirmed',     label: 'Confirmées',    hint: 'à lancer',           icon: CheckCircle2 },
  { key: 'in_production', label: 'En production', hint: 'en atelier',         icon: Factory },
  { key: 'ready',         label: 'Prêtes',        hint: 'à livrer',           icon: Package },
  { key: 'partially_delivered', label: 'Livrées en partie', hint: 'reliquat à livrer', icon: Truck },
  { key: 'completed',     label: 'Terminées',     hint: 'livrées',            icon: Truck },
];
const STAGE_KEYS = STAGES.map(s => s.key);

const STATUS_TAG: Record<string, string> = {
  pending: 'odoo-tag-grey',
  confirmed: 'odoo-tag-blue',
  in_production: 'odoo-tag-yellow',
  ready: 'odoo-tag-green',
  partially_delivered: 'odoo-tag-orange',
  completed: 'odoo-tag-purple',
  cancelled: 'odoo-tag-red',
};

const TYPE_LABELS: Record<string, string> = { custom: 'Sur mesure', online: 'En ligne', event: 'Événement', staff: 'Personnel' };
const TYPE_TAG: Record<string, string> = { custom: 'odoo-tag-purple', online: 'odoo-tag-blue', event: 'odoo-tag-orange', staff: 'odoo-tag-grey' };

const FILTER_CHIPS: Array<{ key: string; label: string; icon: typeof Clock }> = [
  { key: '', label: 'Toutes', icon: ClipboardList },
  { key: 'pending', label: 'Brouillon', icon: Clock },
  { key: 'confirmed', label: 'Confirmées', icon: CheckCircle2 },
  { key: 'in_production', label: 'En production', icon: Factory },
  { key: 'ready', label: 'Prêtes', icon: Package },
  { key: 'partially_delivered', label: 'Livrées en partie', icon: Truck },
  { key: 'completed', label: 'Terminées', icon: Truck },
  { key: 'cancelled', label: 'Annulées', icon: Ban },
];

const OPEN_STATUSES = new Set(['pending', 'confirmed', 'in_production', 'ready', 'partially_delivered']);

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function num(v: unknown) { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; }
/** Client professionnel (fiche non « particulier ») : processus direction, BL et facture (mig 354). */
function isPro(o: OrderRow) { return !!o.customer_type && o.customer_type !== 'particulier'; }
function customerName(o: OrderRow) {
  if (isPro(o) && o.company_name) return o.company_name as string;
  return o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}`.trim() : '—';
}
/** Suivi Livrée → Facturée → Payée d'une commande de professionnel. */
function proBilling(o: OrderRow): { label: string; tag: string; doc?: string } {
  if (o.invoice_status === 'paid') return { label: 'Payée', tag: 'odoo-tag-green', doc: o.invoice_number as string };
  if (o.invoice_number) return { label: 'Facturée', tag: 'odoo-tag-blue', doc: o.invoice_number as string };
  if (o.delivery_note_number) return { label: 'Livrée · à facturer', tag: 'odoo-tag-orange', doc: o.delivery_note_number as string };
  return { label: 'Sur facture', tag: 'odoo-tag-grey' };
}
const CAN_RESCHEDULE = new Set(['pending', 'confirmed', 'in_production', 'ready']);
function fmtDate(d: unknown, pattern = 'dd MMM yyyy') {
  return d ? format(new Date(String(d)), pattern, { locale: fr }) : '—';
}
/** Commande en cours dont la date de retrait est dépassée. */
function isLate(o: OrderRow, today: Date) {
  if (!OPEN_STATUSES.has(o.status as string) || !o.pickup_date) return false;
  return startOfDay(new Date(o.pickup_date as string)) < today;
}

/** Jours de retard sur la date de retrait. */
function daysLate(o: OrderRow, today: Date) {
  return o.pickup_date ? differenceInCalendarDays(today, startOfDay(new Date(o.pickup_date as string))) : 0;
}
const CAN_CANCEL = new Set(['pending', 'confirmed', 'in_production']);
/** Étape suivante sans saisie (la livraison, elle, ouvre sa fenêtre). */
const NEXT_STEP: Record<string, { to: string; label: string; icon: LucideIcon }> = {
  pending: { to: 'confirmed', label: 'Confirmer', icon: CheckCircle2 },
  confirmed: { to: 'in_production', label: 'Lancer', icon: Factory },
  in_production: { to: 'ready', label: 'Marquer prête', icon: PackageCheck },
};
const BULK_STEPS = [
  { from: 'pending', to: 'confirmed', label: 'Confirmer' },
  { from: 'confirmed', to: 'in_production', label: 'Lancer en production' },
  { from: 'in_production', to: 'ready', label: 'Marquer prêtes' },
];
const LANE_TONE: Record<string, string> = { pending: 'grey', ready: 'green', partially_delivered: 'orange' };

/* Styles partagés des fenêtres (mêmes valeurs que les modales Achats). */
const modalPanelStyle: CSSProperties = {
  backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
  borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};
const modalHeaderStyle: CSSProperties = { backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem', color: '#fff' };
const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.03em', color: 'var(--odoo-text-muted)', marginBottom: 4,
};
const fieldStyle: CSSProperties = {
  width: '100%', padding: '0.375rem 0.5rem', border: '1px solid var(--odoo-border)',
  borderRadius: 4, fontSize: '0.8125rem', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};
const sectionStyle: CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' };

/* ═══════════════════════ Page ═══════════════════════ */

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [rescheduleOrder, setRescheduleOrder] = useState<OrderRow | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [viewingOrder, setViewingOrder] = useState<OrderRow | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<OrderRow | null>(null);
  const [prepayOrder, setPrepayOrder] = useState<OrderRow | null>(null);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Les bons de livraison ont leur propre écran (/delivery-notes), séparé des commandes
  // comme dans les ERP standards : cette page ne gère plus que les commandes clients.

  // Une seule lecture : les compteurs du pipeline et la liste partagent la même source,
  // le filtrage par statut se fait côté client (le serveur pagine à 20 par défaut).
  const { data, isLoading } = useQuery({
    queryKey: ['orders', { all: true }],
    queryFn: () => ordersApi.list({ limit: '500' }),
  });
  const orders: OrderRow[] = data?.data || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: (res: unknown) => {
      invalidate(); notify.success('Statut mis à jour');
      // Annulation : plan de production déjà lancé, à arrêter par l'atelier (O2C L2).
      const warnings = (res as { plan_warnings?: string[] } | undefined)?.plan_warnings ?? [];
      for (const w of warnings) notify.warning(w);
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la mise à jour')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ordersApi.remove(id),
    onSuccess: () => { invalidate(); notify.success('Commande supprimée'); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Impossible de supprimer la commande')),
  });

  const today = startOfDay(new Date());

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': orders.length };
    for (const o of orders) c[o.status as string] = (c[o.status as string] || 0) + 1;
    return c;
  }, [orders]);
  const openCount = orders.filter(o => OPEN_STATUSES.has(o.status as string)).length;
  const lateOrders = useMemo(() => orders.filter(o => isLate(o, today)), [orders, today]);

  const typeOptions = useMemo(() => {
    const seen = new Set(orders.map(o => o.type as string).filter(Boolean));
    return Array.from(seen).map(k => ({ key: k, label: TYPE_LABELS[k] || k }));
  }, [orders]);

  /* ── Liste filtrée ── */
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (typeFilter && o.type !== typeFilter) return false;
      if (lateOnly && !isLate(o, today)) return false;
      if (!q) return true;
      return (
        String(o.order_number || '').toLowerCase().includes(q) ||
        customerName(o).toLowerCase().includes(q) ||
        String(o.customer_phone || '').toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, typeFilter, lateOnly, searchQuery, today]);

  const filteredTotal = filteredOrders.reduce((s, o) => s + num(o.total), 0);
  const hasFilters = !!(statusFilter || typeFilter || lateOnly || searchQuery);

  const cancelOrder = async (o: OrderRow) => {
    const adv = num(o.advance_amount);
    const msg = adv > 0
      ? `Annuler la commande ${o.order_number} ? L'avance de ${n(adv)} DH reste acquise : elle n'est pas remboursée.`
      : `Annuler la commande ${o.order_number} ?`;
    if (await confirm(msg, { title: 'Annuler la commande', confirmLabel: 'Annuler la commande', cancelLabel: 'Retour', danger: true })) {
      updateStatusMutation.mutate({ id: o.id as string, status: 'cancelled' });
    }
  };
  const removeOrder = async (o: OrderRow) => {
    if (await confirm(`Supprimer définitivement la commande annulée ${o.order_number} ?`, { title: 'Supprimer la commande', confirmLabel: 'Supprimer', danger: true })) {
      deleteMutation.mutate(o.id as string);
    }
  };

  /* ── Sélection multiple et actions groupées ── */
  const selectedOrders = orders.filter(o => selected.has(o.id as string));
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allShownSelected = filteredOrders.length > 0 && filteredOrders.every(o => selected.has(o.id as string));
  const toggleAllShown = () => setSelected(prev => {
    const next = new Set(prev);
    for (const o of filteredOrders) { if (allShownSelected) next.delete(o.id as string); else next.add(o.id as string); }
    return next;
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const res = await Promise.allSettled(ids.map(id => ordersApi.updateStatus(id, status)));
      return {
        ok: res.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<unknown>[],
        failed: res.filter(r => r.status === 'rejected') as PromiseRejectedResult[],
      };
    },
    onSuccess: ({ ok, failed }) => {
      invalidate(); setSelected(new Set());
      if (ok.length) notify.success(`${ok.length} commande${ok.length > 1 ? 's' : ''} mise${ok.length > 1 ? 's' : ''} à jour`);
      for (const r of ok) for (const w of (r.value as { plan_warnings?: string[] } | undefined)?.plan_warnings ?? []) notify.warning(w);
      if (failed.length) notify.error(`${failed.length} commande${failed.length > 1 ? 's refusées' : ' refusée'} : ${getApiErrorMessage(failed[0].reason, 'erreur')}`);
    },
  });
  const bulkCancel = async () => {
    const targets = selectedOrders.filter(o => CAN_CANCEL.has(o.status as string));
    const withAdvance = targets.filter(o => num(o.advance_amount) > 0).length;
    const msg = `Annuler ${targets.length} commande${targets.length > 1 ? 's' : ''} ?`
      + (withAdvance ? ` Les avances versées (${withAdvance} commande${withAdvance > 1 ? 's' : ''}) restent acquises : elles ne sont pas remboursées.` : '');
    if (await confirm(msg, { title: 'Annuler les commandes', confirmLabel: 'Annuler les commandes', cancelLabel: 'Retour', danger: true })) {
      bulkMutation.mutate({ ids: targets.map(o => o.id as string), status: 'cancelled' });
    }
  };

  /* ── Actions d'une ligne : l'étape suivante en bouton, le reste dans « ⋯ » ── */
  const busy = updateStatusMutation.isPending || deleteMutation.isPending || bulkMutation.isPending;
  const nextAction = (o: OrderRow): { label: string; icon: LucideIcon; run: () => void } | null => {
    const s = o.status as string;
    const step = NEXT_STEP[s];
    if (step) return { label: step.label, icon: step.icon, run: () => updateStatusMutation.mutate({ id: o.id as string, status: step.to }) };
    if (s === 'ready') return { label: isPro(o) ? 'Livrer' : 'Remettre', icon: Truck, run: () => setDeliverOrder(o) };
    if (s === 'partially_delivered' && isPro(o)) return { label: 'Livrer le reliquat', icon: Truck, run: () => setDeliverOrder(o) };
    return null;
  };
  const menuItems = (o: OrderRow): RowMenuItem[] => {
    const s = o.status as string;
    const items: RowMenuItem[] = [{ label: 'Voir le détail', icon: Eye, onSelect: () => setViewingOrder(o) }];
    if (s !== 'completed' && s !== 'cancelled' && s !== 'partially_delivered') items.push({ label: 'Modifier', icon: Pencil, onSelect: () => setEditingOrder(o) });
    if (CAN_RESCHEDULE.has(s)) items.push({ label: 'Reporter le retrait', icon: CalendarClock, onSelect: () => setRescheduleOrder(o) });
    if (isPro(o) && isDirection && s !== 'cancelled' && s !== 'completed') items.push({ label: "Facture d'acompte", icon: Banknote, onSelect: () => setPrepayOrder(o) });
    if (CAN_CANCEL.has(s)) items.push({ label: 'Annuler la commande', icon: Ban, danger: true, disabled: busy, onSelect: () => cancelOrder(o) });
    if (s === 'cancelled') items.push({ label: 'Supprimer définitivement', icon: Trash2, danger: true, disabled: busy, onSelect: () => removeOrder(o) });
    return items;
  };

  /* ── Kanban : glisser vers l'étape suivante ; la livraison passe par sa fenêtre ── */
  const dropOn = (stage: string, id: string) => {
    const o = orders.find(x => x.id === id);
    if (!o || o.status === stage) return;
    const from = o.status as string;
    if (NEXT_STEP[from]?.to === stage) { updateStatusMutation.mutate({ id, status: stage }); return; }
    if (stage === 'partially_delivered' && (from === 'ready') && isPro(o)) { setDeliverOrder(o); return; }
    const label = (k: string) => STAGES.find(st => st.key === k)?.label ?? k;
    notify.warning(`« ${label(from)} » → « ${label(stage)} » : utilisez l'action de la commande (le passage se fait une étape à la fois).`);
  };

  const paymentCell = (o: OrderRow) => {
    const status = o.status as string;
    const totalAmt = num(o.total);
    const advanceAmt = num(o.advance_amount);
    const remaining = Math.max(0, totalAmt - advanceAmt);
    if (isPro(o)) {
      const b = proBilling(o);
      return <><span className={`odoo-tag ${b.tag}`}>{b.label}</span>{b.doc && <span className="sal-sub sal-mono">{b.doc}</span>}</>;
    }
    if (status === 'cancelled') return <span className="sal-sub">{advanceAmt > 0 ? `avance de ${n(advanceAmt)} DH conservée` : '—'}</span>;
    if (status === 'completed') return <span className="odoo-tag odoo-tag-green">Soldée</span>;
    if (advanceAmt > 0) return <><span className="odoo-tag odoo-tag-orange">Avance {n(advanceAmt)}</span><span className="sal-sub">reste {n(remaining)} DH</span></>;
    return <span className="sal-sub">au retrait</span>;
  };

  const openTotal = orders.filter(o => OPEN_STATUSES.has(o.status as string)).reduce((s, o) => s + num(o.total), 0);
  const kanbanStages = STAGES.filter(st => st.key !== 'completed');

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ClipboardList size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Ventes</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">Commandes</span>
          <span style={{ marginLeft: 8, color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
            {openCount} en cours · {n(openTotal)} DH
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary">
          <Plus size={13} /> Nouvelle commande
        </button>
      </div>

      <div className="prj sal-page">
        <div className="prj-toolbar">
          <label className="prj-search">
            <Search size={15} aria-hidden="true" style={{ color: 'var(--theme-text-muted)' }} />
            <input type="search" aria-label="Rechercher une commande" placeholder="N° de commande, client ou téléphone…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </label>
          {typeOptions.length > 1 && (
            <SelectFilter label="Type" icon={Tag} value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="Tous les types" />
          )}
          <div className="prj-views" role="group" aria-label="Affichage">
            <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} /> Liste</button>
            <button type="button" className={view === 'kanban' ? 'active' : ''} aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}><SquareKanban size={14} /> Kanban</button>
          </div>
        </div>

        <div className="prj-chips" role="group" aria-label="Filtrer par étape">
          {FILTER_CHIPS.flatMap((chip) => {
            const active = statusFilter === chip.key && !lateOnly;
            const count = counts[chip.key] || 0;
            const btn = (
              <button key={chip.key || 'all'} type="button" aria-pressed={active}
                className={`prj-chip${active ? ' active' : ''}${count ? '' : ' empty'}`}
                onClick={() => { setLateOnly(false); setStatusFilter(chip.key); }}>
                {chip.label} <small>{count}</small>
              </button>
            );
            if (chip.key !== '' || (!lateOrders.length && !lateOnly)) return [btn];
            return [btn, (
              <button key="late" type="button" aria-pressed={lateOnly} className={`prj-chip sal-late${lateOnly ? ' active' : ''}`}
                onClick={() => { setLateOnly(v => !v); setStatusFilter(''); }}>
                <AlertTriangle size={13} /> En retard <small>{lateOrders.length}</small>
              </button>
            )];
          })}
        </div>

        {selectedOrders.length > 0 && (
          <div className="sal-bulk" role="region" aria-label="Actions sur la sélection">
            <strong>
              {selectedOrders.length} commande{selectedOrders.length > 1 ? 's sélectionnées' : ' sélectionnée'} · {n(selectedOrders.reduce((s, o) => s + num(o.total), 0))} DH
            </strong>
            {BULK_STEPS.map(b => {
              const eligible = selectedOrders.filter(o => o.status === b.from).map(o => o.id as string);
              if (!eligible.length) return null;
              return (
                <button key={b.to} type="button" disabled={busy} onClick={() => bulkMutation.mutate({ ids: eligible, status: b.to })}>
                  {b.label} ({eligible.length})
                </button>
              );
            })}
            {selectedOrders.some(o => CAN_CANCEL.has(o.status as string)) && (
              <button type="button" className="danger" disabled={busy} onClick={bulkCancel}>Annuler</button>
            )}
            <button type="button" onClick={() => setSelected(new Set())}>Désélectionner</button>
          </div>
        )}

        {isLoading ? (
          <div className="prj-panel sal-empty">
            <Loader2 className="animate-spin" size={20} />
            <span>Chargement des commandes…</span>
          </div>
        ) : view === 'kanban' ? (
          <div className="prj-board">
            {kanbanStages.map(st => {
              const cards = filteredOrders.filter(o => o.status === st.key);
              const sum = cards.reduce((s, o) => s + num(o.total), 0);
              return (
                <section key={st.key} aria-label={st.label} className={`prj-lane${dragOver === st.key ? ' over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(st.key); }}
                  onDragLeave={() => setDragOver(d => (d === st.key ? null : d))}
                  onDrop={e => { e.preventDefault(); setDragOver(null); dropOn(st.key, e.dataTransfer.getData('text/plain')); }}>
                  <div className="prj-lane-head">
                    <span className={`prj-dot ${LANE_TONE[st.key] ?? ''}`} /><strong>{st.label}</strong>
                    <small className="sal-lane-sum">{cards.length} · {n(sum)} DH</small>
                  </div>
                  {!cards.length && <div className="prj-lane-empty">Aucune commande</div>}
                  {cards.map(o => {
                    const late = isLate(o, today);
                    return (
                      <button key={o.id as string} type="button" className="prj-task" draggable
                        onDragStart={e => { e.dataTransfer.setData('text/plain', o.id as string); e.dataTransfer.effectAllowed = 'move'; }}
                        onClick={() => setViewingOrder(o)} title="Cliquer pour ouvrir · glisser vers l'étape suivante">
                        <span className="prj-card-num">{o.order_number as string}</span>
                        <span className="prj-task-title">{customerName(o)}</span>
                        <span className="prj-task-meta">
                          <span style={{ flex: 1 }}>Retrait <span className={late ? 'late' : ''}>{fmtDate(o.pickup_date, 'd MMM')}</span>{late ? ` · ${daysLate(o, today)} j de retard` : ''}</span>
                          <span className="sal-amount">{n(num(o.total))} DH</span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        ) : (
          <section className="prj-panel sal-panel">
            {filteredOrders.length === 0 ? (
              <div className="sal-empty">
                <ClipboardList size={28} style={{ opacity: 0.4 }} />
                <strong>{hasFilters ? 'Aucune commande pour ces filtres' : 'Aucune commande'}</strong>
                <span>{hasFilters ? 'Changez d\'étape ou effacez la recherche.' : 'Créez votre première commande.'}</span>
                {hasFilters ? (
                  <button type="button" className="odoo-btn-secondary" onClick={() => { setStatusFilter(''); setTypeFilter(''); setLateOnly(false); setSearchQuery(''); }}>Effacer les filtres</button>
                ) : (
                  <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary"><Plus size={13} /> Créer une commande</button>
                )}
              </div>
            ) : (
              <>
                <div className="prj-scroll">
                  <table className="odoo-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input type="checkbox" className="sal-check" checked={allShownSelected} onChange={toggleAllShown} aria-label="Sélectionner toutes les commandes affichées" />
                        </th>
                        <th>N° commande</th>
                        <th>Client</th>
                        <th>Retrait</th>
                        <th>Avancement</th>
                        <th>Statut</th>
                        <th style={{ textAlign: 'right' }}>Total TTC</th>
                        <th>Règlement</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((o) => {
                        const id = o.id as string;
                        const status = o.status as string;
                        const late = isLate(o, today);
                        const isSel = selected.has(id);
                        const next = nextAction(o);
                        return (
                          <tr key={id} onClick={() => setViewingOrder(o)} className={isSel ? 'selected' : undefined}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" className="sal-check" checked={isSel} onChange={() => toggleOne(id)} aria-label={`Sélectionner ${o.order_number as string}`} />
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}><span className="sal-num">{o.order_number as string}</span></td>
                            <td>
                              <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {isPro(o) && <Building2 size={12} style={{ color: 'var(--theme-text-muted)' }} aria-label="Professionnel" />}
                                {customerName(o)}
                              </span>
                              <span className="sal-sub">
                                {isPro(o) ? 'Professionnel' : 'Particulier'}{o.type && TYPE_LABELS[o.type as string] ? ` · ${TYPE_LABELS[o.type as string]}` : ''}
                                {o.customer_phone ? ` · ${o.customer_phone as string}` : ''}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {fmtDate(o.pickup_date, 'd MMM yyyy')}
                              {late && <span className="sal-late-txt">en retard de {daysLate(o, today)} j</span>}
                            </td>
                            <td style={{ minWidth: 120 }}>
                              {status === 'cancelled'
                                ? <span className="sal-sub" style={{ margin: 0 }}>—</span>
                                : <StageProgress count={STAGES.length - 1} current={STAGE_KEYS.indexOf(status)} done={status === 'completed'} late={late} />}
                            </td>
                            <td><span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status}</span></td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{n(num(o.total))}</strong>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 3 }}>DH</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{paymentCell(o)}</td>
                            <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                              <div className="sal-actions">
                                {next && (
                                  <button type="button" className="sal-next" disabled={busy} onClick={next.run}>
                                    <next.icon size={13} /> {next.label}
                                  </button>
                                )}
                                <RowMenu items={menuItems(o)} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="sal-foot">
                  <span>{filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}{hasFilters ? ' (filtrées)' : ''}</span>
                  <span>Total affiché <strong>{n(filteredTotal)} DH TTC</strong></span>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {/* Formulaire création / édition */}
      {showForm && (
        <OrderFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); invalidate(); }}
        />
      )}
      {editingOrder && (
        <OrderFormModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => { setEditingOrder(null); invalidate(); }}
        />
      )}

      {viewingOrder && (
        <OrderDetailModal
          order={viewingOrder}
          late={isLate(viewingOrder, today)}
          onClose={() => setViewingOrder(null)}
          onEdit={(o) => { setViewingOrder(null); setEditingOrder(o); }}
          onStatus={(o, status) => { setViewingOrder(null); updateStatusMutation.mutate({ id: o.id as string, status }); }}
          onDeliver={(o) => { setViewingOrder(null); setDeliverOrder(o); }}
          onCancel={(o) => { setViewingOrder(null); cancelOrder(o); }}
          onReschedule={(o) => { setViewingOrder(null); setRescheduleOrder(o); }}
        />
      )}

      {deliverOrder && (isPro(deliverOrder) ? (
        <ProDeliverModal
          order={deliverOrder}
          onClose={() => setDeliverOrder(null)}
          onDelivered={() => { setDeliverOrder(null); invalidate(); queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); queryClient.invalidateQueries({ queryKey: ['invoices'] }); }}
        />
      ) : (
        <DeliverModal
          order={deliverOrder}
          onClose={() => setDeliverOrder(null)}
          onDelivered={() => { setDeliverOrder(null); invalidate(); queryClient.invalidateQueries({ queryKey: ['sales'] }); }}
        />
      ))}

      {rescheduleOrder && (
        <RescheduleModal
          order={rescheduleOrder}
          isDirection={isDirection}
          onClose={() => setRescheduleOrder(null)}
          onDone={() => { setRescheduleOrder(null); invalidate(); }}
        />
      )}
      {prepayOrder && (
        <PrepaymentModal
          order={prepayOrder}
          onClose={() => setPrepayOrder(null)}
          onDone={() => { setPrepayOrder(null); invalidate(); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════ Facture d'acompte (phase 5.4) ═══════════════════════ */

function PrepaymentModal({ order, onClose, onDone }: { order: OrderRow; onClose: () => void; onDone: () => void }) {
  const total = num(order.total);
  const [percent, setPercent] = useState('30');
  const pct = Math.max(0, Math.min(100, parseFloat(percent) || 0));
  const amount = Math.round(total * pct) / 100;

  const mutation = useMutation({
    mutationFn: () => ordersApi.prepaymentInvoice(order.id as string, { percent: pct }),
    onSuccess: (inv: Record<string, unknown>) => { notify.success(`Facture d'acompte ${inv?.invoice_number ?? ''} émise`); onDone(); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Acompte impossible')),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Banknote size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Facture d'acompte</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{order.order_number as string} · total {n(total)} DH</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StatusBanner tone="info" icon={FileText} title="Pièce numérotée (série FA)">
            L'acompte est une vraie facture, avec TVA, déduite ensuite de la facture finale de la commande.
          </StatusBanner>
          <div>
            <label style={labelStyle}>Pourcentage de l'acompte</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min={1} max={100} value={percent} onChange={e => setPercent(e.target.value)} style={{ ...fieldStyle, width: 120 }} />
              <span style={{ color: 'var(--theme-text-muted)' }}>% → <strong>{n(amount)} DH</strong> TTC</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          <button onClick={() => mutation.mutate()} className="odoo-btn-primary" disabled={mutation.isPending || !(pct > 0)}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} Émettre l'acompte
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Fiche commande ═══════════════════════ */

function OrderDetailModal({ order: o, late, onClose, onEdit, onStatus, onDeliver, onCancel, onReschedule }: {
  order: OrderRow; late: boolean;
  onClose: () => void;
  onEdit: (o: OrderRow) => void;
  onStatus: (o: OrderRow, status: string) => void;
  onDeliver: (o: OrderRow) => void;
  onCancel: (o: OrderRow) => void;
  onReschedule: (o: OrderRow) => void;
}) {
  const { data: detail } = useQuery({
    queryKey: ['order-detail', o.id],
    queryFn: () => ordersApi.getById(o.id as string),
  });
  const status = o.status as string;
  const totalAmt = num(o.total);
  const advanceAmt = num(o.advance_amount);
  const discountAmt = num(o.discount_amount);
  const taxAmt = num(o.tax_amount);
  const remaining = Math.max(0, totalAmt - advanceAmt);
  const stageIdx = STAGE_KEYS.indexOf(status);
  const items: OrderRow[] = detail?.items || [];
  const reschedules: OrderRow[] = detail?.reschedules || [];
  const pro = isPro(o);
  const billing = pro ? proBilling(o) : null;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '1rem' }}>{o.order_number as string}</span>
              <span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status}</span>
              <span className={`odoo-tag ${TYPE_TAG[o.type as string] || 'odoo-tag-grey'}`}>{TYPE_LABELS[o.type as string] || (o.type as string)}</span>
              {late && <span className="odoo-tag odoo-tag-red">En retard</span>}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: 2 }}>
              Créée le {fmtDate(o.created_at, 'dd/MM/yyyy HH:mm')} · Retrait le {fmtDate(o.pickup_date)}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        {/* Frise d'avancement */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          {status === 'cancelled' ? (
            <span style={{ fontSize: '0.75rem', color: '#721c24', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ban size={12} /> Commande annulée</span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 6 }}>
              {STAGES.map((s, i) => {
                const reached = i <= stageIdx;
                const current = i === stageIdx;
                const Icon = s.icon;
                return (
                  <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ height: 5, borderRadius: 3, background: reached ? (current && late ? '#dc3545' : 'var(--odoo-purple)') : 'var(--odoo-border)', opacity: current && !late ? 0.6 : 1 }} />
                    <span style={{ fontSize: '0.6875rem', fontWeight: current ? 700 : 500, color: reached ? 'var(--odoo-text)' : 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Icon size={10} /> {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><User size={11} /> Client</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {customerName(o)}
                  <span className={`odoo-tag ${pro ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{pro ? 'Professionnel' : o.customer_id ? 'Particulier' : 'Passager'}</span>
                </div>
                {o.customer_phone && (
                  <div style={{ color: 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Phone size={10} /> {o.customer_phone as string}
                  </div>
                )}
              </div>
            </div>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><CalendarDays size={11} /> Retrait</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Date</span>
                  <span style={{ fontWeight: 600, color: late ? '#721c24' : undefined }}>{fmtDate(o.pickup_date)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Créée le</span>
                  <span>{fmtDate(o.created_at, 'dd/MM/yyyy HH:mm')}</span>
                </div>
                {reschedules.map((r) => (
                  <div key={r.id as string} style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
                    Reportée du {fmtDate(r.old_pickup_date, 'dd/MM')} au {fmtDate(r.new_pickup_date, 'dd/MM')} par {(r.created_by_name as string) || '—'}
                    {r.forced ? ' (forcé, moins de 24 h)' : ''}{r.reason ? ` — ${r.reason as string}` : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div className="odoo-section-header"><Package size={11} /> Articles commandés</div>
            {!detail ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>
                <Loader2 className="animate-spin" size={16} style={{ margin: '0 auto 6px' }} /> Chargement des articles...
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Aucun article</div>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th style={{ textAlign: 'right' }}>Qté</th>
                    <th style={{ textAlign: 'right' }}>P.U.{pro ? ' HT' : ''}</th>
                    {pro && <th style={{ textAlign: 'right' }}>TVA</th>}
                    <th style={{ textAlign: 'right' }}>Montant{pro ? ' HT' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const qty = num(item.quantity);
                    const pu = num(item.unit_price);
                    return (
                      <tr key={idx} style={{ cursor: 'default' }}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{(item.product_name as string) || (item.product_id as string)}</div>
                          {item.notes && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{item.notes as string}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{qty}</td>
                        <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{n(pu)}</td>
                        {pro && <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{item.tva_rate != null ? `${num(item.tva_rate)} %` : '—'}</td>}
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(qty * pu)} DH</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: o.notes ? '1fr 1fr' : '1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><Banknote size={11} /> Règlement</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Sous-total{pro ? ' HT' : ''}</span><span>{n(totalAmt + discountAmt - taxAmt)} DH</span>
                </div>
                {num(o.promotion_amount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0f5132' }}>
                    <span>Promotions</span><span>-{n(num(o.promotion_amount))} DH</span>
                  </div>
                )}
                {discountAmt - num(o.promotion_amount) > 0.004 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#721c24' }}>
                    <span>Remise{o.discount_pct != null ? ` (${num(o.discount_pct)} %)` : ''}</span><span>-{n(discountAmt - num(o.promotion_amount))} DH</span>
                  </div>
                )}
                {pro && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--odoo-text-muted)' }}>TVA</span><span>{n(taxAmt)} DH</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                  <span>Total{pro ? ' TTC' : ''}</span><span>{n(totalAmt)} DH</span>
                </div>
                {pro && billing ? (<>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--odoo-text-muted)' }}>Suivi</span><span className={`odoo-tag ${billing.tag}`}>{billing.label}</span>
                  </div>
                  {o.delivery_note_number && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--odoo-text-muted)' }}>Bon de livraison</span>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{o.delivery_note_number as string}</span>
                        {o.delivery_note_id && (
                          <button type="button" onClick={() => openDeliveryNotePdf(o.delivery_note_id as string)} title="Imprimer le BL" className="odoo-pager-btn"><Printer size={12} /></button>
                        )}
                      </span>
                    </div>
                  )}
                  {o.invoice_number && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--odoo-text-muted)' }}>Facture</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{o.invoice_number as string}{o.invoice_due_date ? ` · échéance ${fmtDate(o.invoice_due_date, 'dd/MM/yyyy')}` : ''}</span>
                    </div>
                  )}
                  <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
                    Facturation {o.billing_frequency === 'per_delivery' ? 'à chaque livraison' : 'mensuelle'} · règlement saisi par la direction.
                  </div>
                </>) : (<>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}>
                    <span>Avance versée (non remboursable)</span><span style={{ fontWeight: 600 }}>{n(advanceAmt)} DH</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>Reste à payer au retrait</span>
                    <span style={{ color: remaining > 0 && status !== 'completed' ? '#b85d1a' : undefined }}>
                      {status === 'completed' ? 'Soldée' : status === 'cancelled' ? (advanceAmt > 0 ? 'Annulée — avance conservée' : 'Annulée') : `${n(remaining)} DH`}
                    </span>
                  </div>
                </>)}
              </div>
            </div>
            {o.notes && (
              <div style={sectionStyle}>
                <div className="odoo-section-header"><FileText size={11} /> Notes</div>
                <div style={{ padding: '10px 12px', fontSize: '0.8125rem', whiteSpace: 'pre-line' }}>{o.notes as string}</div>
              </div>
            )}
          </div>
        </div>

        {/* Pied */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)', flexWrap: 'wrap' }}>
          {(status === 'pending' || status === 'confirmed' || status === 'in_production') && (
            <button onClick={() => onCancel(o)} className="odoo-btn-danger" style={{ marginRight: 'auto' }}><Ban size={13} /> Annuler la commande</button>
          )}
          <button onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          {CAN_RESCHEDULE.has(status) && (
            <button onClick={() => onReschedule(o)} className="odoo-btn-secondary"><CalendarClock size={13} /> Reporter</button>
          )}
          {status !== 'completed' && status !== 'cancelled' && (
            <button onClick={() => onEdit(o)} className="odoo-btn-secondary"><Pencil size={13} /> Modifier</button>
          )}
          {status === 'pending' && (
            <button onClick={() => onStatus(o, 'confirmed')} className="odoo-btn-primary"><CheckCircle2 size={13} /> Confirmer</button>
          )}
          {status === 'confirmed' && (
            <button onClick={() => onStatus(o, 'in_production')} className="odoo-btn-primary"><Factory size={13} /> Envoyer en production</button>
          )}
          {status === 'in_production' && (
            <button onClick={() => onStatus(o, 'ready')} className="odoo-btn-primary"><PackageCheck size={13} /> Marquer prête</button>
          )}
          {(status === 'ready' || (status === 'partially_delivered' && pro)) && (
            <button onClick={() => onDeliver(o)} className="odoo-btn-primary"><Truck size={13} /> {pro ? (status === 'partially_delivered' ? 'Livrer le reliquat' : 'Livrer sur BL') : 'Remettre au client'}</button>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Remise d'une commande de particulier ═══════════════════════ */

/**
 * Particulier ou passager : la commande se remet en caisse contre le reste
 * (total − avance), réglé en totalité — pas de reliquat. Le montant est compté
 * dans la session de la caissière qui remet la commande.
 */
function DeliverModal({ order, onClose, onDelivered }: { order: OrderRow; onClose: () => void; onDelivered: () => void }) {
  const totalAmt = num(order.total);
  const advanceAmt = num(order.advance_amount);
  const remaining = Math.max(0, Math.round((totalAmt - advanceAmt) * 100) / 100);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [payment, setPayment] = useState<'cash' | 'card'>('cash');

  const deliverMutation = useMutation({
    mutationFn: () => ordersApi.deliver(order.id as string, { amountPaid: parseFloat(amount) || 0, paymentMethod: payment }),
    onSuccess: () => { notify.success('Commande remise au client, solde encaissé'); onDelivered(); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la remise')),
  });

  const paid = parseFloat(amount) || 0;
  const short = remaining - paid > 0.004;
  const change = payment === 'cash' ? Math.max(0, paid - remaining) : 0;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Truck size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Remise au client</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{order.order_number as string} · {customerName(order)}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={sectionStyle}>
            <div className="odoo-section-header"><Banknote size={11} /> Solde de la commande</div>
            <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total commande</span><span style={{ fontWeight: 600 }}>{n(totalAmt)} DH</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}><span>Avance déjà versée</span><span style={{ fontWeight: 600 }}>{n(advanceAmt)} DH</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                <span>Reste à encaisser</span><span style={{ color: '#b85d1a' }}>{n(remaining)} DH</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Montant reçu (DH)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={remaining} step="0.01" autoFocus
                style={{ ...fieldStyle, textAlign: 'right', fontWeight: 700, fontSize: '1rem' }} />
            </div>
            <div>
              <label style={labelStyle}>Mode de paiement</label>
              <div className="odoo-view-switcher" role="radiogroup" style={{ width: '100%' }}>
                {([['cash', 'Espèces', Banknote], ['card', 'Carte', CreditCard]] as const).map(([key, label, Icon]) => (
                  <button key={key} type="button" role="radio" aria-checked={payment === key} onClick={() => { setPayment(key); if (key === 'card') setAmount(remaining.toFixed(2)); }}
                    className={payment === key ? 'active' : ''} style={{ flex: 1, padding: '0.45rem 0.5rem', fontSize: '0.8125rem', gap: 4, fontWeight: payment === key ? 600 : 400 }}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {short ? (
            <StatusBanner tone="danger" icon={AlertTriangle} title={`Il manque ${n(remaining - paid)} DH`}>
              Le reste doit être réglé en totalité pour remettre la commande.
            </StatusBanner>
          ) : change > 0.004 ? (
            <StatusBanner tone="info" icon={Banknote} title={`Monnaie à rendre : ${n(change)} DH`} />
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary" disabled={deliverMutation.isPending}>Annuler</button>
          <button onClick={() => deliverMutation.mutate()} disabled={deliverMutation.isPending || short} className="odoo-btn-primary">
            {deliverMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Encaisser {n(remaining)} DH et remettre
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Livraison d'une commande de professionnel ═══════════════════════ */

/** Ouvre le PDF d'un bon de livraison (route authentifiée → blob). */
async function openDeliveryNotePdf(id: string) {
  try {
    const blob = await deliveryNotesApi.pdf(id);
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) {
    notify.error(getApiErrorMessage(e, 'Impression du bon de livraison impossible'));
  }
}

/**
 * Professionnel (direction) : pas d'encaissement. Un bon de livraison est créé
 * avec les quantités réellement livrées et le nom du réceptionnaire, à imprimer
 * et faire signer. Client facturé à chaque livraison → la facture suit aussitôt.
 */
function ProDeliverModal({ order, onClose, onDelivered }: { order: OrderRow; onClose: () => void; onDelivered: () => void }) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['delivery-notes', 'order-lines', order.id],
    queryFn: () => deliveryNotesApi.orderLines(order.id as string),
  });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [receivedBy, setReceivedBy] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const perDelivery = order.billing_frequency === 'per_delivery';

  const [closeRemainder, setCloseRemainder] = useState(false);
  // Crédit bloqué à l'expédition (O2C L3) : la direction peut déroger en motivant.
  const [creditBlock, setCreditBlock] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // Par défaut : le reste à livrer de chaque ligne (O2C L2, livraisons partielles).
  const qtyOf = (l: { id: string; remaining: string }) => (qty[l.id] !== undefined ? parseFloat(qty[l.id]) || 0 : num(l.remaining));
  const totals = lines.reduce((acc, l) => {
    const ht = qtyOf(l) * num(l.unit_price);
    return { ht: acc.ht + ht, tva: acc.tva + Math.round(ht * num(l.tva_rate)) / 100 };
  }, { ht: 0, tva: 0 });
  const short = lines.some(l => qtyOf(l) + 0.0001 < num(l.remaining));
  const changed = lines.some(l => Math.abs(qtyOf(l) - num(l.remaining)) > 0.0001);
  const alreadyDelivered = lines.some(l => num(l.qty_delivered) > 0);

  const mutation = useMutation({
    mutationFn: () => deliveryNotesApi.createFromOrder(order.id as string, {
      quantities: Object.fromEntries(lines.map(l => [l.id, qtyOf(l)])),
      receivedByName: receivedBy.trim() || undefined,
      deliveryDate,
      closeRemainder: short && closeRemainder,
      creditOverrideReason: creditBlock && overrideReason.trim().length >= 3 ? overrideReason.trim() : undefined,
    }),
    onSuccess: (note) => {
      if ((note as { closed?: boolean }).closed) { notify.success('Reliquat soldé : commande terminée'); onDelivered(); return; }
      notify.success(note.invoice
        ? `Bon de livraison ${note.number} et facture ${note.invoice.invoice_number} créés`
        : `Bon de livraison ${note.number} créé : à facturer en fin de mois`);
      openDeliveryNotePdf(note.id);
      onDelivered();
    },
    onError: (e: unknown) => {
      const code = (e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code;
      if (code === 'CREDIT_BLOCKED') { setCreditBlock(getApiErrorMessage(e, 'Crédit bloqué')); return; }
      notify.error(getApiErrorMessage(e, 'Création du bon de livraison impossible'));
    },
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 640, maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Truck size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Livraison sur bon de livraison</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{order.order_number as string} · {customerName(order)}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <StatusBanner tone="info" icon={FileText}
            title={perDelivery ? 'Facturé à chaque livraison : la facture est créée avec le BL' : 'Facturation mensuelle : le BL rejoint « À facturer »'}>
            Aucun encaissement : le règlement de la facture est saisi par la direction. Imprimez le BL et faites-le signer à la livraison.
          </StatusBanner>

          <div style={sectionStyle}>
            <div className="odoo-section-header"><Package size={11} /> Quantités livrées</div>
            {isLoading ? (
              <div style={{ padding: '1rem', textAlign: 'center' }}><Loader2 size={16} className="animate-spin" /></div>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th style={{ textAlign: 'right' }}>Commandé</th>
                    {alreadyDelivered && <th style={{ textAlign: 'right' }}>Déjà livré</th>}
                    <th style={{ textAlign: 'right', width: 110 }}>À livrer</th>
                    <th style={{ textAlign: 'right' }}>P.U. HT</th>
                    <th style={{ textAlign: 'right' }}>TVA</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} style={{ cursor: 'default' }}>
                      <td style={{ fontWeight: 500 }}>{l.description}</td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{num(l.quantity)}</td>
                      {alreadyDelivered && <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{num(l.qty_delivered)}</td>}
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" min="0" step="0.01" value={qty[l.id] ?? String(num(l.remaining))}
                          onChange={e => setQty({ ...qty, [l.id]: e.target.value })}
                          style={{ ...fieldStyle, width: 90, textAlign: 'right', fontWeight: 600 }} />
                      </td>
                      <td style={{ textAlign: 'right' }}>{n(num(l.unit_price))}</td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{l.tva_rate != null ? `${num(l.tva_rate)} %` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {changed && (
            <StatusBanner tone="warning" icon={AlertTriangle} title={short ? 'Livraison partielle' : 'Quantités différentes de la commande'}>
              La facture portera les quantités livrées.{short && ' Le reste demeure à livrer sur un prochain bon, sauf si vous soldez le reliquat.'}
            </StatusBanner>
          )}
          {creditBlock && (
            <StatusBanner tone="danger" icon={AlertTriangle} title="Expédition bloquée par le contrôle de crédit">
              {creditBlock}
              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>Motif de la dérogation (direction)</label>
                <input type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} maxLength={500}
                  placeholder="Ex. règlement promis vendredi, accord du gérant" style={fieldStyle} />
              </div>
            </StatusBanner>
          )}
          {short && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
              <input type="checkbox" checked={closeRemainder} onChange={e => setCloseRemainder(e.target.checked)} />
              Solder le reliquat : rien d'autre ne sera livré, la commande est terminée
            </label>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Date de livraison</label>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Reçu par (nom du réceptionnaire)</label>
              <input type="text" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Facultatif, sinon à remplir sur le BL" style={fieldStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: '0.8125rem' }}>
            <span>HT <strong>{n(totals.ht)} DH</strong></span>
            <span>TVA <strong>{n(totals.tva)} DH</strong></span>
            <span>TTC <strong>{n(totals.ht + totals.tva)} DH</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary" disabled={mutation.isPending}>Annuler</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || isLoading || (totals.ht <= 0 && !(short && closeRemainder)) || (!!creditBlock && overrideReason.trim().length < 3)} className="odoo-btn-primary">
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
            {creditBlock ? 'Déroger et livrer' : perDelivery ? 'Livrer, facturer et imprimer le BL' : 'Livrer et imprimer le BL'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Report de la date de retrait ═══════════════════════ */

/**
 * Le client prévient au moins 24 h avant le retrait : report libre. À moins de
 * 24 h, seule la direction peut forcer le report, avec un motif.
 */
function RescheduleModal({ order, isDirection, onClose, onDone }: { order: OrderRow; isDirection: boolean; onClose: () => void; onDone: () => void }) {
  const current = order.pickup_date ? new Date(order.pickup_date as string) : null;
  const hoursLeft = current ? (current.getTime() - Date.now()) / 3_600_000 : Infinity;
  const late = hoursLeft < 24;
  const [date, setDate] = useState(format(new Date(Date.now() + 2 * 86_400_000), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const blocked = late && !isDirection;

  const mutation = useMutation({
    mutationFn: () => ordersApi.reschedule(order.id as string, { newPickupDate: `${date}T12:00:00`, reason: reason.trim() || undefined }),
    onSuccess: () => { notify.success(`Retrait reporté au ${format(new Date(`${date}T12:00:00`), 'dd MMM yyyy', { locale: fr })}`); onDone(); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Report impossible')),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CalendarClock size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Reporter le retrait</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{order.order_number as string} · prévu le {fmtDate(order.pickup_date)}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {late ? (
            <StatusBanner tone={blocked ? 'danger' : 'warning'} icon={AlertTriangle} title="Moins de 24 h avant le retrait">
              {blocked ? 'Seule la direction peut encore reporter cette commande.' : 'Report forcé par la direction : le motif est obligatoire.'}
            </StatusBanner>
          ) : (
            <StatusBanner tone="info" icon={CalendarDays} title="Report possible">
              Le client prévient au moins 24 h avant le retrait. La production liée est décalée d'autant.
            </StatusBanner>
          )}
          <div>
            <label style={labelStyle}>Nouvelle date de retrait</label>
            <input type="date" value={date} min={format(new Date(), 'yyyy-MM-dd')} onChange={e => setDate(e.target.value)} style={fieldStyle} disabled={blocked} />
          </div>
          <div>
            <label style={labelStyle}>Motif{late ? ' (obligatoire)' : ''}</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Appel du client, imprévu…" style={fieldStyle} disabled={blocked} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          <button onClick={() => mutation.mutate()} className="odoo-btn-primary"
            disabled={blocked || mutation.isPending || !date || (late && !reason.trim())}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />} Reporter
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
