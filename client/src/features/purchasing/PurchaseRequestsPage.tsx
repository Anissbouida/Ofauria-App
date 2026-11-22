import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { rfqApi } from '../../api/rfq.api';
import { suppliersApi } from '../../api/accounting.api';
import {
  ShoppingCart, ChevronDown, ChevronRight,
  X, Trash2, FileQuestion, AlertTriangle, Check, History,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiErrorMessage } from '../../api/errors';
import { PeriodFilter, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { FilterChips } from '../sales/ListTemplate';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { currencySymbol } from '../../utils/money';
import { RowMenu } from '../../components/ui/RowMenu';
import {
  Alert, BulkBar, DataPanel, EmptyState, ErrorState, FormField, KpiCard, KpiGrid, LoadingState, Modal, NoResultState,
  SearchBar, Segmented, TableFooter, Toolbar,
} from '../../components/ds';

const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Statuts calculés par la base depuis la couverture des lignes de BC (mig 305). */
const STATUS_INFO: Record<string, { label: string; tone: StatusTone; dot: string }> = {
  pending:   { label: 'À commander', tone: 'todo',      dot: 'warning' },
  assigned:  { label: 'Commandé',    tone: 'progress',  dot: 'neutral' },
  ordered:   { label: 'Commandé',    tone: 'progress',  dot: 'neutral' },
  received:  { label: 'Reçu',        tone: 'done',      dot: 'ok' },
  closed:    { label: 'Clôturé',     tone: 'done',      dot: 'neutral' },
  cancelled: { label: 'Annulé',      tone: 'cancelled', dot: 'neutral' },
};

/**
 * État de la DA (dimension séparée de la couverture). Flux procure-to-pay (mig 465) :
 * la DA est un besoin directement sourçable une fois validée — l'approbation des
 * achats se fait désormais sur le BC chiffré (devis retenu), plus sur la DA.
 * 'draft' = proposition MRP à activer ; 'approved' = prête à sourcer.
 * ('pending'/'rejected' : données héritées de l'ancien circuit d'approbation de DA.)
 */
const APPROVAL_INFO: Record<string, { label: string; tone: StatusTone }> = {
  draft:    { label: 'Proposition', tone: 'draft' },
  pending:  { label: 'À approuver', tone: 'todo' },
  approved: { label: 'Prête',       tone: 'done' },
  rejected: { label: 'Refusée',     tone: 'blocked' },
};
const isApproved = (s: string | undefined) => (s ?? 'approved') === 'approved';

type ReasonAction = { kind: 'cancel' | 'close'; id: string; label: string };

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  stock_bas: { label: 'Stock bas', color: 'bg-red-100 text-red-700' },
  production: { label: 'Production', color: 'bg-blue-100 text-blue-700' },
  manual: { label: 'Demande manuelle', color: 'bg-gray-100 text-gray-700' },
  replenishment: { label: 'Approvisionnement', color: 'bg-violet-100 text-violet-700' },
};

interface SupplierGroup {
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_contact: string | null;
  request_count: string;
  estimated_total: string;
  requests: {
    id: string;
    ingredient_id: string;
    ingredient_name: string;
    ingredient_unit: string;
    ingredient_unit_cost: string | null;
    ingredient_category: string;
    quantity: string;
    unit: string;
    reason: string;
    note: string | null;
    approval_status: string;
    requested_by_name: string;
    created_at: string;
  }[];
}

/** Ligne du tableau, commune aux vues « En attente » et « Historique ». */
interface Row {
  id: string; article: string; unit: string; qty: number; cost: number | null; reason: string; note: string | null;
  approval: string; requester: string; createdAt: string; supplierId: string; supplierName: string | null; status: string;
  /** Ligne d'historique brute (couverture, BC, traçabilité). */
  raw?: Record<string, any>;
}
/** Bloc de lignes ; `title` non nul = ligne de regroupement (fournisseur ou mois) avec sous-total. */
interface Section { key: string; title: string | null; small?: string; rows: Row[]; subtotal: number; group?: SupplierGroup }

