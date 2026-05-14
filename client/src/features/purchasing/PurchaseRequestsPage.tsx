import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { suppliersApi } from '../../api/accounting.api';
import {
  ShoppingCart, Search, ChevronDown, ChevronRight, Truck,
  X, Trash2, FileText, Clock, AlertTriangle, Check,
  User, Coins,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { format } from 'date-fns';

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
    requested_by_name: string;
    created_at: string;
  }[];
}

export default function PurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [selectedRequests, setSelectedRequests] = useState<Record<string, Set<string>>>({});
  const [showGeneratePO, setShowGeneratePO] = useState<string | null>(null);
  const [quantityOverrides, setQuantityOverrides] = useState<Record<string, string>>({});
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

  const cancelMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => purchaseRequestsApi.cancel(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Demande annulee');
    },
  });

  const generatePOMutation = useMutation({
    mutationFn: purchaseRequestsApi.generatePO,
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setShowGeneratePO(null);
      setSelectedRequests({});
      setQuantityOverrides({});
      notify.success(`Bon de commande ${po.order_number} cree`);
    },
    onError: () => notify.error('Erreur lors de la creation du BC'),
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
    const current = selectedRequests[key] || new Set();
    if (current.size === requests.length) {
      setSelectedRequests({ ...selectedRequests, [key]: new Set() });
    } else {
      setSelectedRequests({ ...selectedRequests, [key]: new Set(requests.map(r => r.id)) });
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
            const allSelected = selected.size === group.requests.length && group.requests.length > 0;
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
                      {someSelected && group.supplier_id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowGeneratePO(suppKey); }}
                          className="odoo-btn-primary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FileText size={11} /> Générer le BC ({selected.size} lignes)
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
                          return (
                            <tr key={req.id}>
                              <td>
                                <input type="checkbox" checked={isSelected}
                                  onChange={() => toggleSelect(group.supplier_id || '', req.id)} />
                              </td>
                              <td style={{ fontWeight: 500 }}>{req.ingredient_name}</td>
                              <td><span className={`odoo-tag ${reasonTag}`}>{reasonInfo.label}</span></td>
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
                                  onClick={(e) => { e.stopPropagation(); cancelMutation.mutate({ id: req.id }); }}
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
            {['pending', 'assigned', 'ordered', 'cancelled', ''].map(s => {
              const label = s === 'pending' ? 'En attente' : s === 'assigned' ? 'Attribué' : s === 'ordered' ? 'Commandé' : s === 'cancelled' ? 'Annulé' : 'Tous';
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
                  <th>Demandeur</th>
                  <th>Date</th>
                  <th>BC</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                </tr>
              </thead>
              <tbody>
                {allLoading ? (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Chargement...</td></tr>
                ) : (allRequests as Record<string, any>[]).length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune demande</td></tr>
                ) : (allRequests as Record<string, any>[]).map((req) => {
                  const reasonInfo = REASON_LABELS[req.reason as string] || REASON_LABELS.manual;
                  const reasonTag = req.reason === 'stock_bas' ? 'odoo-tag-red'
                    : req.reason === 'production' ? 'odoo-tag-blue'
                    : req.reason === 'replenishment' ? 'odoo-tag-purple'
                    : 'odoo-tag-grey';
                  const statusTag = req.status === 'pending' ? 'odoo-tag-yellow'
                    : req.status === 'assigned' ? 'odoo-tag-blue'
                    : req.status === 'ordered' ? 'odoo-tag-green'
                    : 'odoo-tag-grey';
                  const dotClass = req.status === 'pending' ? 'warning'
                    : req.status === 'assigned' ? 'neutral'
                    : req.status === 'ordered' ? 'ok' : 'neutral';
                  const statusLabel = req.status === 'pending' ? 'En attente'
                    : req.status === 'assigned' ? 'Attribué'
                    : req.status === 'ordered' ? 'Commandé'
                    : req.status === 'cancelled' ? 'Annulé' : (req.status as string);
                  return (
                    <tr key={req.id as string}>
                      <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                      <td style={{ fontWeight: 500 }}>{req.ingredient_name as string}</td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{(req.supplier_name as string) || '—'}</td>
                      <td><span className={`odoo-tag ${reasonTag}`}>{reasonInfo.label}</span></td>
                      <td><span className={`odoo-tag ${statusTag}`}>{statusLabel}</span></td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{req.requested_by_name as string}</td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{format(new Date(req.created_at as string), 'dd/MM HH:mm')}</td>
                      <td style={{ color: 'var(--theme-accent)', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{(req.purchase_order_number as string) || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 600 }}>{parseFloat(req.quantity as string).toFixed(1)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{req.ingredient_unit as string}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Generate PO modal */}
      {showGeneratePO && (() => {
        const group = (groups as SupplierGroup[]).find(g => (g.supplier_id || '__none__') === showGeneratePO);
        if (!group || !group.supplier_id) return null;
        const selected = getSelectedForSupplier(group.supplier_id);
        const selectedReqs = group.requests.filter(r => selected.has(r.id));

        return (
          <GeneratePOModal
            supplierName={group.supplier_name || ''}
            supplierId={group.supplier_id}
            requests={selectedReqs}
            quantityOverrides={quantityOverrides}
            onQuantityChange={(id, val) => setQuantityOverrides({ ...quantityOverrides, [id]: val })}
            onClose={() => { setShowGeneratePO(null); setQuantityOverrides({}); }}
            onGenerate={(expectedDate, notes) => {
              const overrides: Record<string, number> = {};
              Object.entries(quantityOverrides).forEach(([k, v]) => {
                const parsed = parseFloat(v);
                if (!isNaN(parsed) && parsed > 0) overrides[k] = parsed;
              });
              generatePOMutation.mutate({
                supplierId: group.supplier_id!,
                requestIds: Array.from(selected),
                expectedDeliveryDate: expectedDate || undefined,
                notes: notes || undefined,
                quantityOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
              });
            }}
            isLoading={generatePOMutation.isPending}
          />
        );
      })()}
    </>
  );
}

/* ─── Generate PO Modal ─── */
function GeneratePOModal({ supplierName, supplierId, requests, quantityOverrides, onQuantityChange, onClose, onGenerate, isLoading }: {
  supplierName: string;
  supplierId: string;
  requests: SupplierGroup['requests'];
  quantityOverrides: Record<string, string>;
  onQuantityChange: (id: string, val: string) => void;
  onClose: () => void;
  onGenerate: (expectedDate: string, notes: string) => void;
  isLoading: boolean;
}) {
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  const totalEstimated = requests.reduce((sum, r) => {
    const qty = parseFloat(quantityOverrides[r.id] || r.quantity);
    const cost = parseFloat(r.ingredient_unit_cost || '0');
    return sum + (isNaN(qty) ? 0 : qty * cost);
  }, 0);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Bon de commande</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{supplierName}</span>
          </div>
          <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 8 }}>{requests.length} ligne{requests.length > 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="odoo-alert" style={{ fontSize: '0.6875rem' }}>
            <strong>Règle métier :</strong> Un bon de commande ne contient que des lignes d'un seul fournisseur. Vous pouvez ajuster les quantités avant validation.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Ingrédient</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Quantité</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Prix unit.</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Sous-total</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const qty = parseFloat(quantityOverrides[req.id] || req.quantity);
                  const cost = parseFloat(req.ingredient_unit_cost || '0');
                  return (
                    <tr key={req.id}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{req.ingredient_name}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({req.ingredient_unit})</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" step="0.1" min="0.1"
                          className="w-full px-2 py-1 border border-gray-200 rounded-md text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                          style={{ maxWidth: 100, display: 'inline-block' }}
                          value={quantityOverrides[req.id] ?? req.quantity}
                          onChange={e => onQuantityChange(req.id, e.target.value)} />
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>
                        {cost > 0 ? `${cost.toFixed(2)} DH` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {cost > 0 && !isNaN(qty) ? `${(qty * cost).toFixed(2)} DH` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                  <td colSpan={3} style={{ padding: 12, textAlign: 'right', fontWeight: 700 }}>Total estimé</td>
                  <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: 'var(--theme-accent)' }}>{totalEstimated.toFixed(2)} DH</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date de livraison prévue</label>
              <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Notes</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes pour le fournisseur..." />
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => onGenerate(expectedDate, notes)} disabled={isLoading} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={13} /> {isLoading ? 'Génération...' : 'Générer le BC'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
