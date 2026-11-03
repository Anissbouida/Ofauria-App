import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { rfqApi } from '../../api/rfq.api';
import { suppliersApi } from '../../api/accounting.api';
import {
  ShoppingCart, Search, ChevronDown, ChevronRight, Truck,
  X, Trash2, FileQuestion, Clock, AlertTriangle, Check,
  User, Coins,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { format } from 'date-fns';
import { apiErrorMessage } from '../../api/errors';

/** Statuts calculés par la base depuis la couverture des lignes de BC (mig 305). */
const STATUS_INFO: Record<string, { label: string; tag: string; dot: string }> = {
  pending:   { label: 'À commander', tag: 'odoo-tag-yellow', dot: 'warning' },
  assigned:  { label: 'Commandé',    tag: 'odoo-tag-blue',   dot: 'neutral' },
  ordered:   { label: 'Commandé',    tag: 'odoo-tag-blue',   dot: 'neutral' },
  received:  { label: 'Reçu',        tag: 'odoo-tag-green',  dot: 'ok' },
  closed:    { label: 'Clôturé',     tag: 'odoo-tag-grey',   dot: 'neutral' },
  cancelled: { label: 'Annulé',      tag: 'odoo-tag-grey',   dot: 'neutral' },
};

/**
 * État du circuit d'approbation (dimension séparée de la couverture, mig 456).
 * Flux procure-to-pay : une DA n'est transformable en BC que si approuvée.
 */
const APPROVAL_INFO: Record<string, { label: string; tag: string }> = {
  draft:    { label: 'Brouillon',   tag: 'odoo-tag-grey' },
  pending:  { label: 'À approuver', tag: 'odoo-tag-yellow' },
  approved: { label: 'Approuvée',   tag: 'odoo-tag-green' },
  rejected: { label: 'Refusée',     tag: 'odoo-tag-red' },
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

export default function PurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [selectedRequests, setSelectedRequests] = useState<Record<string, Set<string>>>({});
  const [viewMode, setViewMode] = useState<'grouped' | 'all'>('grouped');
  const [statusFilter, setStatusFilter] = useState('pending');

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
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

  const { data: allRequests = [], isLoading: allLoading } = useQuery({
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

  // Sourcing obligatoire (mig 457) : une DA approuvée ne devient pas un BC
  // directement — on lance un appel d'offres depuis les DA sélectionnées, et le BC
  // naîtra de l'attribution de cet AO (onglet 4 · Appels d'offres).
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

  const filteredGroups = useMemo(() => {
    if (!search) return groups as SupplierGroup[];
    const q = search.toLowerCase();
    return (groups as SupplierGroup[]).filter(g =>
      (g.supplier_name || '').toLowerCase().includes(q) ||
      g.requests.some(r => r.ingredient_name.toLowerCase().includes(q))
    );
  }, [groups, search]);

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

  return (
    <>
      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Clock size={11} style={{ display: 'inline', marginRight: 4 }} />En attente</div>
          <div className="odoo-stat-card-value">{totalPending}</div>
          <div className="odoo-stat-card-sub">besoins</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Truck size={11} style={{ display: 'inline', marginRight: 4 }} />Fournisseurs</div>
          <div className="odoo-stat-card-value">{totalSuppliers}</div>
          <div className="odoo-stat-card-sub">à commander</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />Estimé</div>
          <div className="odoo-stat-card-value">{totalEstimated.toFixed(0)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">à dépenser</div>
        </div>
      </div>

      {/* Search panel */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par fournisseur ou ingrédient..."
          value={search} onChange={e => setSearch(e.target.value)} className="odoo-search-input" />
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button onClick={() => setViewMode('grouped')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: viewMode === 'grouped' ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: viewMode === 'grouped' ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: viewMode === 'grouped' ? 600 : 400,
            }}>
            Par fournisseur
          </button>
          <button onClick={() => setViewMode('all')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: viewMode === 'all' ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: viewMode === 'all' ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: viewMode === 'all' ? 600 : 400,
            }}>
            Toutes les demandes
          </button>
        </div>
      </div>

      {/* Grouped view */}
      {viewMode === 'grouped' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupsLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>Chargement...</div>
          ) : filteredGroups.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <ShoppingCart size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucune demande en attente</p>
              <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>Les demandes apparaîtront ici lorsqu'un utilisateur demandera un ingrédient</p>
            </div>
          ) : filteredGroups.map((group) => {
            const suppKey = group.supplier_id || '__none__';
            const isExpanded = expandedSupplier === suppKey;
            const selected = getSelectedForSupplier(group.supplier_id || '');
            const approvedCount = group.requests.filter(r => isApproved(r.approval_status)).length;
            const allSelected = selected.size === approvedCount && approvedCount > 0;
            const someSelected = selected.size > 0;
            const dotClass = group.supplier_id ? 'ok' : 'warning';

            return (
              <div key={suppKey} className="odoo-section">
                <div className="odoo-section-header"
                  onClick={() => setExpandedSupplier(isExpanded ? null : suppKey)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <span className={`odoo-status-dot ${dotClass}`} />
                  <Truck size={13} style={{ color: 'var(--theme-accent)' }} />
                  <strong>{group.supplier_name || 'Sans fournisseur'}</strong>
                  <span className="odoo-tag odoo-tag-purple">{group.request_count} besoin{parseInt(group.request_count) > 1 ? 's' : ''}</span>
                  {group.supplier_contact && (
                    <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.6875rem' }}>
                      · {group.supplier_contact}{group.supplier_phone ? ` — ${group.supplier_phone}` : ''}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontWeight: 700 }}>{parseFloat(group.estimated_total || '0').toFixed(2)} <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.6875rem' }}>DH estimé</span></span>
                  {isExpanded ? <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronRight size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                </div>

                {isExpanded && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 16px', background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', borderBottom: '1px solid var(--theme-bg-separator)' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--theme-text-muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(group.supplier_id || '', group.requests)} />
                        Tout sélectionner
                      </label>
                      {someSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); rfqMutation.mutate(Array.from(selected)); }}
                          className="odoo-btn-primary" disabled={rfqMutation.isPending}
                          title="Mettre ces demandes en concurrence avant de commander"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FileQuestion size={11} /> Lancer la demande de prix ({selected.size})
                        </button>
                      )}
                      {!group.supplier_id && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem', color: '#b85d1a' }}>
                            <AlertTriangle size={10} /> Attribuez un fournisseur :
                          </span>
                          <select
                            className="odoo-filter-dropdown"
                            defaultValue=""
                            disabled={assignSupplierMutation.isPending}
                            onChange={(e) => {
                              const supplierId = e.target.value;
                              if (!supplierId) return;
                              const sel = getSelectedForSupplier(group.supplier_id || '');
                              const ids = sel.size > 0
                                ? Array.from(sel)
                                : group.requests.map(r => r.id);
                              assignSupplierMutation.mutate({ requestIds: ids, supplierId });
                              e.currentTarget.value = '';
                            }}
                          >
                            <option value="" disabled>Choisir un fournisseur...</option>
                            {(suppliers as { id: string; name: string }[]).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <table className="odoo-table" style={{ margin: 0, boxShadow: 'none' }}>
                      <thead>
                        <tr>
                          <th style={{ width: 24 }}></th>
                          <th>Ingrédient</th>
                          <th>Motif</th>
                          <th>Approbation</th>
                          <th>Demandeur</th>
                          <th>Date</th>
                          <th>Note</th>
                          <th style={{ textAlign: 'right' }}>Quantité</th>
                          <th style={{ textAlign: 'right' }}>Coût estimé</th>
                          <th style={{ textAlign: 'right', width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.requests.map((req) => {
                          const isSelected = selected.has(req.id);
                          const reasonInfo = REASON_LABELS[req.reason] || REASON_LABELS.manual;
                          const reasonTag = req.reason === 'stock_bas' ? 'odoo-tag-red'
                            : req.reason === 'production' ? 'odoo-tag-blue'
                            : req.reason === 'replenishment' ? 'odoo-tag-purple'
                            : 'odoo-tag-grey';
                          const approved = isApproved(req.approval_status);
                          const appr = APPROVAL_INFO[req.approval_status] ?? APPROVAL_INFO.approved;
                          return (
                            <tr key={req.id} style={{ opacity: approved ? 1 : 0.7 }}>
                              <td>
                                <input type="checkbox" checked={isSelected} disabled={!approved}
                                  title={approved ? undefined : 'Demande non approuvée : à approuver avant de générer un BC'}
                                  onChange={() => toggleSelect(group.supplier_id || '', req.id)} />
                              </td>
                              <td style={{ fontWeight: 500 }}>{req.ingredient_name}</td>
                              <td><span className={`odoo-tag ${reasonTag}`}>{reasonInfo.label}</span></td>
                              <td><span className={`odoo-tag ${appr.tag}`}>{appr.label}</span></td>
                              <td style={{ color: 'var(--theme-text-muted)' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <User size={10} /> {req.requested_by_name}
                                </span>
                              </td>
                              <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                                {format(new Date(req.created_at), 'dd/MM/yyyy HH:mm')}
                              </td>
                              <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {req.note || '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span style={{ fontWeight: 600 }}>{parseFloat(req.quantity).toFixed(1)}</span>
                                <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{req.ingredient_unit}</span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {req.ingredient_unit_cost ? (
                                  <span style={{ color: 'var(--theme-text-muted)' }}>
                                    {(parseFloat(req.quantity) * parseFloat(req.ingredient_unit_cost)).toFixed(2)} <span style={{ fontSize: '0.6875rem' }}>DH</span>
                                  </span>
                                ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setReasonAction({ kind: 'cancel', id: req.id, label: req.ingredient_name }); }}
                                  className="odoo-pager-btn"
                                  title="Annuler cette demande"
                                  style={{ color: '#dc3545' }}>
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* All view */}
      {viewMode === 'all' && (
        <>
          <div className="odoo-search-panel">
            {['pending', 'assigned', 'received', 'closed', 'cancelled', ''].map(s => {
              const label = s ? STATUS_INFO[s].label : 'Tous';
              return (
                <button key={s} onClick={() => setStatusFilter(s)} className="odoo-filter-dropdown"
                  style={{
                    backgroundColor: statusFilter === s ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
                    color: statusFilter === s ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
                    fontWeight: statusFilter === s ? 600 : 400,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Ingrédient</th>
                  <th>Fournisseur</th>
                  <th>Motif</th>
                  <th>Statut</th>
                  <th>Approbation</th>
                  <th>Demandeur</th>
                  <th>Date</th>
                  <th>BC</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }} title="Part commandée et part reçue, calculées depuis les lignes de BC">Couverture</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {allLoading ? (
                  <tr><td colSpan={12} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Chargement...</td></tr>
                ) : (allRequests as Record<string, any>[]).length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune demande</td></tr>
                ) : (allRequests as Record<string, any>[]).map((req) => {
                  const reasonInfo = REASON_LABELS[req.reason as string] || REASON_LABELS.manual;
                  const reasonTag = req.reason === 'stock_bas' ? 'odoo-tag-red'
                    : req.reason === 'production' ? 'odoo-tag-blue'
                    : req.reason === 'replenishment' ? 'odoo-tag-purple'
                    : 'odoo-tag-grey';
                  const st = STATUS_INFO[req.status as string] ?? { label: req.status as string, tag: 'odoo-tag-grey', dot: 'neutral' };
                  const statusTag = st.tag;
                  const dotClass = st.dot;
                  const statusLabel = st.label;
                  const qReq = parseFloat(req.quantity as string) || 0;
                  const qOrd = parseFloat(req.quantity_ordered as string) || 0;
                  const qRec = parseFloat(req.quantity_received as string) || 0;
                  const traceTitle = req.status === 'cancelled'
                    ? `Annulée${req.cancelled_by_name ? ` par ${req.cancelled_by_name}` : ''} : ${req.cancel_reason ?? ''}`
                    : req.status === 'closed'
                      ? `Reliquat clôturé${req.closed_by_name ? ` par ${req.closed_by_name}` : ''} : ${req.close_reason ?? ''}`
                      : undefined;
                  return (
                    <tr key={req.id as string}>
                      <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                      <td style={{ fontWeight: 500 }}>{req.ingredient_name as string}</td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{(req.supplier_name as string) || '—'}</td>
                      <td><span className={`odoo-tag ${reasonTag}`}>{reasonInfo.label}</span></td>
                      <td><span className={`odoo-tag ${statusTag}`} title={traceTitle}>{statusLabel}</span></td>
                      <td>{(() => { const a = APPROVAL_INFO[req.approval_status as string] ?? APPROVAL_INFO.approved; return <span className={`odoo-tag ${a.tag}`}>{a.label}</span>; })()}</td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{req.requested_by_name as string}</td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{format(new Date(req.created_at as string), 'dd/MM HH:mm')}</td>
                      <td style={{ color: 'var(--theme-accent)', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{(req.purchase_order_number as string) || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 600 }}>{parseFloat(req.quantity as string).toFixed(1)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{req.ingredient_unit as string}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.75rem', whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}
                        title={`Commandé ${qOrd.toFixed(2)} · reçu ${qRec.toFixed(2)} sur ${qReq.toFixed(2)} ${req.ingredient_unit ?? ''}`}>
                        {qReq > 0 ? `${Math.round(Math.min(qOrd, qReq) / qReq * 100)} % cmd · ${Math.round(Math.min(qRec, qReq) / qReq * 100)} % reçu` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {req.status === 'pending' && (
                          <button className="odoo-pager-btn" title="Annuler cette demande" style={{ color: '#dc3545' }}
                            onClick={() => setReasonAction({ kind: 'cancel', id: req.id as string, label: req.ingredient_name as string })}>
                            <Trash2 size={12} />
                          </button>
                        )}
                        {(req.status === 'assigned' || req.status === 'ordered') && qRec > 0 && qRec < qReq && (
                          <button className="odoo-pager-btn" title="Clôturer le reliquat (renoncer au manquant)"
                            onClick={() => setReasonAction({ kind: 'close', id: req.id as string, label: req.ingredient_name as string })}>
                            <Check size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
  const isCancel = action.kind === 'cancel';
  const valid = reason.trim().length >= 3;
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <span className="odoo-breadcrumb-current">{isCancel ? 'Annuler la demande' : 'Clôturer le reliquat'} · {action.label}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(reason.trim()); }} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
            {isCancel
              ? 'La demande ne sera plus proposée à la commande. Cette action est définitive et journalisée.'
              : 'La part non reçue ne sera plus attendue : la demande est close avec ce qui est arrivé. Action définitive et journalisée.'}
          </p>
          <label htmlFor="pr-reason" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Motif *</label>
          <textarea id="pr-reason" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder={isCancel ? 'Ex. besoin couvert par un transfert, erreur de saisie' : 'Ex. fournisseur en rupture, reliquat abandonné'} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Retour</button>
            <button type="submit" disabled={!valid || pending} className={isCancel ? 'odoo-btn-danger' : 'odoo-btn-primary'}>
              {isCancel ? 'Annuler la demande' : 'Clôturer le reliquat'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
