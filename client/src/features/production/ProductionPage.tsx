import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productionApi } from '../../api/production.api';
import { productsApi } from '../../api/products.api';
import { ordersApi } from '../../api/orders.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { PRODUCTION_STATUS_LABELS, PRODUCTION_TYPE_LABELS, ROLE_CATEGORY_SLUGS, getRoleCategorySlugs } from '@ofauria/shared';
import { Plus, Trash2, Factory, Calendar, ShoppingBag, Package } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];
const ROLE_LABELS: Record<string, string> = {
  baker: 'Boulanger',
  pastry_chef: 'Patissier',
  viennoiserie: 'Viennoiserie',
  beldi_sale: 'Beldi & Sale',
};

const roleColors: Record<string, string> = {
  baker: 'bg-amber-100 text-amber-800',
  pastry_chef: 'bg-pink-100 text-pink-800',
  viennoiserie: 'bg-orange-100 text-orange-800',
};

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
};

export default function ProductionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const isChef = CHEF_ROLES.includes(user?.role || '');
  const isAdmin = ['admin', 'manager'].includes(user?.role || '');

  // Chefs automatically see only their own plans; admins can filter manually
  const effectiveRole = isChef ? (user?.role || '') : roleFilter;
  const { data, isLoading } = useQuery({
    queryKey: ['production', { status: statusFilter, targetRole: effectiveRole }],
    queryFn: () => productionApi.list({
      status: statusFilter,
      ...(effectiveRole ? { targetRole: effectiveRole } : {}),
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: productionApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production'] }); toast.success('Plan supprime'); },
  });

  const plans = data?.data || [];
  const tabs = ['', 'draft', 'confirmed', 'in_progress', 'completed'];
  const tabLabels = ['Tous', ...Object.values(PRODUCTION_STATUS_LABELS)];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Planification de la production</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouveau plan
        </button>
      </div>

      {/* Role filter for admin/manager */}
      {isAdmin && (
        <div className="flex gap-2 overflow-x-auto">
          <button onClick={() => setRoleFilter('')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              roleFilter === '' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}>
            Tous les chefs
          </button>
          {CHEF_ROLES.map(role => (
            <button key={role} onClick={() => setRoleFilter(role)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                roleFilter === role ? 'bg-gray-800 text-white' : `bg-white text-gray-600 hover:bg-gray-100`
              }`}>
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setStatusFilter(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}>
            {tabLabels[i]}
          </button>
        ))}
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Date</th>
                {isAdmin && <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Chef</th>}
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Articles</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Cree par</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {plans.map((p: Record<string, unknown>) => (
                <tr key={p.id as string} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/production/${p.id}`)}>
                  <td className="px-6 py-4 font-medium">
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-gray-400" />
                      {format(new Date(p.plan_date as string), 'dd MMM yyyy', { locale: fr })}
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4">
                      {p.target_role ? (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColors[p.target_role as string] || 'bg-gray-100 text-gray-700'}`}>
                          {ROLE_LABELS[p.target_role as string] || p.target_role}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                      {PRODUCTION_TYPE_LABELS[(p.type as string) as keyof typeof PRODUCTION_TYPE_LABELS]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <div>{p.item_count as number} produit(s)</div>
                    {p.order_number && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-blue-600">
                        <Package size={12} />
                        {p.order_number}
                        {p.order_customer_name && <span className="text-gray-400">— {p.order_customer_name as string}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[p.status as string]}`}>
                      {PRODUCTION_STATUS_LABELS[(p.status as string) as keyof typeof PRODUCTION_STATUS_LABELS]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{p.created_by_name as string}</td>
                  <td className="px-6 py-4 text-right">
                    {p.status === 'draft' && (
                      <button onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(p.id as string); }}
                        className="p-2 hover:bg-red-50 rounded-lg">
                        <Trash2 size={16} className="text-red-500" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {plans.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Factory size={40} className="mx-auto mb-3 opacity-50" />
              <p>Aucun plan de production</p>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <PlanFormModal
          onClose={() => setShowForm(false)}
          onCreated={(id) => { setShowForm(false); navigate(`/production/${id}`); }}
        />
      )}
    </div>
  );
}

function PlanFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { getModuleConfig } = usePermissions();
  const [planDate, setPlanDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [type, setType] = useState<'daily' | 'weekly'>('daily');
  const [notes, setNotes] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [orderQtys, setOrderQtys] = useState<Record<string, number>>({});
  const [selectedRole, setSelectedRole] = useState<string>(
    CHEF_ROLES.includes(user?.role || '') ? user!.role : ''
  );

  const isAdminUser = ['admin', 'manager'].includes(user?.role || '');

  // Filter products by role-based category slugs
  const allowedSlugs = selectedRole
    ? getRoleCategorySlugs(selectedRole)
    : (getModuleConfig('production').category_slugs as string[] | undefined) || null;

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const allProducts = (productsData?.data || []) as Record<string, unknown>[];
  // Apply permission-based category filter
  const products = allowedSlugs
    ? allProducts.filter(p => allowedSlugs.includes(p.category_slug as string))
    : allProducts;

  const { data: ordersForDate, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-for-date', planDate],
    queryFn: () => ordersApi.forDate(planDate),
    enabled: !!planDate,
  });

  // Aggregate order quantities by product when date changes
  const orders = (ordersForDate || []) as Record<string, unknown>[];
  const orderCount = orders.length;

  // Compute aggregated order quantities
  const computeOrderQtys = () => {
    const qtys: Record<string, number> = {};
    orders.forEach((order) => {
      const items = (order.items || []) as Record<string, unknown>[];
      items.forEach((item) => {
        const pid = item.product_id as string;
        qtys[pid] = (qtys[pid] || 0) + (item.quantity as number);
      });
    });
    return qtys;
  };

  // Auto-load pre-orders into selection when orders data changes
  const currentOrderQtysStr = JSON.stringify(computeOrderQtys());
  if (currentOrderQtysStr !== JSON.stringify(orderQtys)) {
    const newOrderQtys = JSON.parse(currentOrderQtysStr) as Record<string, number>;
    setOrderQtys(newOrderQtys);
    // Merge order quantities into selected (add on top of manual selections)
    setSelected((prev) => {
      const next: Record<string, number> = {};
      // Keep only manual additions (subtract old order qtys)
      for (const [pid, qty] of Object.entries(prev)) {
        const oldOrderQty = orderQtys[pid] || 0;
        const manual = qty - oldOrderQty;
        if (manual > 0) next[pid] = manual;
      }
      // Add new order quantities
      for (const [pid, qty] of Object.entries(newOrderQtys)) {
        next[pid] = (next[pid] || 0) + qty;
      }
      return next;
    });
  }

  const categories = Array.from(
    new Map(
      products
        .filter((p) => p.category_name)
        .map((p) => [p.category_id as number, p.category_name as string])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredProducts = products.filter((p) => {
    if (activeCategory && String(p.category_id) !== activeCategory) return false;
    if (search && !(p.name as string).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setQty = (productId: string, qty: number) => {
    const minQty = orderQtys[productId] || 0;
    setSelected((prev) => {
      const next = { ...prev };
      if (qty <= 0 && minQty <= 0) { delete next[productId]; }
      else { next[productId] = Math.max(qty, minQty); }
      return next;
    });
  };

  const totalSelected = Object.keys(selected).length;

  const createMutation = useMutation({
    mutationFn: productionApi.create,
    onSuccess: (plan: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      toast.success('Plan de production cree');
      onCreated(plan.id as string);
    },
  });

  const handleSubmit = () => {
    if (isAdminUser && !selectedRole) { toast.error('Selectionnez un chef'); return; }
    const items = Object.entries(selected).map(([productId, plannedQuantity]) => ({ productId, plannedQuantity }));
    if (items.length === 0) { toast.error('Selectionnez au moins un produit'); return; }
    createMutation.mutate({ planDate, type, notes: notes || undefined, targetRole: selectedRole || undefined, items });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full sm:rounded-2xl flex flex-col sm:m-4 sm:max-h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-bakery-chocolate">Nouveau plan de production</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Settings bar */}
        <div className="px-5 py-3 border-b bg-gray-50 shrink-0">
          <div className="flex flex-wrap gap-3 items-end">
            {isAdminUser && (
              <div className="w-48">
                <label className="block text-xs font-medium text-gray-500 mb-1">Chef responsable *</label>
                <select value={selectedRole} onChange={(e) => { setSelectedRole(e.target.value); setSelected({}); setActiveCategory(''); }}
                  className="input text-base py-2.5">
                  <option value="">-- Choisir un chef --</option>
                  {CHEF_ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Date de production</label>
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)}
                className="input text-base py-2.5" required />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as 'daily' | 'weekly')}
                className="input text-base py-2.5">
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optionnel)</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="input text-base py-2.5" placeholder="Ex: commande speciale..." />
            </div>
          </div>
        </div>

        {/* Pre-orders banner */}
        {orderCount > 0 && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 shrink-0">
            <div className="flex items-center gap-2 text-blue-800">
              <ShoppingBag size={18} className="text-blue-500" />
              <span className="text-sm font-medium">
                {orderCount} pre-commande(s) pour cette date
              </span>
              <span className="text-xs text-blue-500 ml-1">
                — quantites ajoutees automatiquement
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(orderQtys).map(([pid, qty]) => {
                const prod = products.find((p) => p.id === pid);
                return (
                  <span key={pid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                    <ShoppingBag size={12} /> {prod ? prod.name as string : pid} &times;{qty}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {ordersLoading && (
          <div className="px-5 py-2 bg-gray-50 border-b text-sm text-gray-400 shrink-0">
            Chargement des pre-commandes...
          </div>
        )}

        {/* Category sidebar + Products grid */}
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar (left) */}
          <div className="w-44 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-2 flex flex-col gap-1.5">
            <button type="button" onClick={() => setActiveCategory('')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                !activeCategory ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              Tous
            </button>
            {categories.map(([id, name]) => (
              <button key={id} type="button" onClick={() => setActiveCategory(String(id))}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeCategory === String(id) ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {name}
              </button>
            ))}
          </div>

          {/* Right content: search + grid */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Search */}
            <div className="px-5 py-2 shrink-0">
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit..."
                className="input text-base py-2.5 w-full" />
            </div>

            {/* Products grid */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map((p) => {
                  const pid = p.id as string;
                  const qty = selected[pid] || 0;
                  const fromOrders = orderQtys[pid] || 0;
                  const isSelected = qty > 0;
                  return (
                    <div key={pid}
                      className={`rounded-xl border-2 p-3 transition-all select-none ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 shadow-sm'
                          : 'border-gray-200 bg-white active:border-gray-300'
                      }`}>
                      <div className="text-sm font-semibold text-gray-800 mb-1 leading-tight h-[2.5rem]" title={p.name as string}>
                        <span className="line-clamp-2">{p.name as string}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-xs text-gray-400">{p.category_name as string}</span>
                        {fromOrders > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                            CMD: {fromOrders}
                          </span>
                        )}
                      </div>

                      {!isSelected ? (
                        <button type="button" onClick={() => setQty(pid, Math.max(1, fromOrders))}
                          className="w-full py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium active:bg-primary-700 transition-colors">
                          <Plus size={16} className="inline -mt-0.5 mr-1" /> Ajouter
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-white rounded-lg border border-primary-200 overflow-hidden">
                          <button type="button" onClick={() => setQty(pid, qty - 1)}
                            className={`w-12 h-11 flex items-center justify-center text-xl font-bold transition-colors ${
                              qty <= fromOrders && fromOrders > 0
                                ? 'text-gray-300 cursor-not-allowed'
                                : 'text-primary-600 active:bg-primary-50'
                            }`}
                            disabled={qty <= fromOrders && fromOrders > 0}>
                            {qty === 1 && fromOrders === 0 ? <Trash2 size={16} className="text-red-400" /> : '−'}
                          </button>
                          <input type="number" min={fromOrders || 1} value={qty}
                            onChange={(e) => setQty(pid, parseInt(e.target.value) || 0)}
                            className="w-14 text-center text-lg font-bold border-x border-primary-200 h-11 focus:outline-none" />
                          <button type="button" onClick={() => setQty(pid, qty + 1)}
                            className="w-12 h-11 flex items-center justify-center text-xl font-bold text-primary-600 active:bg-primary-50 transition-colors">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-gray-400">Aucun produit trouve</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer with selected summary & submit */}
        <div className="border-t bg-white px-5 py-4 shrink-0 rounded-b-2xl">
          {totalSelected > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(selected).map(([pid, qty]) => {
                const prod = products.find((p) => p.id === pid);
                const fromOrder = orderQtys[pid] || 0;
                return (
                  <span key={pid} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-100 text-primary-800 text-sm font-medium">
                    {fromOrder > 0 && <ShoppingBag size={12} className="text-blue-500" />}
                    {prod ? prod.name as string : pid} <strong>&times;{qty}</strong>
                    {fromOrder > 0 && fromOrder < qty && (
                      <span className="text-xs text-gray-400">(dont {fromOrder} cmd)</span>
                    )}
                    {fromOrder === 0 && (
                      <button type="button" onClick={() => setQty(pid, 0)}
                        className="ml-1 text-primary-400 hover:text-red-500">&times;</button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              {totalSelected > 0 ? `${totalSelected} produit(s) selectionne(s)` : 'Aucun produit selectionne'}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="btn-secondary px-5 py-2.5 text-base">Annuler</button>
              <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || totalSelected === 0}
                className="btn-primary px-6 py-2.5 text-base disabled:opacity-50">
                {createMutation.isPending ? 'Creation...' : `Creer le plan (${totalSelected})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
