import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { suppliersApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter, Loader2, Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoyé',
  livre_complet: 'Livré',
  livre_partiel: 'Partiel',
  non_livre: 'Non livré',
  annule: 'Annulé',
  en_attente_facturation: 'Att. facturation',
};
const STATUS_COLORS: Record<string, string> = {
  en_attente: 'bg-amber-100 text-amber-800 border border-amber-200',
  envoye: 'bg-blue-100 text-blue-800 border border-blue-200',
  livre_complet: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  livre_partiel: 'bg-orange-100 text-orange-800 border border-orange-200',
  non_livre: 'bg-red-100 text-red-800 border border-red-200',
  annule: 'bg-gray-100 text-gray-500 border border-gray-200',
  en_attente_facturation: 'bg-purple-100 text-purple-800 border border-purple-200',
};
const STATUS_ICONS: Record<string, typeof Clock> = {
  en_attente: Clock,
  envoye: Send,
  livre_complet: CheckCircle2,
  livre_partiel: Package,
  non_livre: PackageX,
  annule: Ban,
  en_attente_facturation: FileText,
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC envoyé au fournisseur'); },
  });
  const cancelMutation = useMutation({
    mutationFn: purchaseOrdersApi.cancel,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC annulé'); },
  });
  const deleteMutation = useMutation({
    mutationFn: purchaseOrdersApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('BC supprimé'); },
  });
  const notDeliveredMutation = useMutation({
    mutationFn: purchaseOrdersApi.markNotDelivered,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Marqué non livré'); },
  });

  // Stats
  const handleDownloadPoPdf = async (po: Record<string, unknown>) => {
    try {
      const response = await purchaseOrdersApi.downloadPdf(po.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${po.order_number || 'BC'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      toast.error('Erreur lors du téléchargement du PDF');
    }
  };

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
    { key: 'envoye', label: 'Envoyés', icon: Send, color: 'text-blue-600' },
    { key: 'livre_partiel', label: 'Partiels', icon: Package, color: 'text-orange-600' },
    { key: 'livre_complet', label: 'Livrés', icon: CheckCircle2, color: 'text-emerald-600' },
    { key: 'non_livre', label: 'Non livrés', icon: PackageX, color: 'text-red-600' },
    { key: 'en_attente_facturation', label: 'Att. facture', icon: FileText, color: 'text-purple-600' },
    { key: 'annule', label: 'Annulés', icon: Ban, color: 'text-gray-400' },
  ];

  return (
    <div className="space-y-5">
      {/* Overdue alerts */}
      {overdue.length > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2.5 text-red-700 font-semibold mb-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <AlertTriangle size={14} className="text-white" />
            </div>
            {overdue.length} bon{overdue.length > 1 ? 's' : ''} en retard de livraison
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
                    Confirmer réception
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-gray-700 flex items-center justify-center">
              <ShoppingBag size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total BC</p>
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats.totalCount}</p>
          <p className="text-xs text-gray-400 mt-1">{n(stats.totalAmount)} DH</p>
        </div>
        {[
          { key: 'en_attente', gradient: 'from-amber-500 to-yellow-500' },
          { key: 'envoye', gradient: 'from-blue-500 to-indigo-500' },
          { key: 'livre_complet', gradient: 'from-emerald-500 to-green-500' },
        ].map(({ key: s, gradient }) => {
          const Icon = STATUS_ICONS[s];
          const data = stats.byStatus[s] || { count: 0, total: 0 };
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`bg-white rounded-2xl shadow-sm border p-4 text-left transition-all hover:shadow-md ${statusFilter === s ? 'ring-2 ring-offset-1 ring-slate-400 border-slate-300' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                  <Icon size={16} className="text-white" />
                </div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{STATUS_LABELS[s]}</p>
              </div>
              <p className="text-2xl font-bold text-gray-800">{data.count}</p>
              <p className="text-xs text-gray-400 mt-1">{n(data.total)} DH</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar: status tabs + actions */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 bg-gray-50 rounded-xl p-1 flex-1 flex-wrap">
          {statusTabs.map((tab) => {
            const Icon = tab.icon;
            const count = tab.key === '' ? stats.totalCount : (stats.byStatus[tab.key]?.count || 0);
            return (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === tab.key
                    ? 'bg-white text-slate-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={13} />
                {tab.label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    statusFilter === tab.key ? 'bg-slate-100 text-slate-600' : 'bg-gray-200 text-gray-500'
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gradient-to-r from-slate-600 to-gray-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
          <Plus size={16} /> Nouveau BC
        </button>
      </div>

      {/* Search + Supplier filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par N° ou fournisseur..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent" />
        </div>
        {orderSuppliers.length > 1 && (
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
              className="pl-9 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto">
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
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-slate-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des bons de commande...</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <Truck size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucun bon de commande</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter || searchTerm || supplierFilter
              ? 'Aucun résultat pour ces filtres'
              : 'Créez votre premier bon de commande'}
          </p>
          {!statusFilter && !searchTerm && (
            <button onClick={() => setShowCreate(true)}
              className="mt-4 px-4 py-2 bg-gradient-to-r from-slate-600 to-gray-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all inline-flex items-center gap-2 text-sm">
              <Plus size={16} /> Créer un BC
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
                className={`bg-white rounded-2xl shadow-sm border transition-all hover:shadow-md ${
                  isExpanded ? 'shadow-md border-slate-300' : 'border-gray-100'
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
                        title="Confirmer réception"
                        className="p-2 hover:bg-green-50 rounded-lg transition-colors group">
                        <PackageCheck size={16} className="text-green-500 group-hover:text-green-700" />
                      </button>
                    )}
                    {po.status !== 'en_attente' && (
                      <button onClick={() => handleDownloadPoPdf(po)}
                        title="Télécharger PDF"
                        className="p-2 hover:bg-violet-50 rounded-lg transition-colors group">
                        <Download size={16} className="text-violet-400 group-hover:text-violet-600" />
                      </button>
                    )}
                    <button onClick={() => setShowDetail(po.id as string)}
                      title="Voir détails"
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
              <th className="text-left px-3 py-2">Ingrédient</th>
              <th className="text-right px-3 py-2">Qté commandée</th>
              <th className="text-right px-3 py-2">Qté livrée</th>
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
              const price = item.unit_price != null ? parseFloat(item.unit_price) : null;
              return (
                <tr key={item.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {item.ingredient_name} <span className="text-gray-400 text-xs">({item.ingredient_unit})</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{ordered}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{delivered}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{price != null ? `${n(price)} DH` : <span className="text-amber-500 text-xs">À définir</span>}</td>
                  <td className="px-3 py-2 text-right font-medium">{price != null ? `${n(ordered * price)} DH` : <span className="text-gray-400">—</span>}</td>
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
              <PackageCheck size={14} /> Confirmer réception
            </button>
            <button onClick={onNotDelivered}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
              <PackageX size={14} /> Non livré
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
  const [items, setItems] = useState<{ ingredientId: string; ingredientName: string; unit: string; quantityOrdered: number; unitPrice: number | null }[]>([]);
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [newIng, setNewIng] = useState({ name: '', unit: 'kg', category: 'autre', unitCost: '' });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Bon de commande créé');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la création'),
  });

  const createIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: (created: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      const cost = parseFloat(created.unit_cost as string) || 0;
      setItems([...items, {
        ingredientId: created.id as string,
        ingredientName: created.name as string,
        unit: created.unit as string,
        quantityOrdered: 1,
        unitPrice: cost > 0 ? cost : null,
      }]);
      setShowNewIngredient(false);
      setNewIng({ name: '', unit: 'kg', category: 'autre', unitCost: '' });
      setSearchIngredient('');
      toast.success(`Ingrédient "${created.name}" créé et ajouté`);
    },
    onError: () => toast.error('Erreur lors de la création de l\'ingrédient'),
  });

  const handleCreateIngredient = () => {
    if (!newIng.name.trim()) { toast.error('Saisissez le nom de l\'ingrédient'); return; }
    createIngredientMutation.mutate({
      name: newIng.name.trim(),
      unit: newIng.unit,
      category: newIng.category,
      unitCost: newIng.unitCost ? parseFloat(newIng.unitCost) : 0,
    });
  };

  // Filtered ingredients (not already added)
  const addedIds = new Set(items.map(it => it.ingredientId));
  const filteredIngredients = (ingredients as Record<string, unknown>[]).filter(ing => {
    if (addedIds.has(ing.id as string)) return false;
    if (!searchIngredient) return true;
    return (ing.name as string).toLowerCase().includes(searchIngredient.toLowerCase());
  });

  const addIngredient = (ing: Record<string, unknown>) => {
    const cost = parseFloat(ing.unit_cost as string) || 0;
    setItems([...items, {
      ingredientId: ing.id as string,
      ingredientName: ing.name as string,
      unit: ing.unit as string,
      quantityOrdered: 1,
      unitPrice: cost > 0 ? cost : null,
    }]);
    setSearchIngredient('');
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: number) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, it) => sum + it.quantityOrdered * (it.unitPrice || 0), 0);
  const hasMissingPrices = items.some(it => it.unitPrice == null || it.unitPrice === 0);

  const handleSubmit = () => {
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    if (items.length === 0) { toast.error('Ajoutez au moins un article'); return; }
    const invalidItems = items.filter(it => it.quantityOrdered <= 0);
    if (invalidItems.length > 0) { toast.error('Les quantités doivent être supérieures à 0'); return; }
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      items: items.map(({ ingredientId, quantityOrdered, unitPrice }) => ({
        ingredientId, quantityOrdered,
        unitPrice: unitPrice != null && unitPrice > 0 ? unitPrice : null,
      })),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-600 to-gray-700 px-6 py-5 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <ShoppingBag size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Nouveau bon de commande</h2>
              <p className="text-sm text-white/70">Créez une commande fournisseur avec les articles souhaités</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Supplier + Date */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                <option value="">Choisir un fournisseur</option>
                {(suppliers as Record<string, unknown>[]).filter((s) => s.is_active !== false).map((s) => (
                  <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Livraison prévue</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="Optionnel..." />
            </div>
          </div>

          {/* Add ingredient search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ajouter des articles</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Chercher un ingrédient..."
                  value={searchIngredient} onChange={e => setSearchIngredient(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
              </div>
              <button onClick={() => { setShowNewIngredient(true); setNewIng({ name: searchIngredient || '', unit: 'kg', category: 'autre', unitCost: '' }); }}
                className="px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5 border border-emerald-200 whitespace-nowrap shrink-0">
                <Plus size={14} /> Nouvel ingrédient
              </button>
            </div>
            {searchIngredient && filteredIngredients.length > 0 && (
              <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filteredIngredients.slice(0, 10).map(ing => (
                  <button key={ing.id as string} onClick={() => addIngredient(ing)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm flex items-center justify-between transition-colors first:rounded-t-xl last:rounded-b-xl">
                    <span className="font-medium">{ing.name as string} <span className="text-gray-400">({ing.unit as string})</span></span>
                    <span className="text-xs text-gray-400">{n(parseFloat(ing.unit_cost as string) || 0)} DH/{ing.unit as string}</span>
                  </button>
                ))}
              </div>
            )}
            {searchIngredient && filteredIngredients.length === 0 && !showNewIngredient && (
              <p className="text-sm text-gray-400 mt-2">Aucun ingrédient trouvé</p>
            )}
            {showNewIngredient && (
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                    <Plus size={14} /> Nouvel ingrédient
                  </h4>
                  <button onClick={() => setShowNewIngredient(false)} className="p-1 hover:bg-emerald-100 rounded-lg transition-colors">
                    <X size={14} className="text-emerald-600" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Nom *</label>
                    <input type="text" value={newIng.name} onChange={e => setNewIng({ ...newIng, name: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" placeholder="Ex: Farine T55" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Unité *</label>
                    <select value={newIng.unit} onChange={e => setNewIng({ ...newIng, unit: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      <option value="kg">kg</option><option value="g">g</option><option value="L">L</option>
                      <option value="mL">mL</option><option value="unit">unité</option><option value="piece">pièce</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Catégorie</label>
                    <select value={newIng.category} onChange={e => setNewIng({ ...newIng, category: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      <option value="farines">Farines & Céréales</option>
                      <option value="sucres">Sucres & Édulcorants</option>
                      <option value="produits_laitiers">Produits laitiers</option>
                      <option value="oeufs">Oeufs & Ovoproduits</option>
                      <option value="matieres_grasses">Matières grasses</option>
                      <option value="fruits">Fruits & Purées</option>
                      <option value="chocolat">Chocolat & Cacao</option>
                      <option value="fruits_secs">Fruits secs & Oléagineux</option>
                      <option value="epices">Épices & Arômes</option>
                      <option value="levures">Levures & Agents levants</option>
                      <option value="emballages">Emballages</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Coût unitaire (DH)</label>
                    <input type="number" step="0.01" min="0" value={newIng.unitCost} onChange={e => setNewIng({ ...newIng, unitCost: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" placeholder="Optionnel" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowNewIngredient(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Annuler</button>
                  <button onClick={handleCreateIngredient} disabled={createIngredientMutation.isPending}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50">
                    {createIngredientMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
                    {createIngredientMutation.isPending ? 'Création...' : 'Créer et ajouter'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ingrédient</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Quantité</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Prix unit. (DH)</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-28">Sous-total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item, idx) => (
                    <tr key={item.ingredientId} className="group hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-700">{item.ingredientName}</span>
                        <span className="text-gray-400 text-xs ml-1">({item.unit})</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''}
                          onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500" />
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0} step="0.01" value={item.unitPrice ?? ''}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="Optionnel"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500" />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                        {item.unitPrice ? n(item.quantityOrdered * item.unitPrice) : <span className="text-gray-400 text-xs">À définir</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => removeItem(idx)}
                          className="p-1.5 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                          <X size={14} className="text-red-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-gradient-to-r from-slate-600 to-gray-700 px-4 py-3 flex items-center justify-between text-white rounded-b-2xl">
                <span className="text-sm">
                  {items.length} article{items.length > 1 ? 's' : ''}
                  {hasMissingPrices && <span className="ml-2 text-amber-300 text-xs">(prix à définir par le fournisseur)</span>}
                </span>
                <span className="text-lg font-bold">{totalAmount > 0 ? `Total: ${n(totalAmount)} DH` : 'Prix à définir'}</span>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <ShoppingBag size={24} className="text-gray-300" />
              </div>
              <p className="text-gray-400 text-sm">Recherchez et ajoutez des ingrédients ci-dessus</p>
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
            <button onClick={onClose}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
            <button onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0}
              className="px-5 py-2.5 bg-gradient-to-r from-slate-600 to-gray-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2 disabled:opacity-50">
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
              {createMutation.isPending ? 'Création...' : 'Créer le bon de commande'}
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-2xl text-center shadow-2xl">
        <Loader2 className="animate-spin text-slate-400 mx-auto mb-3" size={28} />
        <p className="text-sm text-gray-400">Chargement...</p>
      </div>
    </div>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];
  const totalOrdered = items.reduce((s, it) => s + parseFloat(it.quantity_ordered) * (it.unit_price != null ? parseFloat(it.unit_price) : 0), 0);
  const totalDelivered = items.reduce((s, it) => s + parseFloat(it.quantity_delivered) * (it.unit_price != null ? parseFloat(it.unit_price) : 0), 0);
  const globalPct = totalOrdered > 0 ? (totalDelivered / totalOrdered) * 100 : 0;
  const StatusIcon = STATUS_ICONS[po.status] || Clock;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-600 to-gray-700 px-6 py-5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white">{po.order_number}</h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[po.status] || ''}`}>
                  <StatusIcon size={12} />
                  {STATUS_LABELS[po.status] || po.status}
                </span>
              </div>
              <p className="text-sm text-white/70 mt-1">
                {po.supplier_name} — Créé par {po.created_by_name}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Info cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Commande</p>
              <p className="font-medium text-sm mt-1">{format(new Date(po.order_date), 'dd MMM yyyy', { locale: fr })}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Livraison prévue</p>
              <p className="font-medium text-sm mt-1">
                {po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Date livraison</p>
              <p className="font-medium text-sm mt-1">
                {po.delivery_date ? format(new Date(po.delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
          </div>

          {/* Global progress */}
          {(po.status === 'livre_partiel' || po.status === 'livre_complet') && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Progression globale</span>
                <span className="text-sm font-bold">{globalPct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${globalPct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                  style={{ width: `${Math.min(100, globalPct)}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span>Commande: {n(totalOrdered)} DH</span>
                <span>Livré: {n(totalDelivered)} DH</span>
              </div>
            </div>
          )}

          {po.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <FileText size={14} className="inline mr-1.5" /> {po.notes}
            </div>
          )}

          {/* Items table */}
          <div className="border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Ingrédient</th>
                  <th className="text-right px-4 py-2.5">Commandé</th>
                  <th className="text-right px-4 py-2.5">Livré</th>
                  <th className="text-right px-4 py-2.5">Prix unit.</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-right px-4 py-2.5 w-28">État</th>
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
                      <td className="px-4 py-2.5 text-right text-gray-600">{item.unit_price != null ? `${n(parseFloat(item.unit_price))} DH` : <span className="text-amber-500 text-xs">À définir</span>}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{item.unit_price != null ? `${n(ordered * parseFloat(item.unit_price))} DH` : <span className="text-gray-400">—</span>}</td>
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
            <span className="font-semibold text-green-700">Total livré: <span className="text-lg">{n(totalDelivered)} DH</span></span>
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
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [lotInfo, setLotInfo] = useState<Record<string, { supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }>>({});

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[] }) =>
      purchaseOrdersApi.confirmDelivery(poId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-pos'] });
      toast.success('Réception confirmée — stock et facture mis à jour');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la confirmation'),
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-2xl text-center shadow-2xl">
        <Loader2 className="animate-spin text-emerald-400 mx-auto mb-3" size={28} />
        <p className="text-sm text-gray-400">Chargement...</p>
      </div>
    </div>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  const handleSubmit = () => {
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => ({
        itemId, quantityDelivered,
        ...(prices[itemId] != null && prices[itemId] > 0 ? { unitPrice: prices[itemId] } : {}),
        ...lotInfo[itemId],
      }));
    if (deliveredItems.length === 0) { toast.error('Saisissez au moins une quantité livrée'); return; }
    confirmMutation.mutate({ items: deliveredItems });
  };

  const fillAll = () => {
    const filled: Record<string, number> = {};
    const filledPrices: Record<string, number> = {};
    items.forEach((item) => {
      const remaining = parseFloat(item.quantity_ordered) - parseFloat(item.quantity_delivered);
      if (remaining > 0) {
        filled[item.id] = remaining;
        if (item.unit_price != null) filledPrices[item.id] = parseFloat(item.unit_price);
      }
    });
    setDeliveries(filled);
    setPrices(prev => ({ ...prev, ...filledPrices }));
  };

  const totalDelivering = Object.entries(deliveries).reduce((sum, [itemId, qty]) => {
    const price = prices[itemId] ?? (() => { const item = items.find(it => it.id === itemId); return item?.unit_price != null ? parseFloat(item.unit_price) : 0; })();
    return sum + qty * price;
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50">
      <div className="bg-white w-full h-full flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-6 py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <PackageCheck size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Confirmer la réception</h2>
                <p className="text-sm text-white/70">{po.order_number} — {po.supplier_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
          </div>
        </div>

        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Fill all button */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Saisissez les quantités reçues pour chaque article</p>
            <button onClick={fillAll}
              className="text-sm text-emerald-700 font-medium flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors">
              <CheckCircle2 size={14} /> Tout reçu
            </button>
          </div>

          {/* Items */}
          <div className="border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ingrédient</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Commandé</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Déjà reçu</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Restant</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Qté reçue</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Prix U.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Total</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Ref. lot</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">DLC</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Date prod.</th>
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
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="0" />
                        ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="number" min={0} step="0.01"
                            value={prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : '')}
                            onChange={(e) => setPrices({ ...prices, [item.id]: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Prix" />
                        ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {(() => {
                          const qty = deliveries[item.id] || 0;
                          const price = prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : 0);
                          const lineTotal = qty * price;
                          return lineTotal > 0
                            ? <span className="text-sm font-semibold text-gray-700">{n(lineTotal)}</span>
                            : <span className="text-sm text-gray-400">—</span>;
                        })()}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="text"
                            value={lotInfo[item.id]?.supplierLotNumber ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], supplierLotNumber: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Lot" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.expirationDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], expirationDate: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.manufacturedDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], manufacturedDate: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of what's being received */}
          {totalDelivering > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-emerald-700 flex items-center gap-1.5">
                <ArrowRight size={14} />
                Valeur de cette réception
              </span>
              <span className="font-bold text-emerald-800">{n(totalDelivering)} DH</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-2 shrink-0 bg-white">
          <button onClick={onClose}
            className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
            {confirmMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={16} />}
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer la réception'}
          </button>
        </div>
      </div>
    </div>
  );
}
