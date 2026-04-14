import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import {
  ClipboardList, Plus, Phone, Pencil, Search, Eye, X,
  Clock, CheckCircle2, Factory, Truck, Ban, CalendarDays,
  Banknote, CreditCard, ChevronRight, User, Package, FileText,
  AlertCircle,
} from 'lucide-react';
import OrderFormModal from '../../components/orders/OrderFormModal';

const statusConfig: Record<string, { color: string; bg: string; icon: typeof Clock; gradient: string }> = {
  pending:       { color: 'text-gray-600',   bg: 'bg-gray-100',   icon: Clock,         gradient: 'from-gray-400 to-gray-500' },
  confirmed:     { color: 'text-blue-700',   bg: 'bg-blue-50',    icon: CheckCircle2,  gradient: 'from-blue-500 to-blue-600' },
  in_production: { color: 'text-amber-700',  bg: 'bg-amber-50',   icon: Factory,       gradient: 'from-amber-500 to-amber-600' },
  ready:         { color: 'text-emerald-700', bg: 'bg-emerald-50', icon: Package,       gradient: 'from-emerald-500 to-emerald-600' },
  completed:     { color: 'text-gray-500',   bg: 'bg-gray-50',    icon: Truck,         gradient: 'from-gray-400 to-gray-500' },
  cancelled:     { color: 'text-red-600',    bg: 'bg-red-50',     icon: Ban,           gradient: 'from-red-400 to-red-500' },
};

const typeConfig: Record<string, { label: string; color: string }> = {
  custom: { label: 'Sur mesure', color: 'bg-violet-100 text-violet-700' },
  online: { label: 'En ligne',  color: 'bg-sky-100 text-sky-700' },
  event:  { label: 'Événement', color: 'bg-rose-100 text-rose-700' },
};

const statusSteps = ['pending', 'confirmed', 'in_production', 'ready', 'completed'];

