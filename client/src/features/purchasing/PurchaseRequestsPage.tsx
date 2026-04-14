import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import {
  ShoppingCart, Package, Search, ChevronDown, ChevronRight, Truck,
  X, Plus, Trash2, FileText, Clock, AlertTriangle, Check,
  Calendar, User, Edit3, Filter, ArrowLeft, ShieldCheck,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
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
  const navigate = useNavigate();
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
    <div className="space-y-4">
      {/* ══════ HERO ══════ */}
      <div className="bg-gradient-to-br from-teal-600 to-emerald-700 rounded-2xl p-6 text-white relative overflow-hidden shadow-lg">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShoppingCart size={24} /> Liste d'attente d'achat
            </h1>
            <p className="text-sm text-white/70 mt-1">
              Centralisez les besoins et generez les bons de commande par fournisseur
            </p>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-3 mt-5">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{totalPending}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><Clock size={12} /> En attente</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{totalSuppliers}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><Truck size={12} /> Fournisseurs</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{totalEstimated.toFixed(0)}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1">DH estime</p>
          </div>
        </div>
      </div>

      {/* ══════ TOOLBAR ══════ */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par fournisseur ou ingredient..."
            value={search} onChange={e => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          <button onClick={() => setViewMode('grouped')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'grouped' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500'}`}>
            Par fournisseur
          </button>
          <button onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'all' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500'}`}>
            Toutes les demandes
          </button>
        </div>
      </div>

      {/* ══════ GROUPED VIEW ══════ */}
      {viewMode === 'grouped' && (
        <div className="space-y-3">
          {groupsLoading ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">Chargement...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
              <ShoppingCart size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Aucune demande en attente</p>
              <p className="text-xs mt-1">Les demandes apparaitront ici lorsqu'un utilisateur demandera un ingredient</p>
            </div>
          ) : filteredGroups.map((group) => {
            const suppKey = group.supplier_id || '__none__';
            const isExpanded = expandedSupplier === suppKey;
            const selected = getSelectedForSupplier(group.supplier_id || '');
            const allSelected = selected.size === group.requests.length && group.requests.length > 0;
            const someSelected = selected.size > 0;

            return (
              <div key={suppKey} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Supplier header */}
                <div
                  onClick={() => setExpandedSupplier(isExpanded ? null : suppKey)}
                  className="px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shrink-0">
                    <Truck size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">
                        {group.supplier_name || 'Sans fournisseur'}
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-bold">
                        {group.request_count} besoin(s)
                      </span>
                    </div>
                    {group.supplier_contact ? (
                      <p className="text-xs text-gray-400">{group.supplier_contact} {group.supplier_phone ? `— ${group.supplier_phone}` : ''}</p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-800">{parseFloat(group.estimated_total || '0').toFixed(2)} DH</p>
                    <p className="text-[10px] text-gray-400">estime</p>
                  </div>
                  <div className="shrink-0">
                    {isExpanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {/* Action bar */}
                    <div className="px-5 py-2.5 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
                      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                        <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(group.supplier_id || '', group.requests)}
                          className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                        Tout selectionner
                      </label>
                      {someSelected && group.supplier_id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowGeneratePO(suppKey); }}
                          className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <FileText size={12} /> Generer le BC ({selected.size} lignes)
                        </button>
                      )}
                      {!group.supplier_id && (
                        <span className="text-[10px] text-amber-600 flex items-center gap-1">
                          <AlertTriangle size={10} /> Attribuez un fournisseur avant de generer un BC
                        </span>
                      )}
                    </div>

                    {/* Requests list */}
                    <div className="divide-y divide-gray-50">
                      {group.requests.map((req) => {
                        const isSelected = selected.has(req.id);
                        const reasonInfo = REASON_LABELS[req.reason] || REASON_LABELS.manual;

                        return (
                          <div key={req.id} className={`px-5 py-3 flex items-center gap-3 transition-colors ${isSelected ? 'bg-teal-50/40' : 'hover:bg-gray-50/50'}`}>
                            {group.supplier_id ? (
                              <input type="checkbox" checked={isSelected}
                                onChange={() => toggleSelect(group.supplier_id || '', req.id)}
                                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 shrink-0" />
                            ) : null}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{req.ingredient_name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${reasonInfo.color}`}>
                                  {reasonInfo.label}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                                <span className="flex items-center gap-1"><User size={10} /> {req.requested_by_name}</span>
                                <span className="flex items-center gap-1"><Calendar size={10} /> {format(new Date(req.created_at), 'dd/MM/yyyy HH:mm')}</span>
                                {req.note ? <span className="truncate max-w-[200px]">{req.note}</span> : null}
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-3">
                              <div>
                                <p className="text-sm font-bold text-gray-800">{parseFloat(req.quantity).toFixed(1)} {req.ingredient_unit}</p>
                                {req.ingredient_unit_cost ? (
                                  <p className="text-[10px] text-gray-400">
                                    ~{(parseFloat(req.quantity) * parseFloat(req.ingredient_unit_cost)).toFixed(2)} DH
                                  </p>
                                ) : null}
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelMutation.mutate({ id: req.id }); }}
                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Annuler cette demande"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══════ ALL VIEW ══════ */}
      {viewMode === 'all' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['pending', 'assigned', 'ordered', 'cancelled', ''].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  statusFilter === s ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {s === 'pending' ? 'En attente' : s === 'assigned' ? 'Attribue' : s === 'ordered' ? 'Commande' : s === 'cancelled' ? 'Annule' : 'Tous'}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Ingredient</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fournisseur</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quantite</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Motif</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Statut</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Demandeur</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">BC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {allLoading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                  ) : (allRequests as Record<string, unknown>[]).length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucune demande</td></tr>
                  ) : (allRequests as Record<string, unknown>[]).map((req) => {
                    const reasonInfo = REASON_LABELS[req.reason as string] || REASON_LABELS.manual;
                    const statusColors: Record<string, string> = {
                      pending: 'bg-amber-100 text-amber-700',
                      assigned: 'bg-blue-100 text-blue-700',
                      ordered: 'bg-emerald-100 text-emerald-700',
                      cancelled: 'bg-gray-100 text-gray-500',
                    };
                    const statusLabels: Record<string, string> = {
                      pending: 'En attente',
                      assigned: 'Attribue',
                      ordered: 'Commande',
                      cancelled: 'Annule',
                    };
                    return (
                      <tr key={req.id as string} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{req.ingredient_name as string}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{(req.supplier_name as string) || '—'}</td>
                        <td className="px-4 py-3 text-sm font-bold text-gray-800">{parseFloat(req.quantity as string).toFixed(1)} {req.ingredient_unit as string}</td>
                        <td className="px-4 py-3"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${reasonInfo.color}`}>{reasonInfo.label}</span></td>
                        <td className="px-4 py-3"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[req.status as string] || ''}`}>{statusLabels[req.status as string] || req.status as string}</span></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{req.requested_by_name as string}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{format(new Date(req.created_at as string), 'dd/MM HH:mm')}</td>
                        <td className="px-4 py-3 text-xs text-violet-600 font-medium">{(req.purchase_order_number as string) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════ GENERATE PO MODAL ══════ */}
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
    </div>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-teal-500 to-emerald-600 p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <FileText size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Generer un bon de commande</h2>
              <p className="text-sm text-white/70">{supplierName} — {requests.length} ingredient(s)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Info */}
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs text-teal-700">
            <strong>Regle metier :</strong> Un bon de commande ne contient que des lignes d'un seul fournisseur.
            Vous pouvez ajuster les quantites avant validation.
          </div>

          {/* Items */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-gray-700">Lignes du bon de commande</h3>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Ingredient</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-28">Quantite</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-24">Prix unit.</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 w-24">Sous-total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {requests.map(req => {
                    const qty = parseFloat(quantityOverrides[req.id] || req.quantity);
                    const cost = parseFloat(req.ingredient_unit_cost || '0');
                    return (
                      <tr key={req.id}>
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-gray-900">{req.ingredient_name}</p>
                          <p className="text-[10px] text-gray-400">{req.ingredient_unit}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <input type="number" step="0.1" min="0.1"
                            className="input py-1 px-2 text-sm w-24"
                            value={quantityOverrides[req.id] ?? req.quantity}
                            onChange={e => onQuantityChange(req.id, e.target.value)} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">
                          {cost > 0 ? `${cost.toFixed(2)} DH` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-800">
                          {cost > 0 && !isNaN(qty) ? `${(qty * cost).toFixed(2)} DH` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-sm font-bold text-gray-700 text-right">Total estime</td>
                    <td className="px-4 py-2 text-right text-sm font-bold text-teal-700">{totalEstimated.toFixed(2)} DH</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Date de livraison prevue</label>
              <input type="date" className="input" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes pour le fournisseur..." />
            </div>
          </div>
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
          <button onClick={() => onGenerate(expectedDate, notes)} disabled={isLoading}
            className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            <Check size={16} /> {isLoading ? 'Generation...' : 'Generer le BC'}
          </button>
        </div>
      </div>
    </div>
  );
}
