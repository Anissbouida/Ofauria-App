import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { suppliersApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoye',
  livre_complet: 'Livre',
  livre_partiel: 'Partiel',
  non_livre: 'Non livre',
  annule: 'Annule',
};
const STATUS_COLORS: Record<string, string> = {
  en_attente: 'bg-amber-100 text-amber-800 border border-amber-200',
  envoye: 'bg-blue-100 text-blue-800 border border-blue-200',
  livre_complet: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  livre_partiel: 'bg-orange-100 text-orange-800 border border-orange-200',
  non_livre: 'bg-red-100 text-red-800 border border-red-200',
  annule: 'bg-gray-100 text-gray-500 border border-gray-200',
};
const STATUS_ICONS: Record<string, typeof Clock> = {
  en_attente: Clock,
  envoye: Send,
  livre_complet: CheckCircle2,
  livre_partiel: Package,
  non_livre: PackageX,
  annule: Ban,
};

type POItem = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  ingredient_unit: string;
  quantity_ordered: string;
  quantity_delivered: string;
  unit_price: string;
};

export default function PurchaseOrdersTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showDelivery, setShowDelivery] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => purchaseOrdersApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: overdue = [] } = useQuery({
    queryKey: ['purchase-orders-overdue'],
    queryFn: () => purchaseOrdersApi.overdue(),
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const sendMutation = useMutation({
    mutationFn: purchaseOrdersApi.send,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC envoye au fournisseur'); },
  });
  const cancelMutation = useMutation({
    mutationFn: purchaseOrdersApi.cancel,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC annule'); },
  });
  const deleteMutation = useMutation({
    mutationFn: purchaseOrdersApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC supprime'); },
  });
  const notDeliveredMutation = useMutation({
    mutationFn: purchaseOrdersApi.markNotDelivered,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Marque non livre'); },
  });

  // Stats
  const allOrders = orders as Record<string, unknown>[];
  const stats = useMemo(() => {
    const byStatus: Record<string, { count: number; total: number }> = {};
    for (const po of allOrders) {
      const s = po.status as string;
      if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
      byStatus[s].count++;
      byStatus[s].total += parseFloat(po.total_amount as string) || 0;
    }
    const totalAmount = allOrders.reduce((s, po) => s + (parseFloat(po.total_amount as string) || 0), 0);
    return { byStatus, totalAmount, totalCount: allOrders.length };
  }, [allOrders]);

  // Filter
  const displayed = useMemo(() => {
    let list = allOrders;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(po =>
        (po.order_number as string).toLowerCase().includes(q) ||
        (po.supplier_name as string).toLowerCase().includes(q)
      );
    }
    if (supplierFilter) {
      list = list.filter(po => po.supplier_id === supplierFilter);
    }
    return list;
  }, [allOrders, searchTerm, supplierFilter]);

  // Unique suppliers from orders
  const orderSuppliers = useMemo(() => {
    const map = new Map<string, string>();
    allOrders.forEach(po => map.set(po.supplier_id as string, po.supplier_name as string));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allOrders]);

  const statusTabs = [
    { key: '', label: 'Tous', icon: ShoppingBag, color: 'text-gray-600' },
    { key: 'en_attente', label: 'En attente', icon: Clock, color: 'text-amber-600' },
    { key: 'envoye', label: 'Envoyes', icon: Send, color: 'text-blue-600' },
    { key: 'livre_partiel', label: 'Partiels', icon: Package, color: 'text-orange-600' },
    { key: 'livre_complet', label: 'Livres', icon: CheckCircle2, color: 'text-emerald-600' },
    { key: 'non_livre', label: 'Non livres', icon: PackageX, color: 'text-red-600' },
    { key: 'annule', label: 'Annules', icon: Ban, color: 'text-gray-400' },
  ];

  return (
    <div className="space-y-5">
      {/* Overdue alerts */}
      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-pulse-slow">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
            <AlertTriangle size={18} /> {overdue.length} bon{overdue.length > 1 ? 's' : ''} en retard de livraison
          </div>
          <div className="grid gap-2">
            {(overdue as Record<string, unknown>[]).map((po) => (
              <div key={po.id as string}
                className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-red-700">{po.order_number as string}</span>
                  <span className="text-gray-600">{po.supplier_name as string}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-red-600 text-xs">
                    Attendu le {po.expected_delivery_date ? format(new Date(po.expected_delivery_date as string), 'dd/MM/yyyy') : '—'}
                  </span>
                  <button onClick={() => setShowDelivery(po.id as string)}
                    className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200">
                    Confirmer reception
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total BC</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{stats.totalCount}</p>
          <p className="text-xs text-gray-400 mt-1">{n(stats.totalAmount)} DH</p>
        </div>
        {['en_attente', 'envoye', 'livre_complet'].map(s => {
          const Icon = STATUS_ICONS[s];
          const data = stats.byStatus[s] || { count: 0, total: 0 };
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`bg-white rounded-xl border p-4 text-left transition-all hover:shadow-md ${statusFilter === s ? 'ring-2 ring-primary-500' : ''}`}>
              <div className="flex items-center gap-2">
                <Icon size={14} className={statusTabs.find(t => t.key === s)?.color} />
                <p className="text-xs text-gray-500 uppercase tracking-wide">{STATUS_LABELS[s]}</p>
              </div>
              <p className="text-2xl font-bold text-gray-800 mt-1">{data.count}</p>
              <p className="text-xs text-gray-400 mt-1">{n(data.total)} DH</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap flex-1">
          {statusTabs.map((tab) => {
            const Icon = tab.icon;
            const count = tab.key === '' ? stats.totalCount : (stats.byStatus[tab.key]?.count || 0);
            return (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === tab.key
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}>
                <Icon size={14} />
                {tab.label}
                {count > 0 && <span className={`text-xs ${statusFilter === tab.key ? 'text-white/70' : 'text-gray-400'}`}>({count})</span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2 shadow-sm">
          <Plus size={18} /> Nouveau BC
        </button>
      </div>

      {/* Search + Supplier filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par N° ou fournisseur..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="input pl-9 py-2" />
        </div>
        {orderSuppliers.length > 1 && (
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
              className="input pl-9 pr-8 py-2 w-auto">
              <option value="">Tous les fournisseurs</option>
              {orderSuppliers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Orders list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">
          <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-3" />
          Chargement...
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Truck size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-medium">Aucun bon de commande</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter || searchTerm || supplierFilter
              ? 'Aucun resultat pour ces filtres'
              : 'Creez votre premier bon de commande'}
          </p>
          {!statusFilter && !searchTerm && (
            <button onClick={() => setShowCreate(true)}
              className="btn-primary mt-4 inline-flex items-center gap-2">
              <Plus size={16} /> Creer un BC
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((po) => {
            const isExpanded = expandedRow === (po.id as string);
            const StatusIcon = STATUS_ICONS[po.status as string] || Clock;
            const totalAmount = parseFloat(po.total_amount as string) || 0;
            const deliveredAmount = parseFloat(po.delivered_amount as string) || 0;
            const deliveryPct = totalAmount > 0 ? Math.min(100, (deliveredAmount / totalAmount) * 100) : 0;

            return (
              <div key={po.id as string}
                className={`bg-white rounded-xl border transition-all hover:shadow-md ${
                  isExpanded ? 'shadow-md ring-1 ring-primary-200' : ''
                }`}>
                {/* Main row */}
                <div className="flex items-center px-4 py-3 gap-4 cursor-pointer"
                  onClick={() => setExpandedRow(isExpanded ? null : po.id as string)}>
                  {/* Expand arrow */}
                  <div className="text-gray-400">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {/* Order number + supplier */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-gray-800">{po.order_number as string}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[po.status as string] || ''}`}>
                        <StatusIcon size={12} />
                        {STATUS_LABELS[po.status as string]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      <Truck size={12} className="inline mr-1" />
                      {po.supplier_name as string}
                      {po.notes && <span className="ml-2 text-gray-400">— {po.notes as string}</span>}
                    </p>
                  </div>

                  {/* Date */}
                  <div className="text-right hidden md:block">
                    <p className="text-xs text-gray-400">Commande</p>
                    <p className="text-sm text-gray-600">{format(new Date(po.order_date as string), 'dd MMM yyyy', { locale: fr })}</p>
                  </div>

                  {/* Delivery date */}
                  <div className="text-right hidden md:block">
                    <p className="text-xs text-gray-400">Livraison</p>
                    <p className="text-sm text-gray-600">
                      {po.expected_delivery_date
                        ? format(new Date(po.expected_delivery_date as string), 'dd MMM yyyy', { locale: fr })
                        : '—'}
                    </p>
                  </div>

                  {/* Items count */}
                  <div className="text-center hidden sm:block">
                    <p className="text-xs text-gray-400">Articles</p>
                    <p className="text-sm font-semibold text-gray-700">{po.item_count as number}</p>
                  </div>

                  {/* Amount + delivery progress */}
                  <div className="text-right w-36">
                    <p className="text-sm font-bold text-gray-800">{n(totalAmount)} DH</p>
                    {(po.status === 'livre_partiel' || po.status === 'livre_complet') && (
                      <div className="flex items-center gap-1.5 mt-1 justify-end">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${deliveryPct >= 100 ? 'bg-emerald-500' : 'bg-orange-400'}`}
                            style={{ width: `${deliveryPct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{deliveryPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    {po.status === 'en_attente' && (
                      <button onClick={() => sendMutation.mutate(po.id as string)}
                        title="Envoyer au fournisseur"
                        className="p-2 hover:bg-blue-50 rounded-lg transition-colors group">
                        <Send size={16} className="text-blue-400 group-hover:text-blue-600" />
                      </button>
                    )}
                    {(po.status === 'envoye' || po.status === 'livre_partiel') && (
                      <button onClick={() => setShowDelivery(po.id as string)}
                        title="Confirmer reception"
                        className="p-2 hover:bg-green-50 rounded-lg transition-colors group">
                        <PackageCheck size={16} className="text-green-500 group-hover:text-green-700" />
                      </button>
                    )}
                    <button onClick={() => setShowDetail(po.id as string)}
                      title="Voir details"
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors group">
                      <Eye size={16} className="text-gray-400 group-hover:text-gray-600" />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t bg-gray-50/50 px-4 py-3">
                    <ExpandedPORow poId={po.id as string} status={po.status as string}
                      onSend={() => sendMutation.mutate(po.id as string)}
                      onDelivery={() => setShowDelivery(po.id as string)}
                      onNotDelivered={() => notDeliveredMutation.mutate(po.id as string)}
                      onCancel={() => cancelMutation.mutate(po.id as string)}
                      onDelete={() => { if (confirm('Supprimer ce bon de commande ?')) deleteMutation.mutate(po.id as string); }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
      {showDetail && <PODetailModal poId={showDetail} onClose={() => setShowDetail(null)} />}
      {showDelivery && <DeliveryModal poId={showDelivery} onClose={() => setShowDelivery(null)} />}
    </div>
  );
}

/* ═══ Expanded Row — shows items inline ═══ */
function ExpandedPORow({ poId, status, onSend, onDelivery, onNotDelivered, onCancel, onDelete }: {
  poId: string; status: string;
  onSend: () => void; onDelivery: () => void; onNotDelivered: () => void;
  onCancel: () => void; onDelete: () => void;
}) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  if (isLoading) return <div className="py-4 text-center text-gray-400 text-sm">Chargement des articles...</div>;
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  return (
    <div className="space-y-3">
      {/* Items table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Ingredient</th>
              <th className="text-right px-3 py-2">Qte commandee</th>
              <th className="text-right px-3 py-2">Qte livree</th>
              <th className="text-right px-3 py-2">Prix unit.</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2 w-24">Progression</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map(item => {
              const ordered = parseFloat(item.quantity_ordered);
              const delivered = parseFloat(item.quantity_delivered);
              const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
              const price = parseFloat(item.unit_price);
              return (
                <tr key={item.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {item.ingredient_name} <span className="text-gray-400 text-xs">({item.ingredient_unit})</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{ordered}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{delivered}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{n(price)} DH</td>
                  <td className="px-3 py-2 text-right font-medium">{n(ordered * price)} DH</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {po.notes && (
        <p className="text-sm text-gray-500 italic flex items-center gap-1.5">
          <FileText size={14} className="text-gray-400" /> {po.notes}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {status === 'en_attente' && (
          <>
            <button onClick={onSend}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center gap-1.5 transition-colors">
              <Send size={14} /> Envoyer au fournisseur
            </button>
            <button onClick={onDelete}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
              <Trash2 size={14} /> Supprimer
            </button>
          </>
        )}
        {(status === 'envoye' || status === 'livre_partiel') && (
          <>
            <button onClick={onDelivery}
              className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 flex items-center gap-1.5 transition-colors">
              <PackageCheck size={14} /> Confirmer reception
            </button>
            <button onClick={onNotDelivered}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
              <PackageX size={14} /> Non livre
            </button>
          </>
        )}
        {!['livre_complet', 'annule'].includes(status) && (
          <button onClick={onCancel}
            className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-100 flex items-center gap-1.5 transition-colors">
            <Ban size={14} /> Annuler le BC
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══ Create PO Modal ═══ */
function CreatePOModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [searchIngredient, setSearchIngredient] = useState('');
  const [items, setItems] = useState<{ ingredientId: string; ingredientName: string; unit: string; quantityOrdered: number; unitPrice: number }[]>([]);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Bon de commande cree');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la creation'),
  });

  // Filtered ingredients (not already added)
  const addedIds = new Set(items.map(it => it.ingredientId));
  const filteredIngredients = (ingredients as Record<string, unknown>[]).filter(ing => {
    if (addedIds.has(ing.id as string)) return false;
    if (!searchIngredient) return true;
    return (ing.name as string).toLowerCase().includes(searchIngredient.toLowerCase());
  });

  const addIngredient = (ing: Record<string, unknown>) => {
    setItems([...items, {
      ingredientId: ing.id as string,
      ingredientName: ing.name as string,
      unit: ing.unit as string,
      quantityOrdered: 1,
      unitPrice: parseFloat(ing.unit_cost as string) || 0,
    }]);
    setSearchIngredient('');
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: number) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, it) => sum + it.quantityOrdered * it.unitPrice, 0);

  const handleSubmit = () => {
    if (!supplierId) { toast.error('Selectionnez un fournisseur'); return; }
    if (items.length === 0) { toast.error('Ajoutez au moins un article'); return; }
    const invalidItems = items.filter(it => it.quantityOrdered <= 0);
    if (invalidItems.length > 0) { toast.error('Les quantites doivent etre superieures a 0'); return; }
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      items: items.map(({ ingredientId, quantityOrdered, unitPrice }) => ({ ingredientId, quantityOrdered, unitPrice })),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Nouveau bon de commande</h2>
            <p className="text-sm text-gray-500 mt-0.5">Creez une commande fournisseur avec les articles souhaites</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Supplier + Date */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
                <option value="">Choisir un fournisseur</option>
                {(suppliers as Record<string, unknown>[]).filter((s) => s.is_active !== false).map((s) => (
                  <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Livraison prevue</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="Optionnel..." />
            </div>
          </div>

          {/* Add ingredient search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ajouter des articles</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Chercher un ingredient..."
                value={searchIngredient} onChange={e => setSearchIngredient(e.target.value)}
                className="input pl-9" />
            </div>
            {searchIngredient && filteredIngredients.length > 0 && (
              <div className="mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredIngredients.slice(0, 10).map(ing => (
                  <button key={ing.id as string} onClick={() => addIngredient(ing)}
                    className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm flex items-center justify-between transition-colors">
                    <span className="font-medium">{ing.name as string} <span className="text-gray-400">({ing.unit as string})</span></span>
                    <span className="text-xs text-gray-400">{n(parseFloat(ing.unit_cost as string) || 0)} DH/{ing.unit as string}</span>
                  </button>
                ))}
              </div>
            )}
            {searchIngredient && filteredIngredients.length === 0 && (
              <p className="text-sm text-gray-400 mt-2">Aucun ingredient trouve</p>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="bg-gray-50 rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Ingredient</th>
                    <th className="text-right px-4 py-2 w-32">Quantite</th>
                    <th className="text-right px-4 py-2 w-32">Prix unit. (DH)</th>
                    <th className="text-right px-4 py-2 w-28">Sous-total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {items.map((item, idx) => (
                    <tr key={item.ingredientId} className="group">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-700">{item.ingredientName}</span>
                        <span className="text-gray-400 text-xs ml-1">({item.unit})</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''}
                          onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                          className="input text-sm py-1 text-right w-full" />
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0} step="0.01" value={item.unitPrice || ''}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="input text-sm py-1 text-right w-full" />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                        {n(item.quantityOrdered * item.unitPrice)}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => removeItem(idx)}
                          className="p-1 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                          <X size={14} className="text-red-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-gray-50 px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">{items.length} article{items.length > 1 ? 's' : ''}</span>
                <span className="text-lg font-bold text-gray-800">Total: {n(totalAmount)} DH</span>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              <ShoppingBag size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-gray-400 text-sm">Recherchez et ajoutez des ingredients ci-dessus</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-between items-center rounded-b-2xl">
          <div>
            {items.length > 0 && (
              <p className="text-sm text-gray-500">{items.length} article{items.length > 1 ? 's' : ''} — <span className="font-bold text-gray-800">{n(totalAmount)} DH</span></p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Annuler</button>
            <button onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <Plus size={16} /> {createMutation.isPending ? 'Creation...' : 'Creer le bon de commande'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ PO Detail Modal ═══ */
function PODetailModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-xl text-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-2" />
        Chargement...
      </div>
    </div>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];
  const totalOrdered = items.reduce((s, it) => s + parseFloat(it.quantity_ordered) * parseFloat(it.unit_price), 0);
  const totalDelivered = items.reduce((s, it) => s + parseFloat(it.quantity_delivered) * parseFloat(it.unit_price), 0);
  const globalPct = totalOrdered > 0 ? (totalDelivered / totalOrdered) * 100 : 0;
  const StatusIcon = STATUS_ICONS[po.status] || Clock;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">{po.order_number}</h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[po.status] || ''}`}>
                  <StatusIcon size={12} />
                  {STATUS_LABELS[po.status] || po.status}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {po.supplier_name} — Cree par {po.created_by_name}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Info cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Commande</p>
              <p className="font-medium text-sm mt-0.5">{format(new Date(po.order_date), 'dd MMM yyyy', { locale: fr })}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Livraison prevue</p>
              <p className="font-medium text-sm mt-0.5">
                {po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Date livraison</p>
              <p className="font-medium text-sm mt-0.5">
                {po.delivery_date ? format(new Date(po.delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
          </div>

          {/* Global progress */}
          {(po.status === 'livre_partiel' || po.status === 'livre_complet') && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Progression globale</span>
                <span className="text-sm font-bold">{globalPct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${globalPct >= 100 ? 'bg-emerald-500' : 'bg-orange-400'}`}
                  style={{ width: `${Math.min(100, globalPct)}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span>Commande: {n(totalOrdered)} DH</span>
                <span>Livre: {n(totalDelivered)} DH</span>
              </div>
            </div>
          )}

          {po.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <FileText size={14} className="inline mr-1.5" /> {po.notes}
            </div>
          )}

          {/* Items table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Ingredient</th>
                  <th className="text-right px-4 py-2.5">Commande</th>
                  <th className="text-right px-4 py-2.5">Livre</th>
                  <th className="text-right px-4 py-2.5">Prix unit.</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-right px-4 py-2.5 w-28">Etat</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const delivered = parseFloat(item.quantity_delivered);
                  const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-medium">{item.ingredient_name}
                        <span className="text-gray-400 text-xs ml-1">({item.ingredient_unit})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{ordered}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{delivered}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{n(parseFloat(item.unit_price))} DH</td>
                      <td className="px-4 py-2.5 text-right font-medium">{n(ordered * parseFloat(item.unit_price))} DH</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-14 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-between pt-2 border-t text-sm">
            <span className="font-semibold text-gray-700">Total commande: <span className="text-lg">{n(totalOrdered)} DH</span></span>
            <span className="font-semibold text-green-700">Total livre: <span className="text-lg">{n(totalDelivered)} DH</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Delivery Confirmation Modal ═══ */
function DeliveryModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  const [deliveries, setDeliveries] = useState<Record<string, number>>({});

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number }[] }) =>
      purchaseOrdersApi.confirmDelivery(poId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-pos'] });
      toast.success('Reception confirmee — stock et facture mis a jour');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la confirmation'),
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-xl text-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-2" />
        Chargement...
      </div>
    </div>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  const handleSubmit = () => {
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => ({ itemId, quantityDelivered }));
    if (deliveredItems.length === 0) { toast.error('Saisissez au moins une quantite livree'); return; }
    confirmMutation.mutate({ items: deliveredItems });
  };

  const fillAll = () => {
    const filled: Record<string, number> = {};
    items.forEach((item) => {
      const remaining = parseFloat(item.quantity_ordered) - parseFloat(item.quantity_delivered);
      if (remaining > 0) filled[item.id] = remaining;
    });
    setDeliveries(filled);
  };

  const totalDelivering = Object.entries(deliveries).reduce((sum, [itemId, qty]) => {
    const item = items.find(it => it.id === itemId);
    return sum + qty * (item ? parseFloat(item.unit_price) : 0);
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <PackageCheck size={22} className="text-green-600" /> Confirmer la reception
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{po.order_number} — {po.supplier_name}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Fill all button */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Saisissez les quantites recues pour chaque article</p>
            <button onClick={fillAll}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors">
              <CheckCircle2 size={14} /> Tout recu (livraison complete)
            </button>
          </div>

          {/* Items */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Ingredient</th>
                  <th className="text-right px-4 py-2.5">Commande</th>
                  <th className="text-right px-4 py-2.5">Deja recu</th>
                  <th className="text-right px-4 py-2.5">Restant</th>
                  <th className="text-right px-4 py-2.5 w-36">Qte recue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const alreadyDelivered = parseFloat(item.quantity_delivered);
                  const remaining = ordered - alreadyDelivered;
                  const isComplete = remaining <= 0;
                  return (
                    <tr key={item.id} className={isComplete ? 'bg-green-50/50' : ''}>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${isComplete ? 'text-green-600' : 'text-gray-700'}`}>
                          {item.ingredient_name}
                        </span>
                        <span className="text-gray-400 text-xs ml-1">({item.ingredient_unit})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{ordered}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={alreadyDelivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{alreadyDelivered}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isComplete
                          ? <span className="text-green-600 font-medium flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Complet</span>
                          : <span className="font-semibold text-gray-700">{remaining}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="number" min={0} max={remaining} step="0.01"
                            value={deliveries[item.id] ?? ''}
                            onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                            className="input text-sm py-1.5 text-right w-full" placeholder="0" />
                        ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of what's being received */}
          {totalDelivering > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-green-700">
                <ArrowRight size={14} className="inline mr-1" />
                Valeur de cette reception
              </span>
              <span className="font-bold text-green-800">{n(totalDelivering)} DH</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <PackageCheck size={16} />
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer la reception'}
          </button>
        </div>
      </div>
    </div>
  );
}