function StatusProgress({ status }: { status: string }) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-1.5">
        <Ban size={14} className="text-red-400" />
        <span className="text-xs font-medium text-red-500">Annulée</span>
      </div>
    );
  }
  const currentIdx = statusSteps.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {statusSteps.map((s, i) => {
        const done = i <= currentIdx;
        const cfg = statusConfig[s];
        return (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-all ${done ? `bg-gradient-to-br ${cfg.gradient}` : 'bg-gray-200'}`} />
            {i < statusSteps.length - 1 && (
              <div className={`w-4 h-0.5 ${i < currentIdx ? 'bg-gray-300' : 'bg-gray-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
}

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Record<string, unknown> | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Record<string, unknown> | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<Record<string, unknown> | null>(null);
  const [deliverAmount, setDeliverAmount] = useState('');
  const [deliverPayment, setDeliverPayment] = useState<'cash' | 'card'>('cash');

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status: statusFilter }],
    queryFn: () => ordersApi.list({ status: statusFilter }),
  });

  // Fetch detail when viewing
  const { data: orderDetail } = useQuery({
    queryKey: ['order-detail', viewingOrder?.id],
    queryFn: () => ordersApi.getById(viewingOrder!.id as string),
    enabled: !!viewingOrder,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); notify.success('Statut mis à jour'); },
    onError: () => notify.error('Erreur lors de la mise à jour'),
  });

  const deliverMutation = useMutation({
    mutationFn: ({ id, amountPaid, paymentMethod }: { id: string; amountPaid: number; paymentMethod: string }) =>
      ordersApi.deliver(id, { amountPaid, paymentMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setDeliverOrder(null);
      setDeliverAmount('');
      setDeliverPayment('cash');
      notify.success('Commande livrée avec succès !');
    },
    onError: () => notify.error('Erreur lors de la livraison'),
  });

  const orders = data?.data || [];

  // Search filter
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter((o: Record<string, unknown>) =>
      (o.order_number as string)?.toLowerCase().includes(q) ||
      `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.toLowerCase().includes(q) ||
      (o.customer_phone as string)?.toLowerCase().includes(q)
    );
  }, [orders, searchQuery]);

  // Stats counts
  const allOrders = data?.data || [];
  const stats = useMemo(() => ({
    total: allOrders.length,
    pending: allOrders.filter((o: Record<string, unknown>) => o.status === 'pending').length,
    confirmed: allOrders.filter((o: Record<string, unknown>) => o.status === 'confirmed').length,
    in_production: allOrders.filter((o: Record<string, unknown>) => o.status === 'in_production').length,
    ready: allOrders.filter((o: Record<string, unknown>) => o.status === 'ready').length,
    completed: allOrders.filter((o: Record<string, unknown>) => o.status === 'completed').length,
  }), [allOrders]);

  const tabs = [
    { key: '', label: 'Toutes', count: stats.total, icon: ClipboardList, color: 'blue' },
    { key: 'pending', label: 'Brouillon', count: stats.pending, icon: Clock, color: 'gray' },
    { key: 'confirmed', label: 'Confirmées', count: stats.confirmed, icon: CheckCircle2, color: 'blue' },
    { key: 'in_production', label: 'En production', count: stats.in_production, icon: Factory, color: 'amber' },
    { key: 'ready', label: 'Prêtes', count: stats.ready, icon: Package, color: 'emerald' },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Commandes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestion des commandes clients pour la production</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 shadow-sm">
          <Plus size={18} /> Nouvelle commande
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'En attente', value: stats.pending, icon: Clock, gradient: 'from-gray-400 to-gray-500', bg: 'bg-gray-50' },
          { label: 'Confirmées', value: stats.confirmed, icon: CheckCircle2, gradient: 'from-blue-500 to-blue-600', bg: 'bg-blue-50' },
          { label: 'En production', value: stats.in_production, icon: Factory, gradient: 'from-amber-500 to-amber-600', bg: 'bg-amber-50' },
          { label: 'Prêtes', value: stats.ready, icon: Package, gradient: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Terminées', value: stats.completed, icon: Truck, gradient: 'from-violet-500 to-violet-600', bg: 'bg-violet-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${stat.gradient} flex items-center justify-center`}>
                <stat.icon size={18} className="text-white" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-800">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.key
                  ? 'bg-white text-orange-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === tab.key ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] ml-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par n°, client ou téléphone..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
          />
        </div>
      </div>

      {/* Orders list */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Chargement des commandes...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <ClipboardList size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Aucune commande trouvée</p>
          <p className="text-xs text-gray-300 mt-1">
            {searchQuery ? 'Essayez une autre recherche' : 'Créez votre première commande'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((o: Record<string, unknown>) => {
            const advanceAmt = parseFloat((o.advance_amount as string) || '0');
            const totalAmt = parseFloat(o.total as string);
            const remaining = totalAmt - advanceAmt;
            const status = o.status as string;
            const cfg = statusConfig[status] || statusConfig.pending;
            const typeCfg = typeConfig[o.type as string] || typeConfig.custom;
            const StatusIcon = cfg.icon;

            return (
              <div key={o.id as string}
                className="bg-white rounded-xl border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all group">
                <div className="flex items-stretch">
                  {/* Left color bar */}
                  <div className={`w-1 rounded-l-xl bg-gradient-to-b ${cfg.gradient} flex-shrink-0`} />

                  {/* Main content */}
                  <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono text-sm font-bold text-gray-800">{o.order_number as string}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.color}`}>
                            <StatusIcon size={12} className="inline -mt-0.5 mr-0.5" />
                            {ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${typeCfg.color}`}>
                            {typeCfg.label}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-sm">
                          {/* Customer */}
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <User size={14} className="text-gray-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-700 truncate">
                                {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name}` : '—'}
                              </p>
                              {o.customer_phone && (
                                <p className="text-xs text-gray-400 flex items-center gap-1">
                                  <Phone size={10} /> {o.customer_phone as string}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Pickup date */}
                          <div className="flex items-center gap-1.5 text-gray-500 flex-shrink-0">
                            <CalendarDays size={14} className="text-gray-400" />
                            <span className="text-xs">
                              {o.pickup_date ? format(new Date(o.pickup_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}
                            </span>
                          </div>

                          {/* Progress */}
                          <div className="hidden md:block">
                            <StatusProgress status={status} />
                          </div>
                        </div>
                      </div>

                      {/* Right: amounts + actions */}
                      <div className="flex items-center gap-4 flex-shrink-0">
                        {/* Amounts */}
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-800">{formatCurrency(totalAmt)}</p>
                          {advanceAmt > 0 ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-medium text-emerald-600">Avance {formatCurrency(advanceAmt)}</span>
                              <span className="text-xs text-gray-400">Reste {formatCurrency(remaining)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">Aucune avance</span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setViewingOrder(o)}
                            className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                            title="Voir le détail">
                            <Eye size={16} />
                          </button>

                          {(status === 'pending' || status === 'confirmed') && (
                            <button onClick={() => setEditingOrder(o)}
                              className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-blue-50 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors"
                              title="Modifier">
                              <Pencil size={14} />
                            </button>
                          )}

                          {status === 'pending' && (
                            <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' })}
                              className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors flex items-center gap-1">
                              <CheckCircle2 size={13} /> Confirmer
                            </button>
                          )}

                          {status === 'confirmed' && (
                            <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' })}
                              className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium transition-colors flex items-center gap-1">
                              <Factory size={13} /> Production
                            </button>
                          )}

                          {status === 'ready' && (
                            <button onClick={() => {
                              setDeliverOrder(o);
                              setDeliverAmount(String(remaining.toFixed(2)));
                            }}
                              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors flex items-center gap-1">
                              <Truck size={13} /> Livrer
                            </button>
                          )}

                          {(status === 'pending' || status === 'confirmed' || status === 'in_production') && (
                            <button onClick={() => {
                              if (confirm('Voulez-vous vraiment annuler cette commande ?'))
                                updateStatusMutation.mutate({ id: o.id as string, status: 'cancelled' });
                            }}
                              className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
                              title="Annuler">
                              <Ban size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Order Form Modal */}
      {showForm && (
        <OrderFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['orders'] }); }}
        />
      )}

      {editingOrder && (
        <OrderFormModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => { setEditingOrder(null); queryClient.invalidateQueries({ queryKey: ['orders'] }); }}
        />
      )}

      {/* Order Detail Modal */}
      {viewingOrder && (() => {
        const o = viewingOrder;
        const status = o.status as string;
        const cfg = statusConfig[status] || statusConfig.pending;
        const typeCfg = typeConfig[o.type as string] || typeConfig.custom;
        const totalAmt = parseFloat(o.total as string);
        const advanceAmt = parseFloat((o.advance_amount as string) || '0');
        const discountAmt = parseFloat((o.discount_amount as string) || '0');
        const remaining = totalAmt - advanceAmt;
        const StatusIcon = cfg.icon;

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
              {/* Header with gradient */}
              <div className={`bg-gradient-to-r ${cfg.gradient} rounded-t-2xl px-6 py-5 text-white relative`}>
                <button onClick={() => setViewingOrder(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
                  <X size={16} />
                </button>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <StatusIcon size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{o.order_number as string}</h2>
                    <p className="text-sm text-white/80">
                      {ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]}
                    </p>
                  </div>
                </div>
                <StatusProgress status={status} />
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Client + Meta */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Client</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm">
                        {((o.customer_first_name as string) || '?')[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">
                          {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name}` : '—'}
                        </p>
                        {o.customer_phone && (
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            <Phone size={10} /> {o.customer_phone as string}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Détails</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Type</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${typeCfg.color}`}>{typeCfg.label}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Retrait</span>
                        <span className="font-medium text-gray-700">
                          {o.pickup_date ? format(new Date(o.pickup_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Créée le</span>
                        <span className="text-gray-600 text-xs">
                          {o.created_at ? format(new Date(o.created_at as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Articles commandés</p>
                  {orderDetail?.items && orderDetail.items.length > 0 ? (
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      {orderDetail.items.map((item: Record<string, unknown>, idx: number) => (
                        <div key={idx} className={`flex items-center justify-between px-4 py-3 ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500">
                              <Package size={14} />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{item.product_name as string || item.product_id as string}</p>
                              {item.notes && <p className="text-xs text-gray-400">{item.notes as string}</p>}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-700">
                              {formatCurrency(parseFloat(item.unit_price as string) * (item.quantity as number))}
                            </p>
                            <p className="text-xs text-gray-400">
                              {item.quantity as number} x {formatCurrency(parseFloat(item.unit_price as string))}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-300 text-sm">Chargement des articles...</div>
                  )}
                </div>

                {/* Payment summary */}
                <div className="bg-orange-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Sous-total</span>
                    <span className="font-medium">{formatCurrency(totalAmt + discountAmt)}</span>
                  </div>
                  {discountAmt > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>Remise</span>
                      <span>-{formatCurrency(discountAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold border-t border-orange-200 pt-2">
                    <span>Total</span>
                    <span>{formatCurrency(totalAmt)}</span>
                  </div>
                  {advanceAmt > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-emerald-600 font-medium">Avance versée</span>
                        <span className="text-emerald-600 font-medium">{formatCurrency(advanceAmt)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold">
                        <span>Reste à payer</span>
                        <span className="text-orange-600">{formatCurrency(remaining)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Notes */}
                {o.notes && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText size={14} className="text-gray-400" />
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Notes</p>
                    </div>
                    <p className="text-sm text-gray-600">{o.notes as string}</p>
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="border-t px-6 py-4 flex items-center gap-3">
                <button onClick={() => setViewingOrder(null)}
                  className="btn-secondary flex-1">
                  Fermer
                </button>
                {(status === 'pending' || status === 'confirmed') && (
                  <button onClick={() => { setViewingOrder(null); setEditingOrder(o); }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                    <Pencil size={14} /> Modifier
                  </button>
                )}
                {status === 'pending' && (
                  <button onClick={() => { setViewingOrder(null); updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' }); }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                    <CheckCircle2 size={14} /> Confirmer
                  </button>
                )}
                {status === 'confirmed' && (
                  <button onClick={() => { setViewingOrder(null); updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' }); }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors">
                    <Factory size={14} /> Envoyer en production
                  </button>
                )}
                {status === 'ready' && (
                  <button onClick={() => {
                    setViewingOrder(null);
                    setDeliverOrder(o);
                    setDeliverAmount(String(remaining.toFixed(2)));
                  }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
                    <Truck size={14} /> Livrer
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delivery Modal */}
      {deliverOrder && (() => {
        const totalAmt = parseFloat(deliverOrder.total as string);
        const advanceAmt = parseFloat(deliverOrder.advance_amount as string || '0');
        const remaining = totalAmt - advanceAmt;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
              {/* Header */}
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-t-2xl px-6 py-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Truck size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Livraison</h2>
                    <p className="text-sm text-white/80">{deliverOrder.order_number as string}</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Customer */}
                {deliverOrder.customer_first_name && (
                  <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                    <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm">
                      {((deliverOrder.customer_first_name as string) || '?')[0]}
                    </div>
                    <div>
                      <p className="font-medium text-gray-700 text-sm">{deliverOrder.customer_first_name as string} {deliverOrder.customer_last_name as string}</p>
                      {deliverOrder.customer_phone && (
                        <p className="text-xs text-gray-400">{deliverOrder.customer_phone as string}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Amount breakdown */}
                <div className="bg-emerald-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total commande</span>
                    <span className="font-semibold">{formatCurrency(totalAmt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avance versée</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(advanceAmt)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-emerald-200 pt-2 text-base">
                    <span>Reste à payer</span>
                    <span className="text-emerald-700">{formatCurrency(remaining)}</span>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Montant encaissé</label>
                  <div className="relative">
                    <Banknote size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="number" value={deliverAmount} onChange={(e) => setDeliverAmount(e.target.value)}
                      className="w-full pl-10 pr-14 py-3 text-xl font-bold border border-gray-200 rounded-xl text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                      min="0" step="0.01" autoFocus />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">DH</span>
                  </div>
                </div>

                {/* Payment method */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setDeliverPayment('cash')}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                        deliverPayment === 'cash'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      <Banknote size={18} /> Espèces
                    </button>
                    <button onClick={() => setDeliverPayment('card')}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                        deliverPayment === 'card'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      <CreditCard size={18} /> Carte bancaire
                    </button>
                  </div>
                </div>

                {/* Remaining after payment */}
                {parseFloat(deliverAmount || '0') < remaining && parseFloat(deliverAmount || '0') > 0 && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
                    <p className="text-xs text-amber-700">
                      Le client doit encore <strong>{formatCurrency(remaining - parseFloat(deliverAmount || '0'))}</strong> après cet encaissement
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setDeliverOrder(null); setDeliverAmount(''); }}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    Annuler
                  </button>
                  <button onClick={() => deliverMutation.mutate({
                    id: deliverOrder.id as string,
                    amountPaid: parseFloat(deliverAmount) || 0,
                    paymentMethod: deliverPayment,
                  })}
                    disabled={deliverMutation.isPending}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {deliverMutation.isPending ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> En cours...</>
                    ) : (
                      <><CheckCircle2 size={16} /> Confirmer la livraison</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