export default function PurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // Présentation du tableau : une ligne par demande, ou regroupée par fournisseur (sous-totaux).
  const [layout, setLayout] = useState<'line' | 'supplier'>('supplier');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (key: string) => setCollapsed(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [selectedRequests, setSelectedRequests] = useState<Record<string, Set<string>>>({});
  const [viewMode, setViewMode] = useState<'grouped' | 'all'>('grouped');
  // Historique : « Tous » les statuts par défaut (on garde la trace des demandes traitées).
  const [statusFilter, setStatusFilter] = useState('');
  // Filtre de période de l'historique (sur la date de la demande).
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { data: groups = [], isLoading: groupsLoading, error: groupsError, refetch: refetchGroups } = useQuery({
    queryKey: ['purchase-requests-grouped'],
    queryFn: purchaseRequestsApi.grouped,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: suppliersApi.list,
  });

  const assignSupplierMutation = useMutation({
    mutationFn: ({ requestIds, supplierId }: { requestIds: string[]; supplierId: string }) =>
      purchaseRequestsApi.bulkAssignSupplier(requestIds, supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Fournisseur attribue');
    },
    onError: () => notify.error('Erreur lors de l\'attribution du fournisseur'),
  });

  const { data: allRequests = [], isLoading: allLoading, error: allError, refetch: refetchAll } = useQuery({
    queryKey: ['purchase-requests', statusFilter],
    queryFn: () => purchaseRequestsApi.list(statusFilter ? { status: statusFilter } : undefined),
    enabled: viewMode === 'all',
  });

  // Annuler (demande en attente) et clôturer le reliquat (demande commandée) exigent
  // un motif : ce sont des actions humaines définitives, journalisées en base.
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const reasonMutation = useMutation({
    mutationFn: ({ kind, id, reason }: { kind: 'cancel' | 'close'; id: string; reason: string }) =>
      kind === 'cancel' ? purchaseRequestsApi.cancel(id, reason) : purchaseRequestsApi.close(id, reason),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success(v.kind === 'cancel' ? 'Demande annulée' : 'Reliquat clôturé');
      setReasonAction(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Action impossible')),
  });

  // Sourcing obligatoire (mig 457) : une DA ne devient pas un BC directement — on
  // lance une demande de prix depuis les DA sélectionnées, et le BC naîtra de son
  // attribution (onglet 3 · Demandes de prix). L'approbation se fait ensuite sur le BC.
  const rfqMutation = useMutation({
    mutationFn: (requestIds: string[]) => rfqApi.createFromRequests(requestIds),
    onSuccess: (rfq) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      setSelectedRequests({});
      notify.success(`Demande de prix ${rfq.number} créée`);
      navigate('/purchasing?tab=rfq');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Création de l\'appel d\'offres impossible')),
  });

  // Activer une proposition (DA brouillon générée par le MRP, L6) : besoin validé,
  // directement sourçable (mig 465, plus d'approbation de DA).
  const submitMutation = useMutation({
    mutationFn: (id: string) => purchaseRequestsApi.submit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Proposition activée : prête à sourcer');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Soumission impossible')),
  });

  const filteredGroups = useMemo(() => {
    if (!search) return groups as SupplierGroup[];
    const q = search.toLowerCase();
    return (groups as SupplierGroup[]).filter(g =>
      (g.supplier_name || '').toLowerCase().includes(q) ||
      g.requests.some(r => r.ingredient_name.toLowerCase().includes(q))
    );
  }, [groups, search]);

  // Historique : filtre par période (date de demande) + recherche, trié décroissant (déjà trié côté serveur).
  const { dateFrom, dateTo } = periodParams(period, customFrom, customTo) as { dateFrom?: string; dateTo?: string };
  const historyRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (allRequests as Record<string, any>[]).filter(req => {
      const d = String(req.created_at ?? '').slice(0, 10);
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo && (!d || d > dateTo)) return false;
      if (!q) return true;
      return [req.ingredient_name, req.supplier_name, req.purchase_order_number, req.requested_by_name]
        .some(f => String(f ?? '').toLowerCase().includes(q));
    });
  }, [allRequests, dateFrom, dateTo, search]);

  const totalPending = (groups as SupplierGroup[]).reduce((s, g) => s + parseInt(g.request_count), 0);
  const totalSuppliers = (groups as SupplierGroup[]).length;
  const totalEstimated = (groups as SupplierGroup[]).reduce((s, g) => s + parseFloat(g.estimated_total || '0'), 0);

  const toggleSelectAll = (supplierId: string, requests: SupplierGroup['requests']) => {
    const key = supplierId || '__none__';
    // Seules les DA approuvées peuvent rejoindre un BC (flux procure-to-pay).
    const selectable = requests.filter(r => isApproved(r.approval_status));
    const current = selectedRequests[key] || new Set();
    if (current.size === selectable.length && selectable.length > 0) {
      setSelectedRequests({ ...selectedRequests, [key]: new Set() });
    } else {
      setSelectedRequests({ ...selectedRequests, [key]: new Set(selectable.map(r => r.id)) });
    }
  };

  const toggleSelect = (supplierId: string, requestId: string) => {
    const key = supplierId || '__none__';
    const current = new Set(selectedRequests[key] || []);
    if (current.has(requestId)) current.delete(requestId);
    else current.add(requestId);
    setSelectedRequests({ ...selectedRequests, [key]: current });
  };

  const getSelectedForSupplier = (supplierId: string) => {
    return selectedRequests[supplierId || '__none__'] || new Set<string>();
  };

  // ── Présentation (Design System) : lignes normalisées, regroupées selon la bascule ──
  const pendingView = viewMode === 'grouped';
  const rowCost = (qty: unknown, unitCost: unknown) => (unitCost ? (parseFloat(String(qty)) || 0) * (parseFloat(String(unitCost)) || 0) : null);
  const pendingRows: Row[] = filteredGroups.flatMap(g => g.requests.map(r => ({
    id: r.id, article: r.ingredient_name, unit: r.ingredient_unit, qty: parseFloat(r.quantity) || 0,
    cost: rowCost(r.quantity, r.ingredient_unit_cost), reason: r.reason, note: r.note, approval: r.approval_status,
    requester: r.requested_by_name, createdAt: r.created_at, supplierId: g.supplier_id || '', supplierName: g.supplier_name, status: 'pending',
  })));
  const historyList: Row[] = historyRows.map(r => ({
    id: r.id as string, article: r.ingredient_name as string, unit: (r.ingredient_unit as string) ?? '', qty: parseFloat(r.quantity as string) || 0,
    cost: rowCost(r.quantity, r.ingredient_unit_cost), reason: r.reason as string, note: (r.note as string) ?? null, approval: r.approval_status as string,
    requester: r.requested_by_name as string, createdAt: r.created_at as string, supplierId: (r.supplier_id as string) || '', supplierName: (r.supplier_name as string) || null,
    status: r.status as string, raw: r,
  }));
  const countLabel = (n: number) => `${n} demande${n > 1 ? 's' : ''}`;
  const sumCost = (rows: Row[]) => rows.reduce((s, r) => s + (r.cost ?? 0), 0);

  let sections: Section[];
  if (pendingView && layout === 'supplier') {
    sections = filteredGroups.map(g => ({
      key: g.supplier_id || '__none__', title: g.supplier_name || 'Sans fournisseur',
      small: [countLabel(parseInt(g.request_count)), g.supplier_contact, g.supplier_phone].filter(Boolean).join(' · '),
      rows: pendingRows.filter(r => r.supplierId === (g.supplier_id || '')), subtotal: parseFloat(g.estimated_total || '0'), group: g,
    }));
  } else if (pendingView) {
    sections = [{ key: 'all', title: null, rows: pendingRows, subtotal: 0 }];
  } else if (layout === 'supplier') {
    const map = new Map<string, Row[]>();
    for (const r of historyList) { const k = r.supplierName || 'Sans fournisseur'; map.set(k, [...(map.get(k) ?? []), r]); }
    sections = Array.from(map, ([k, rows]) => ({ key: k, title: k, small: countLabel(rows.length), rows, subtotal: sumCost(rows) }));
  } else {
    // Historique par ligne : regroupement par mois de la demande (liste triée par le serveur).
    sections = [];
    for (const r of historyList) {
      const k = String(r.createdAt ?? '').slice(0, 7);
      const last = sections[sections.length - 1];
      if (last && last.key === k) { last.rows.push(r); last.subtotal += r.cost ?? 0; continue; }
      const m = r.createdAt ? format(new Date(r.createdAt), 'MMMM yyyy', { locale: fr }) : '—';
      sections.push({ key: k, title: m.charAt(0).toUpperCase() + m.slice(1), rows: [r], subtotal: r.cost ?? 0 });
    }
    for (const sct of sections) sct.small = countLabel(sct.rows.length);
  }
  const shownRows = pendingView ? pendingRows : historyList;
  const grandTotal = pendingView ? filteredGroups.reduce((s, g) => s + parseFloat(g.estimated_total || '0'), 0) : sumCost(historyList);

  // Sélection (vue « En attente » seulement) : seules les demandes prêtes sont sélectionnables.
  const selectableIds = pendingRows.filter(r => isApproved(r.approval)).map(r => r.id);
  const selectedIds = Object.values(selectedRequests).flatMap(set => Array.from(set));
  const allChecked = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  const toggleAll = () => {
    if (allChecked) { setSelectedRequests({}); return; }
    setSelectedRequests(Object.fromEntries(filteredGroups.map(g => [g.supplier_id || '__none__', new Set(g.requests.filter(r => isApproved(r.approval_status)).map(r => r.id))])));
  };
  const noSupplierGroup = pendingView ? filteredGroups.find(g => !g.supplier_id) : undefined;
  const labelSpan = layout === 'line' ? 6 : 5;
  const historyFiltered = !!search.trim() || !!statusFilter || period !== 'all';
  const resetHistory = () => { setSearch(''); setStatusFilter(''); setPeriod('all'); setCustomFrom(''); setCustomTo(''); };
  const loading = pendingView ? groupsLoading : allLoading;
  const loadError = pendingView ? groupsError : allError;

  return (
    <>
      <KpiGrid>
        <KpiCard label="En attente" value={totalPending} sub="besoins" />
        <KpiCard label="Fournisseurs" value={totalSuppliers} sub="à commander" />
        <KpiCard label="Estimé" value={`${totalEstimated.toFixed(0)} ${currencySymbol()}`} sub="à dépenser" />
      </KpiGrid>

      {/* Pastilles de statut : filtre de l'historique (la vue « En attente » ne montre que les besoins à commander). */}
      {!pendingView && (
        <FilterChips label="Filtrer par statut" value={statusFilter} onChange={setStatusFilter}
          chips={['', 'pending', 'assigned', 'received', 'closed', 'cancelled'].map(k => ({ key: k, label: k ? STATUS_INFO[k].label : 'Tous' }))} />
      )}

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} label="Rechercher une demande" placeholder="Fournisseur ou article…" />
        {!pendingView && (
          <>
            <PeriodFilter label="Demandé" title="Filtre sur la date de la demande"
              period={period} onPeriod={setPeriod}
              from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
            {period !== 'all' && (
              <button type="button" onClick={() => { setPeriod('all'); setCustomFrom(''); setCustomTo(''); }} className="ds-btn-ghost ds-btn-sm">
                <X size={13} aria-hidden="true" /> Effacer
              </button>
            )}
          </>
        )}
        <Segmented label="Période" value={viewMode} onChange={setViewMode}
          options={[{ key: 'grouped', label: 'En attente', count: totalPending }, { key: 'all', label: 'Historique', icon: History }]} />
        <Segmented label="Présentation" value={layout} onChange={setLayout}
          options={[{ key: 'line', label: 'Par ligne' }, { key: 'supplier', label: 'Par fournisseur' }]} />
      </Toolbar>

      {/* Demandes sans fournisseur : attribution groupée (à la sélection, sinon à toutes). */}
      {noSupplierGroup && (
        <Alert tone="warning" icon={AlertTriangle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {countLabel(noSupplierGroup.requests.length)} sans fournisseur. Attribuez un fournisseur
            {getSelectedForSupplier('').size > 0 ? ' aux demandes sélectionnées' : ''} :
            <SearchSelect
              value=""
              disabled={assignSupplierMutation.isPending}
              onChange={(supplierId) => {
                if (!supplierId) return;
                const sel = getSelectedForSupplier('');
                const ids = sel.size > 0 ? Array.from(sel) : noSupplierGroup.requests.map(r => r.id);
                assignSupplierMutation.mutate({ requestIds: ids, supplierId });
              }}
              placeholder="Choisir un fournisseur…"
              width={230}
              ariaLabel="Attribuer un fournisseur"
              options={(suppliers as { id: string; name: string }[]).map(s => ({ id: s.id, label: s.name }))}
            />
          </span>
        </Alert>
      )}

      {loading ? <LoadingState />
        : loadError ? <ErrorState error={loadError} onRetry={() => { void (pendingView ? refetchGroups() : refetchAll()); }} />
        : pendingView && (groups as SupplierGroup[]).length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Aucune demande en attente"
            text="Les demandes apparaîtront ici lorsqu'un utilisateur demandera un article."
            action={<button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => setViewMode('all')}><History size={13} aria-hidden="true" /> Voir l'historique des demandes</button>} />
        ) : shownRows.length === 0 ? (
          pendingView ? <NoResultState text="Aucune demande ne correspond à la recherche." onReset={() => setSearch('')} />
            : historyFiltered ? <NoResultState text="Aucune demande ne correspond aux filtres." onReset={resetHistory} />
            : <EmptyState icon={History} title="Aucune demande dans l'historique" text="Les demandes commandées, reçues, clôturées ou annulées apparaîtront ici." />
        ) : (
          <DataPanel label="Demandes d'achat"
            bulk={pendingView ? (
              <BulkBar count={selectedIds.length} noun="demande" onClear={() => setSelectedRequests({})}>
                <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={rfqMutation.isPending}
                  title="Mettre ces demandes en concurrence avant de commander"
                  onClick={() => rfqMutation.mutate(selectedIds)}>
                  <FileQuestion size={13} aria-hidden="true" /> Demander des prix
                </button>
              </BulkBar>
            ) : undefined}
            footer={<TableFooter note={pendingView
              ? `${countLabel(shownRows.length)} · ${filteredGroups.length} fournisseur${filteredGroups.length > 1 ? 's' : ''}`
              : `${countLabel(shownRows.length)} · ${periodLabel(period, customFrom, customTo)}`} />}>
            <table className="odoo-table">
              <thead>
                <tr>
                  {pendingView && (
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Sélectionner toutes les demandes prêtes" checked={allChecked} disabled={selectableIds.length === 0} onChange={toggleAll} />
                    </th>
                  )}
                  <th>Article</th>
                  {layout === 'line' && <th>Fournisseur</th>}
                  <th>Motif</th>
                  <th>Demandeur</th>
                  <th>Demandé le</th>
                  <th className="ds-num">Quantité</th>
                  <th className="ds-num">Coût estimé ({currencySymbol()})</th>
                  <th>Statut</th>
                  <th title="Part commandée et part reçue, calculées depuis les lignes de BC">Couverture</th>
                  <th className="ds-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(sct => {
                  const isCollapsed = collapsed.has(sct.key);
                  const groupSel = sct.group ? getSelectedForSupplier(sct.group.supplier_id || '') : null;
                  const groupApproved = sct.group ? sct.group.requests.filter(r => isApproved(r.approval_status)).length : 0;
                  return (
                    <Fragment key={sct.key}>
                      {sct.title !== null && (
                        <tr className="ds-group">
                          {pendingView && (
                            <td>
                              {sct.group && (
                                <input type="checkbox" aria-label={`Sélectionner les demandes prêtes de ${sct.title}`}
                                  checked={groupApproved > 0 && groupSel!.size === groupApproved} disabled={groupApproved === 0}
                                  onChange={() => toggleSelectAll(sct.group!.supplier_id || '', sct.group!.requests)} />
                              )}
                            </td>
                          )}
                          <td colSpan={labelSpan}>
                            <button type="button" aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(sct.key)}
                              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                              {sct.title}
                            </button>
                            {sct.small && <small>{sct.small}</small>}
                          </td>
                          <td className="ds-num">{n2(sct.subtotal)}</td>
                          <td colSpan={3} />
                        </tr>
                      )}
                      {!isCollapsed && sct.rows.map(row => {
                        const approved = isApproved(row.approval);
                        const appr = APPROVAL_INFO[row.approval] ?? APPROVAL_INFO.approved;
                        const reasonInfo = REASON_LABELS[row.reason] || REASON_LABELS.manual;
                        const reasonTag = row.reason === 'stock_bas' ? 'odoo-tag-red'
                          : row.reason === 'production' ? 'odoo-tag-blue'
                          : row.reason === 'replenishment' ? 'odoo-tag-purple'
                          : 'odoo-tag-grey';
                        const isSelected = pendingView && getSelectedForSupplier(row.supplierId).has(row.id);
                        const req = row.raw;
                        const st = STATUS_INFO[row.status] ?? { label: row.status, tone: 'draft' as StatusTone, dot: 'neutral' };
                        const qOrd = req ? parseFloat(req.quantity_ordered as string) || 0 : 0;
                        const qRec = req ? parseFloat(req.quantity_received as string) || 0 : 0;
                        const traceTitle = !req ? undefined : row.status === 'cancelled'
                          ? `Annulée${req.cancelled_by_name ? ` par ${req.cancelled_by_name}` : ''} : ${req.cancel_reason ?? ''}`
                          : row.status === 'closed'
                            ? `Reliquat clôturé${req.closed_by_name ? ` par ${req.closed_by_name}` : ''} : ${req.close_reason ?? ''}`
                            : undefined;
                        const canCancel = pendingView || row.status === 'pending';
                        const canClose = !pendingView && (row.status === 'assigned' || row.status === 'ordered') && qRec > 0 && qRec < row.qty;
                        return (
                          <tr key={row.id} className={isSelected ? 'ds-selected' : undefined} style={pendingView && !approved ? { opacity: 0.7 } : undefined}>
                            {pendingView && (
                              <td>
                                <input type="checkbox" aria-label={`Sélectionner ${row.article}`} checked={isSelected} disabled={!approved}
                                  title={approved ? undefined : 'Proposition à activer avant de pouvoir la sourcer'}
                                  onChange={() => toggleSelect(row.supplierId, row.id)} />
                              </td>
                            )}
                            <td className="ds-strong">
                              {row.article}
                              {row.note && (
                                <div title={row.note} style={{ fontWeight: 400, fontSize: 12, color: 'var(--ds-muted)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.note}</div>
                              )}
                            </td>
                            {layout === 'line' && <td>{row.supplierName || '—'}</td>}
                            <td><span className={`odoo-tag ${reasonTag}`}>{reasonInfo.label}</span></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{row.requester}</td>
                            <td style={{ whiteSpace: 'nowrap' }} title={row.createdAt ? format(new Date(row.createdAt), 'dd/MM/yyyy HH:mm') : undefined}>
                              {row.createdAt ? format(new Date(row.createdAt), 'd MMM yyyy', { locale: fr }) : '—'}
                            </td>
                            <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{row.qty.toFixed(1)} {row.unit}</td>
                            <td className="ds-num">{row.cost !== null ? n2(row.cost) : '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {pendingView ? <StatusTag tone={appr.tone} label={appr.label} /> : (
                                <>
                                  <StatusTag tone={st.tone} label={st.label} title={traceTitle} />
                                  {!approved && <> <StatusTag tone={appr.tone} label={appr.label} /></>}
                                </>
                              )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}
                              title={req ? `Commandé ${qOrd.toFixed(2)} · reçu ${qRec.toFixed(2)} sur ${row.qty.toFixed(2)} ${row.unit}` : undefined}>
                              {req?.purchase_order_number && <><span className="ds-ref">{req.purchase_order_number as string}</span> · </>}
                              {req && row.qty > 0 ? `${Math.round(Math.min(qOrd, row.qty) / row.qty * 100)} % cmd · ${Math.round(Math.min(qRec, row.qty) / row.qty * 100)} % reçu` : '—'}
                            </td>
                            <td className="ds-actions">
                              {pendingView && row.approval === 'draft' && (
                                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={submitMutation.isPending}
                                  title="Activer cette proposition : besoin validé, prête à sourcer"
                                  onClick={() => submitMutation.mutate(row.id)}>
                                  Activer
                                </button>
                              )}
                              {canClose && (
                                <button type="button" className="odoo-btn-secondary ds-btn-sm" title="Renoncer à la part non reçue"
                                  onClick={() => setReasonAction({ kind: 'close', id: row.id, label: row.article })}>
                                  <Check size={13} aria-hidden="true" /> Clôturer le reliquat
                                </button>
                              )}
                              {canCancel && (
                                <RowMenu label={`Plus d'actions pour ${row.article}`} items={[
                                  { label: 'Annuler la demande', icon: Trash2, danger: true, onSelect: () => setReasonAction({ kind: 'cancel', id: row.id, label: row.article }) },
                                ]} />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={labelSpan + (pendingView ? 1 : 0)}>Total estimé</td>
                  <td className="ds-num">{n2(grandTotal)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </DataPanel>
        )}

      {reasonAction && (
        <ReasonModal
          action={reasonAction}
          pending={reasonMutation.isPending}
          onClose={() => setReasonAction(null)}
          onSubmit={(reason) => reasonMutation.mutate({ kind: reasonAction.kind, id: reasonAction.id, reason })}
        />
      )}

    </>
  );
}


/** Saisie du motif d'une annulation ou d'une clôture de reliquat (action journalisée). */
function ReasonModal({ action, pending, onClose, onSubmit }: {
  action: ReasonAction; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const isCancel = action.kind === 'cancel';
  const valid = reason.trim().length >= 3;
  return (
    <Modal title={isCancel ? 'Annuler la demande' : 'Clôturer le reliquat'} subtitle={action.label} width={460} onClose={onClose} locked={pending}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={pending}>Retour</button>
          <button type="submit" form="pr-reason-form" disabled={!valid || pending} aria-busy={pending || undefined} className={isCancel ? 'ds-btn-danger solid' : 'odoo-btn-primary'}>
            {isCancel ? 'Annuler la demande' : 'Clôturer le reliquat'}
          </button>
        </div>
      }>
        <form id="pr-reason-form" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (valid && !pending) onSubmit(reason.trim()); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ds-muted)' }}>
              {isCancel
                ? 'La demande ne sera plus proposée à la commande. Cette action est définitive et journalisée.'
                : 'La part non reçue ne sera plus attendue : la demande est close avec ce qui est arrivé. Action définitive et journalisée.'}
            </p>
            <FormField label="Motif" htmlFor="pr-reason" required
              error={touched && !valid ? 'Indiquez un motif d\'au moins 3 caractères.' : undefined}>
              <textarea id="pr-reason" rows={3} autoFocus value={reason} maxLength={500} className="ds-input" aria-required="true"
                onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)}
                placeholder={isCancel ? 'Ex. besoin couvert par un transfert, erreur de saisie' : 'Ex. fournisseur en rupture, reliquat abandonné'} />
            </FormField>
        </form>
    </Modal>
  );
}
