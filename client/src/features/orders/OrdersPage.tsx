import { isAccountType, orderKindLabel } from '../../hooks/useCommercialTypes';
import { money, currencySymbol } from '../../utils/money';
import { useState, useMemo } from 'react';
import { usePermissions } from '../../context/PermissionsContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { format, startOfDay, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { StageProgress, SelectFilter, type StageDef } from '../../components/purchasing/ProcessBoard';
import {
  ClipboardList, Plus, Pencil, Eye,
  Clock, CheckCircle2, Factory, Truck, Ban, CalendarDays,
  Banknote, CreditCard, Package, PackageCheck, FileText,
  AlertTriangle, Trash2, Tag, Building2, CalendarClock, List, SquareKanban, Columns3,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import OrderFormModal from '../../components/orders/OrderFormModal';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi } from '../sales/ListTemplate';
import { Toolbar, SearchBar, Segmented, DataPanel, BulkBar, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, Modal, FormField, FormSection, FormFooter } from '../../components/ds';
import { OrderList, OrderPane, OrderPaneEmpty, OrderStatusTag } from './OrderSplit';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
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

export const TYPE_LABELS: Record<string, string> = { custom: 'Sur mesure', online: 'En ligne', event: 'Événement', staff: 'Personnel' };

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

export function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function num(v: unknown) { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; }
/** Client professionnel (fiche non « particulier ») : processus direction, BL et facture (mig 354). */
/** Commande d'un client en compte : comportement du type de client (mig 701), calculé par le serveur. */
export function isPro(o: OrderRow) { return !!(o.customer_on_account ?? (!!o.customer_type && isAccountType(o.customer_type))); }
export function customerName(o: OrderRow) {
  if (isPro(o) && o.company_name) return o.company_name as string;
  return o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}`.trim() : '—';
}
/** Suivi Livrée → Facturée → Payée d'une commande de professionnel. */
function proBilling(o: OrderRow): { label: string; tone: StatusTone; icon?: LucideIcon; doc?: string } {
  if (o.invoice_status === 'paid') return { label: 'Payée', tone: 'done', doc: o.invoice_number as string };
  if (o.invoice_number) return { label: 'Facturée', tone: 'progress', icon: FileText, doc: o.invoice_number as string };
  if (o.delivery_note_number) return { label: 'Livrée · à facturer', tone: 'todo', icon: FileText, doc: o.delivery_note_number as string };
  return { label: 'Sur facture', tone: 'draft', icon: FileText };
}
export const CAN_RESCHEDULE = new Set(['pending', 'confirmed', 'in_production', 'ready']);
export function fmtDate(d: unknown, pattern = 'dd MMM yyyy') {
  return d ? format(new Date(String(d)), pattern, { locale: fr }) : '—';
}
/** Commande en cours dont la date de retrait est dépassée. */
export function isLate(o: OrderRow, today: Date) {
  if (!OPEN_STATUSES.has(o.status as string) || !o.pickup_date) return false;
  return startOfDay(new Date(o.pickup_date as string)) < today;
}

/** Jours de retard sur la date de retrait. */
export function daysLate(o: OrderRow, today: Date) {
  return o.pickup_date ? differenceInCalendarDays(today, startOfDay(new Date(o.pickup_date as string))) : 0;
}
export const CAN_CANCEL = new Set(['pending', 'confirmed', 'in_production']);
/** Étape suivante sans saisie (la livraison, elle, ouvre sa fenêtre). */
export const NEXT_STEP: Record<string, { to: string; label: string; icon: LucideIcon }> = {
  pending: { to: 'confirmed', label: 'Confirmer', icon: CheckCircle2 },
  confirmed: { to: 'in_production', label: 'Lancer', icon: Factory },
  in_production: { to: 'ready', label: 'Marquer prête', icon: PackageCheck },
};
/**
 * Audit des profils (L4) : sans module Production, pas d'étape « en production » — une commande
 * confirmée se prépare et passe directement à « prête ».
 */
export function orderNextStep(status: string, productionOn: boolean) {
  if (!productionOn && status === 'confirmed') return { to: 'ready', label: 'Marquer prête', icon: PackageCheck };
  return NEXT_STEP[status];
}
const BULK_STEPS = [
  { from: 'pending', to: 'confirmed', label: 'Confirmer' },
  { from: 'confirmed', to: 'in_production', label: 'Lancer en production' },
  { from: 'in_production', to: 'ready', label: 'Marquer prêtes' },
];
/** Couleur des colonnes = règle commune de StatusTag (gris brouillon, bleu en cours, ambre à remettre, vert terminé). */
const LANE_TONE: Record<string, string> = { pending: 'grey', confirmed: 'blue', in_production: 'blue', ready: 'orange', partially_delivered: 'blue', completed: 'green', cancelled: 'grey' };


/* ═══════════════════════ Page ═══════════════════════ */

export default function OrdersPage() {
  const productionOn = usePermissions().moduleActive('production');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [rescheduleOrder, setRescheduleOrder] = useState<OrderRow | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // ?filter=late : lien « À traiter » du tableau de bord.
  const [lateOnly, setLateOnly] = useState(() => new URLSearchParams(window.location.search).get('filter') === 'late');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<OrderRow | null>(null);
  const [prepayOrder, setPrepayOrder] = useState<OrderRow | null>(null);
  // Design System : Tableau par défaut ; Colonnes (liste + fiche) et Kanban au choix.
  const [view, setView] = useState<'split' | 'list' | 'kanban'>('list');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Les bons de livraison ont leur propre écran (/delivery-notes), séparé des commandes
  // comme dans les ERP standards : cette page ne gère plus que les commandes clients.

  // Une seule lecture : les compteurs du pipeline et la liste partagent la même source,
  // le filtrage par statut se fait côté client (le serveur pagine à 20 par défaut).
  const { data, isLoading, isError, error, refetch } = useQuery({
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
  const resetFilters = () => { setStatusFilter(''); setTypeFilter(''); setLateOnly(false); setSearchQuery(''); };

  const cancelOrder = async (o: OrderRow) => {
    const adv = num(o.advance_amount);
    const msg = adv > 0
      ? `Annuler la commande ${o.order_number} ? L'avance de ${money(adv)} reste acquise : elle n'est pas remboursée.`
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
    const step = orderNextStep(s, productionOn);
    if (step) return { label: step.label, icon: step.icon, run: () => updateStatusMutation.mutate({ id: o.id as string, status: step.to }) };
    if (s === 'ready') return { label: isPro(o) ? 'Livrer' : 'Remettre', icon: Truck, run: () => setDeliverOrder(o) };
    if (s === 'partially_delivered' && isPro(o)) return { label: 'Livrer le reliquat', icon: Truck, run: () => setDeliverOrder(o) };
    return null;
  };
  const menuItems = (o: OrderRow): RowMenuItem[] => {
    const s = o.status as string;
    const items: RowMenuItem[] = [{ label: 'Voir le détail', icon: Eye, onSelect: () => navigate(`/orders/${o.id as string}`) }];
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
    if (orderNextStep(from, productionOn)?.to === stage) { updateStatusMutation.mutate({ id, status: stage }); return; }
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
      return <><StatusTag tone={b.tone} icon={b.icon} label={b.label} />{b.doc && <span className="sal-sub sal-mono">{b.doc}</span>}</>;
    }
    if (status === 'cancelled') return <span className="sal-sub">{advanceAmt > 0 ? `avance de ${money(advanceAmt)} conservée` : '—'}</span>;
    if (status === 'completed') return <StatusTag tone="done" label="Soldée" />;
    if (advanceAmt > 0) return <><StatusTag tone="progress" icon={Banknote} label={`Avance ${n(advanceAmt)}`} /><span className="sal-sub">reste {money(remaining)}</span></>;
    return <span className="sal-sub">au retrait</span>;
  };

  const openTotal = orders.filter(o => OPEN_STATUSES.has(o.status as string)).reduce((s, o) => s + num(o.total), 0);
  const kanbanStages = STAGES.filter(st => st.key !== 'completed' && (productionOn || st.key !== 'in_production'));
  // Tuiles : chiffres que les pastilles ne donnent pas (retrait du jour, argent à encaisser, à facturer).
  const kpis = useMemo(() => {
    const k = { todayCount: 0, weekCount: 0, toCollect: 0, advances: 0, toInvoiceCount: 0, toInvoice: 0 };
    for (const o of orders) {
      const st = o.status as string;
      if (OPEN_STATUSES.has(st)) {
        const d = o.pickup_date ? differenceInCalendarDays(startOfDay(new Date(o.pickup_date as string)), today) : null;
        if (d === 0) k.todayCount++;
        if (d != null && d >= 0 && d <= 7) k.weekCount++;
        if (!isPro(o)) { k.toCollect += Math.max(0, num(o.total) - num(o.advance_amount)); k.advances += num(o.advance_amount); }
      }
      if (isPro(o) && st !== 'cancelled' && proBilling(o).label === 'Livrée · à facturer') { k.toInvoiceCount++; k.toInvoice += num(o.total); }
    }
    return k;
  }, [orders, today]);

  return (
    <SalesPageShell icon={ClipboardList} parent="Ventes" title="Commandes" list
      summary={`${openCount} en cours · ${money(openTotal)}`}
      actions={<button onClick={() => setShowForm(true)} className="odoo-btn-primary"><Plus size={13} /> Nouvelle commande</button>}>
        {view !== 'split' && <section className="prj-kpis" aria-label="Indicateurs">
          <ListKpi label="Commandes en cours" value={String(openCount)} sub={`${money(openTotal)}`} />
          <ListKpi label="À retirer aujourd'hui" value={String(kpis.todayCount)} sub={`${kpis.weekCount} d'ici 7 jours`} />
          <ListKpi label="Reste à encaisser" value={`${money(kpis.toCollect)}`} sub={`avances reçues ${money(kpis.advances)}`} />
          <ListKpi label="Livrées à facturer" value={String(kpis.toInvoiceCount)} sub={`${money(kpis.toInvoice)}`} tone={kpis.toInvoiceCount ? 'orange' : undefined} />
        </section>}

        <div className="prj-chips" role="group" aria-label="Filtrer par étape">
          {FILTER_CHIPS.filter(c => productionOn || c.key !== 'in_production').flatMap((chip) => {
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

        <Toolbar>
          <SearchBar value={searchQuery} onChange={setSearchQuery} label="Rechercher une commande" placeholder="N° de commande, client ou téléphone…" />
          {typeOptions.length > 1 && (
            <SelectFilter label="Type" icon={Tag} value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="Tous les types" />
          )}
          <Segmented label="Affichage" value={view} onChange={setView} options={[
            { key: 'list', label: 'Tableau', icon: List },
            { key: 'split', label: 'Colonnes', icon: Columns3 },
            { key: 'kanban', label: 'Kanban', icon: SquareKanban },
          ]} />
        </Toolbar>

        {isLoading ? (
          <LoadingState label="Chargement des commandes…" />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : filteredOrders.length === 0 && view !== 'kanban' ? (
          hasFilters
            ? <NoResultState onReset={resetFilters} text="Aucune commande ne correspond aux filtres." />
            : <EmptyState icon={ClipboardList} title="Aucune commande" text="Les commandes des clients apparaîtront ici, du brouillon jusqu'à la livraison."
                action={<button type="button" onClick={() => setShowForm(true)} className="odoo-btn-secondary ds-btn-sm"><Plus size={13} /> Nouvelle commande</button>} />
        ) : view === 'split' ? (
          (() => {
            const active = filteredOrders.find(o => o.id === activeId) ?? filteredOrders[0];
            return (
              <div className="ord-split">
                <OrderList orders={filteredOrders} activeId={active?.id as string ?? null} onPick={setActiveId} />
                {active ? <OrderPane key={active.id as string} row={active} next={nextAction(active)} menu={menuItems(active)} busy={busy} /> : <OrderPaneEmpty />}
              </div>
            );
          })()
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
                    <small className="sal-lane-sum">{cards.length} · {money(sum)}</small>
                  </div>
                  {!cards.length && <div className="prj-lane-empty">Aucune commande</div>}
                  {cards.map(o => {
                    const late = isLate(o, today);
                    return (
                      <button key={o.id as string} type="button" className="prj-task" draggable
                        onDragStart={e => { e.dataTransfer.setData('text/plain', o.id as string); e.dataTransfer.effectAllowed = 'move'; }}
                        onClick={() => navigate(`/orders/${o.id as string}`)} title="Cliquer pour ouvrir · glisser vers l'étape suivante">
                        <span className="prj-card-num">{o.order_number as string}</span>
                        <span className="prj-task-title">{customerName(o)}</span>
                        <span className="prj-task-meta">
                          <span style={{ flex: 1 }}>Retrait <span className={late ? 'late' : ''}>{fmtDate(o.pickup_date, 'd MMM')}</span>{late ? ` · ${daysLate(o, today)} j de retard` : ''}</span>
                          <span className="sal-amount">{money(num(o.total))}</span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        ) : (
          <DataPanel label="Commandes"
            bulk={(
              <BulkBar count={selectedOrders.length} noun="commande" detail={money(selectedOrders.reduce((sum, o) => sum + num(o.total), 0))} onClear={() => setSelected(new Set())}>
                {BULK_STEPS.filter(b => productionOn || (b.to !== 'in_production' && b.from !== 'in_production')).map(b => {
                  const eligible = selectedOrders.filter(o => o.status === b.from).map(o => o.id as string);
                  if (!eligible.length) return null;
                  return (
                    <button key={b.to} type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => bulkMutation.mutate({ ids: eligible, status: b.to })}>
                      {b.label} ({eligible.length})
                    </button>
                  );
                })}
                {selectedOrders.some(o => CAN_CANCEL.has(o.status as string)) && (
                  <button type="button" className="ds-btn-danger ds-btn-sm" disabled={busy} onClick={bulkCancel}>Annuler les commandes</button>
                )}
              </BulkBar>
            )}
            footer={<TableFooter note={<>{filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}{hasFilters ? ' (filtrées)' : ''} · total affiché <strong>{money(filteredTotal)} TTC</strong></>} />}>
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
                        <th className="ds-num">Total TTC ({currencySymbol()})</th>
                        <th>Règlement</th>
                        <th className="ds-actions">Actions</th>
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
                          <tr key={id} onClick={() => navigate(`/orders/${o.id as string}`)} className={isSel ? 'ds-selected' : undefined} style={{ cursor: 'pointer' }}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" className="sal-check" checked={isSel} onChange={() => toggleOne(id)} aria-label={`Sélectionner ${o.order_number as string}`} />
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}><span className="ds-ref">{o.order_number as string}</span></td>
                            <td>
                              <span className="ds-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {isPro(o) && <Building2 size={12} style={{ color: 'var(--ds-muted)' }} aria-hidden="true" />}
                                {customerName(o)}
                              </span>
                              <span className="sal-sub">
                                {orderKindLabel(o.order_kind as string | null) ?? `${isPro(o) ? 'Professionnel' : 'Particulier'}${o.type && TYPE_LABELS[o.type as string] ? ` · ${TYPE_LABELS[o.type as string]}` : ''}`}
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
                            <td><OrderStatusTag status={status} /></td>
                            <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{n(num(o.total))}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{paymentCell(o)}</td>
                            <td className="ds-actions" onClick={e => e.stopPropagation()}>
                              {next && (
                                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={next.run}>
                                  <next.icon size={13} /> {next.label}
                                </button>
                              )}
                              <RowMenu items={menuItems(o)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
          </DataPanel>
        )}

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
    </SalesPageShell>
  );
}

/* ═══════════════════════ Facture d'acompte (phase 5.4) ═══════════════════════ */

export function PrepaymentModal({ order, onClose, onDone }: { order: OrderRow; onClose: () => void; onDone: () => void }) {
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
    <Modal title="Facture d'acompte" subtitle={`${order.order_number as string} · total ${money(total)}`} onClose={onClose} width={440} locked={mutation.isPending}
      footer={<FormFooter onCancel={onClose} cancelLabel="Fermer" onSubmit={() => mutation.mutate()} submitLabel="Émettre l'acompte" disabled={!(pct > 0)} busy={mutation.isPending} />}>
      <StatusBanner tone="info" icon={FileText} title="Pièce numérotée (série FA)">
        L'acompte est une vraie facture, avec TVA, déduite ensuite de la facture finale de la commande.
      </StatusBanner>
      <FormField label="Pourcentage de l'acompte" htmlFor="pp-percent" required hint={<>Soit <strong>{money(amount)}</strong> TTC.</>}>
        <input id="pp-percent" type="number" min={1} max={100} value={percent} onChange={e => setPercent(e.target.value)} className="ds-input" style={{ width: 120 }} />
      </FormField>
    </Modal>
  );
}

/* La fiche commande est une page : OrderRecordPage.tsx (route /orders/:id). */

/* ═══════════════════════ Remise d'une commande de particulier ═══════════════════════ */

/**
 * Particulier ou passager : la commande se remet en caisse contre le reste
 * (total − avance), réglé en totalité — pas de reliquat. Le montant est compté
 * dans la session de la caissière qui remet la commande.
 */
export function DeliverModal({ order, onClose, onDelivered }: { order: OrderRow; onClose: () => void; onDelivered: () => void }) {
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
    <Modal title="Remise au client" subtitle={`${order.order_number as string} · ${customerName(order)}`} onClose={onClose} width={460} locked={deliverMutation.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => deliverMutation.mutate()} submitLabel={`Encaisser ${money(remaining)} et remettre`} disabled={short} busy={deliverMutation.isPending} />}>
      <FormSection title="Solde de la commande">
        <table className="ds-summary" aria-label="Solde de la commande">
          <tbody>
            <tr><td>Total commande ({currencySymbol()})</td><td className="ds-num ds-strong">{n(totalAmt)}</td></tr>
            <tr><td style={{ color: 'var(--ds-success)' }}>Avance déjà versée ({currencySymbol()})</td><td className="ds-num ds-strong" style={{ color: 'var(--ds-success)' }}>{n(advanceAmt)}</td></tr>
            <tr><td className="ds-strong">Reste à encaisser ({currencySymbol()})</td><td className="ds-num ds-strong" style={{ color: 'var(--ds-warning)' }}>{n(remaining)}</td></tr>
          </tbody>
        </table>
      </FormSection>

      <FormSection title="Encaissement">
        <div className="ds-form-grid">
          <FormField label={`Montant reçu (${currencySymbol()})`} htmlFor="dlv-amount" required error={short ? `Il manque ${money(remaining - paid)}.` : undefined}>
            <input id="dlv-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={remaining} step="0.01" autoFocus
              className="ds-input" style={{ textAlign: 'right', fontWeight: 700 }} />
          </FormField>
          <div className="ds-field">
            <span id="dlv-method-label" className="ds-field-label">Mode de paiement</span>
            <div className="odoo-view-switcher" role="radiogroup" aria-labelledby="dlv-method-label" style={{ width: '100%' }}>
              {([['cash', 'Espèces', Banknote], ['card', 'Carte', CreditCard]] as const).map(([key, label, Icon]) => (
                <button key={key} type="button" role="radio" aria-checked={payment === key} onClick={() => { setPayment(key); if (key === 'card') setAmount(remaining.toFixed(2)); }}
                  className={payment === key ? 'active' : ''} style={{ flex: 1, padding: '0.45rem 0.5rem', fontSize: '13px', gap: 4, fontWeight: payment === key ? 600 : 400 }}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {short ? (
          <StatusBanner tone="danger" icon={AlertTriangle} title={`Il manque ${money(remaining - paid)}`}>
            Le reste doit être réglé en totalité pour remettre la commande.
          </StatusBanner>
        ) : change > 0.004 ? (
          <StatusBanner tone="info" icon={Banknote} title={`Monnaie à rendre : ${money(change)}`} />
        ) : null}
      </FormSection>
    </Modal>
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
export function ProDeliverModal({ order, onClose, onDelivered }: { order: OrderRow; onClose: () => void; onDelivered: () => void }) {
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
    <Modal title="Livraison sur bon de livraison" subtitle={`${order.order_number as string} · ${customerName(order)}`} onClose={onClose} width={640} locked={mutation.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => mutation.mutate()}
        submitLabel={creditBlock ? 'Déroger et livrer' : perDelivery ? 'Livrer, facturer et imprimer le BL' : 'Livrer et imprimer le BL'}
        disabled={isLoading || (totals.ht <= 0 && !(short && closeRemainder)) || (!!creditBlock && overrideReason.trim().length < 3)}
        busy={mutation.isPending} />}>
      <StatusBanner tone="info" icon={FileText}
        title={perDelivery ? 'Facturé à chaque livraison : la facture est créée avec le BL' : 'Facturation mensuelle : le BL rejoint « À facturer »'}>
        Aucun encaissement : le règlement de la facture est saisi par la direction. Imprimez le BL et faites-le signer à la livraison.
      </StatusBanner>

      <FormSection title="Quantités livrées">
        {isLoading ? (
          <LoadingState bare />
        ) : (
          <DataPanel label="Quantités livrées">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="ds-num">Commandé</th>
                  {alreadyDelivered && <th className="ds-num">Déjà livré</th>}
                  <th className="ds-num" style={{ width: 110 }}>À livrer</th>
                  <th className="ds-num">P.U. HT ({currencySymbol()})</th>
                  <th className="ds-num">TVA</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id} style={{ cursor: 'default' }}>
                    <td className="ds-strong">{l.description}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{num(l.quantity)}</td>
                    {alreadyDelivered && <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{num(l.qty_delivered)}</td>}
                    <td className="ds-num">
                      <input type="number" min="0" step="0.01" value={qty[l.id] ?? String(num(l.remaining))} aria-label={`Quantité à livrer : ${l.description}`}
                        onChange={e => setQty({ ...qty, [l.id]: e.target.value })}
                        className="ds-input sm" style={{ width: 90, textAlign: 'right', fontWeight: 600 }} />
                    </td>
                    <td className="ds-num">{n(num(l.unit_price))}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{l.tva_rate != null ? `${num(l.tva_rate)} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
        {changed && (
          <StatusBanner tone="warning" icon={AlertTriangle} title={short ? 'Livraison partielle' : 'Quantités différentes de la commande'}>
            La facture portera les quantités livrées.{short && ' Le reste demeure à livrer sur un prochain bon, sauf si vous soldez le reliquat.'}
          </StatusBanner>
        )}
        {creditBlock && (
          <StatusBanner tone="danger" icon={AlertTriangle} title="Expédition bloquée par le contrôle de crédit">
            {creditBlock}
            <div style={{ marginTop: 8 }}>
              <FormField label="Motif de la dérogation (direction)" htmlFor="pdl-override" required
                error={overrideReason !== '' && overrideReason.trim().length < 3 ? 'Au moins 3 caractères.' : undefined}>
                <input id="pdl-override" type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} maxLength={500}
                  placeholder="Ex. règlement promis vendredi, accord du gérant" className="ds-input" />
              </FormField>
            </div>
          </StatusBanner>
        )}
        {short && (
          <label htmlFor="pdl-close" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px' }}>
            <input id="pdl-close" type="checkbox" checked={closeRemainder} onChange={e => setCloseRemainder(e.target.checked)} />
            Solder le reliquat : rien d'autre ne sera livré, la commande est terminée
          </label>
        )}
      </FormSection>

      <FormSection title="Livraison">
        <div className="ds-form-grid">
          <FormField label="Date de livraison" htmlFor="pdl-date" required>
            <input id="pdl-date" type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Reçu par (nom du réceptionnaire)" htmlFor="pdl-received">
            <input id="pdl-received" type="text" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Facultatif, sinon à remplir sur le BL" className="ds-input" />
          </FormField>
        </div>
        <table className="ds-summary" aria-label="Totaux">
          <tbody>
            <tr><td>HT ({currencySymbol()})</td><td className="ds-num ds-strong">{n(totals.ht)}</td></tr>
            <tr><td>TVA ({currencySymbol()})</td><td className="ds-num ds-strong">{n(totals.tva)}</td></tr>
            <tr className="ds-total"><td>TTC ({currencySymbol()})</td><td className="ds-num ds-strong">{n(totals.ht + totals.tva)}</td></tr>
          </tbody>
        </table>
      </FormSection>
    </Modal>
  );
}

/* ═══════════════════════ Report de la date de retrait ═══════════════════════ */

/**
 * Le client prévient au moins 24 h avant le retrait : report libre. À moins de
 * 24 h, seule la direction peut forcer le report, avec un motif.
 */
export function RescheduleModal({ order, isDirection, onClose, onDone }: { order: OrderRow; isDirection: boolean; onClose: () => void; onDone: () => void }) {
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
    <Modal title="Reporter le retrait" subtitle={`${order.order_number as string} · prévu le ${fmtDate(order.pickup_date)}`} onClose={onClose} width={440} locked={mutation.isPending}
      footer={<FormFooter onCancel={onClose} cancelLabel="Fermer" onSubmit={() => mutation.mutate()} submitLabel="Reporter"
        disabled={blocked || !date || (late && !reason.trim())} busy={mutation.isPending} />}>
      {late ? (
        <StatusBanner tone={blocked ? 'danger' : 'warning'} icon={AlertTriangle} title="Moins de 24 h avant le retrait">
          {blocked ? 'Seule la direction peut encore reporter cette commande.' : 'Report forcé par la direction : le motif est obligatoire.'}
        </StatusBanner>
      ) : (
        <StatusBanner tone="info" icon={CalendarDays} title="Report possible">
          Le client prévient au moins 24 h avant le retrait. La production liée est décalée d'autant.
        </StatusBanner>
      )}
      <FormField label="Nouvelle date de retrait" htmlFor="rs-date" required>
        <input id="rs-date" type="date" value={date} min={format(new Date(), 'yyyy-MM-dd')} onChange={e => setDate(e.target.value)} className="ds-input" disabled={blocked} />
      </FormField>
      <FormField label="Motif" htmlFor="rs-reason" required={late}>
        <input id="rs-reason" type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Appel du client, imprévu…" className="ds-input" disabled={blocked} />
      </FormField>
    </Modal>
  );
}
