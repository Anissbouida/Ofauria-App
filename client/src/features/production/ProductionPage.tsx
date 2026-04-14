import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productionApi } from '../../api/production.api';
import { productsApi } from '../../api/products.api';
import { ordersApi } from '../../api/orders.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { PRODUCTION_STATUS_LABELS, PRODUCTION_TYPE_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import {
  Plus, Trash2, Factory, Calendar, ShoppingBag, Package, Search,
  Clock, CheckCircle2, Play, Flag, Eye, AlertCircle,
  FileText, User,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];
const ROLE_LABELS: Record<string, string> = {
  baker: 'Boulanger',
  pastry_chef: 'Pâtissier',
  viennoiserie: 'Viennoiserie',
  beldi_sale: 'Beldi & Salé',
};

const roleConfig: Record<string, { color: string; bg: string; gradient: string }> = {
  baker:        { color: 'text-amber-700',  bg: 'bg-amber-50',  gradient: 'from-amber-500 to-amber-600' },
  pastry_chef:  { color: 'text-pink-700',   bg: 'bg-pink-50',   gradient: 'from-pink-500 to-pink-600' },
  viennoiserie: { color: 'text-orange-700', bg: 'bg-orange-50', gradient: 'from-orange-500 to-orange-600' },
  beldi_sale:   { color: 'text-teal-700',   bg: 'bg-teal-50',   gradient: 'from-teal-500 to-teal-600' },
};

const statusConfig: Record<string, { color: string; bg: string; icon: typeof Clock; gradient: string }> = {
  draft:       { color: 'text-gray-600',    bg: 'bg-gray-100',    icon: FileText,     gradient: 'from-gray-400 to-gray-500' },
  confirmed:   { color: 'text-blue-700',    bg: 'bg-blue-50',     icon: CheckCircle2, gradient: 'from-blue-500 to-blue-600' },
  in_progress: { color: 'text-amber-700',   bg: 'bg-amber-50',    icon: Play,         gradient: 'from-amber-500 to-amber-600' },
  completed:   { color: 'text-emerald-700', bg: 'bg-emerald-50',  icon: Flag,         gradient: 'from-emerald-500 to-emerald-600' },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
}

export default function ProductionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

  const isChef = CHEF_ROLES.includes(user?.role || '');
  const isAdmin = ['admin', 'manager'].includes(user?.role || '');

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production'] }); notify.success('Plan supprimé'); },
  });

  const plans = data?.data || [];

  // Search filter
  const filteredPlans = useMemo(() => {
    if (!searchQuery.trim()) return plans;
    const q = searchQuery.toLowerCase();
    return plans.filter((p: Record<string, unknown>) =>
      (p.order_number as string)?.toLowerCase().includes(q) ||
      (p.order_customer_name as string)?.toLowerCase().includes(q) ||
      (p.created_by_name as string)?.toLowerCase().includes(q) ||
      (ROLE_LABELS[p.target_role as string] || '').toLowerCase().includes(q) ||
      format(new Date(p.plan_date as string), 'dd MMM yyyy', { locale: fr }).toLowerCase().includes(q)
    );
  }, [plans, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    total: plans.length,
    draft: plans.filter((p: Record<string, unknown>) => p.status === 'draft').length,
    confirmed: plans.filter((p: Record<string, unknown>) => p.status === 'confirmed').length,
    in_progress: plans.filter((p: Record<string, unknown>) => p.status === 'in_progress').length,
    completed: plans.filter((p: Record<string, unknown>) => p.status === 'completed').length,
  }), [plans]);

  const tabs = [
    { key: '', label: 'Tous', count: stats.total, icon: Factory },
    { key: 'draft', label: 'Brouillon', count: stats.draft, icon: FileText },
    { key: 'confirmed', label: 'Confirmé', count: stats.confirmed, icon: CheckCircle2 },
    { key: 'in_progress', label: 'En cours', count: stats.in_progress, icon: Play },
    { key: 'completed', label: 'Terminé', count: stats.completed, icon: Flag },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Production</h1>
          <p className="text-sm text-gray-500 mt-0.5">Planification et suivi de la production</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 shadow-sm">
          <Plus size={18} /> Nouveau plan
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Brouillons', value: stats.draft, icon: FileText, gradient: 'from-gray-400 to-gray-500' },
          { label: 'Confirmés', value: stats.confirmed, icon: CheckCircle2, gradient: 'from-blue-500 to-blue-600' },
          { label: 'En cours', value: stats.in_progress, icon: Play, gradient: 'from-amber-500 to-amber-600' },
          { label: 'Terminés', value: stats.completed, icon: Flag, gradient: 'from-emerald-500 to-emerald-600' },
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
        {/* Role filter for admin */}
        {isAdmin && (
          <>
            <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
              <button onClick={() => setRoleFilter('')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  roleFilter === '' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                Tous
              </button>
              {CHEF_ROLES.map(role => {
                const cfg = roleConfig[role] || roleConfig.baker;
                return (
                  <button key={role} onClick={() => setRoleFilter(role)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      roleFilter === role ? `bg-white ${cfg.color} shadow-sm` : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
            <div className="w-px h-6 bg-gray-200" />
          </>
        )}

        {/* Status tabs */}
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.key
                  ? 'bg-white text-amber-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              <tab.icon size={13} />
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === tab.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] ml-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par date, chef, commande..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400" />
        </div>
      </div>

      {/* Plans table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Chargement des plans...</p>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Factory size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">Aucun plan de production</p>
          <p className="text-xs text-gray-300 mt-1">
            {searchQuery ? 'Essayez une autre recherche' : 'Créez votre premier plan de production'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50/60">
                  <th className="text-left px-5 py-3">N° Plan</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-center px-4 py-3">Statut</th>
                  <th className="text-center px-4 py-3">Type</th>
                  {isAdmin && <th className="text-left px-4 py-3">Chef</th>}
                  <th className="text-center px-4 py-3">Produits</th>
                  <th className="text-left px-4 py-3">Créé par</th>
                  <th className="text-left px-4 py-3">Commande liée</th>
                  <th className="text-center px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.map((p: Record<string, unknown>, idx: number) => {
                  const status = p.status as string;
                  const sCfg = statusConfig[status] || statusConfig.draft;
                  const rCfg = roleConfig[p.target_role as string] || roleConfig.baker;
                  const StatusIcon = sCfg.icon;
                  const hasOrder = !!p.order_number;
                  const planDate = new Date(p.plan_date as string);
                  const planNumber = (p.id as string).slice(0, 8).toUpperCase();

                  return (
                    <tr key={p.id as string}
                      onClick={() => navigate(`/production/${p.id}`)}
                      className={`border-b border-gray-50 transition-colors hover:bg-amber-50/40 cursor-pointer ${idx % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                      <td className="px-5 py-3.5">
                        <span className="font-mono font-semibold text-gray-700">{planNumber}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                          <span className="font-medium text-gray-800">{format(planDate, 'dd MMM yyyy', { locale: fr })}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${sCfg.bg} ${sCfg.color}`}>
                          <StatusIcon size={12} />
                          {PRODUCTION_STATUS_LABELS[(status) as keyof typeof PRODUCTION_STATUS_LABELS]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          {PRODUCTION_TYPE_LABELS[(p.type as string) as keyof typeof PRODUCTION_TYPE_LABELS]}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3.5">
                          {p.target_role ? (
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${rCfg.bg}`}>
                                <User size={11} className={rCfg.color} />
                              </div>
                              <span className={`font-medium ${rCfg.color}`}>{ROLE_LABELS[p.target_role as string]}</span>
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700">
                          <Package size={14} className="text-gray-400" />
                          {p.item_count as number}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 text-gray-600">
                          <User size={13} className="text-gray-400" />
                          {p.created_by_name as string}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {hasOrder ? (
                          <div className="inline-flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-full">
                            <ShoppingBag size={12} className="text-blue-500" />
                            <span className="font-medium text-blue-700">{p.order_number as string}</span>
                            {p.order_customer_name && (
                              <span className="text-blue-400">— {p.order_customer_name as string}</span>
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {status === 'draft' && (
                            <button onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer ce plan ?')) deleteMutation.mutate(p.id as string); }}
                              className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
                              title="Supprimer">
                              <Trash2 size={15} />
                            </button>
                          )}
                          <div className="w-8 h-8 rounded-lg hover:bg-amber-50 flex items-center justify-center text-gray-300 hover:text-amber-500 transition-colors">
                            <Eye size={15} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

// ═══ Plan Form Modal ═══
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

  const allowedSlugs = selectedRole
    ? getRoleCategorySlugs(selectedRole)
    : (getModuleConfig('production').category_slugs as string[] | undefined) || null;

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const allProducts = (productsData?.data || []) as Record<string, unknown>[];
  const products = allowedSlugs
    ? allProducts.filter(p => allowedSlugs.includes(p.category_slug as string))
    : allProducts;

  const { data: ordersForDate, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-for-date', planDate],
    queryFn: () => ordersApi.forDate(planDate),
    enabled: !!planDate,
  });

  const orders = (ordersForDate || []) as Record<string, unknown>[];
  const orderCount = orders.length;

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

  const currentOrderQtysStr = JSON.stringify(computeOrderQtys());
  if (currentOrderQtysStr !== JSON.stringify(orderQtys)) {
    const newOrderQtys = JSON.parse(currentOrderQtysStr) as Record<string, number>;
    setOrderQtys(newOrderQtys);
    setSelected((prev) => {
      const next: Record<string, number> = {};
      for (const [pid, qty] of Object.entries(prev)) {
        const oldOrderQty = orderQtys[pid] || 0;
        const manual = qty - oldOrderQty;
        if (manual > 0) next[pid] = manual;
      }
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
      notify.success('Plan de production créé');
      onCreated(plan.id as string);
    },
  });

  const handleSubmit = () => {
    if (isAdminUser && !selectedRole) { notify.error('Sélectionnez un chef'); return; }
    const items = Object.entries(selected).map(([productId, plannedQuantity]) => ({ productId, plannedQuantity }));
    if (items.length === 0) { notify.error('Sélectionnez au moins un produit'); return; }
    createMutation.mutate({ planDate, type, notes: notes || undefined, targetRole: selectedRole || undefined, items });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full sm:rounded-2xl flex flex-col sm:m-4 sm:max-h-full">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-4 sm:rounded-t-2xl text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Factory size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold">Nouveau plan de production</h2>
              <p className="text-sm text-white/70">Sélectionnez les produits à produire</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors text-xl leading-none">&times;</button>
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
                className="input text-base py-2.5" placeholder="Ex: commande spéciale..." />
            </div>
          </div>
        </div>

        {/* Pre-orders banner */}
        {orderCount > 0 && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 shrink-0">
            <div className="flex items-center gap-2 text-blue-800">
              <ShoppingBag size={18} className="text-blue-500" />
              <span className="text-sm font-medium">{orderCount} commande(s) pour cette date</span>
              <span className="text-xs text-blue-400 ml-1">— quantités ajoutées automatiquement</span>
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
          <div className="px-5 py-2 bg-gray-50 border-b text-sm text-gray-400 shrink-0">Chargement des commandes...</div>
        )}

        {/* Category sidebar + Products grid */}
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          <div className="w-44 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-2 flex flex-col gap-1.5">
            <button type="button" onClick={() => setActiveCategory('')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                !activeCategory ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              Tous
            </button>
            {categories.map(([id, name]) => (
              <button key={id} type="button" onClick={() => setActiveCategory(String(id))}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeCategory === String(id) ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {name}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-5 py-2 shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un produit..."
                  className="input text-base py-2.5 w-full pl-10" />
              </div>
            </div>

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
                          ? 'border-amber-400 bg-amber-50 shadow-sm'
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
                          className="w-full py-2.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 active:bg-amber-700 transition-colors">
                          <Plus size={16} className="inline -mt-0.5 mr-1" /> Ajouter
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-white rounded-lg border border-amber-300 overflow-hidden">
                          <button type="button" onClick={() => setQty(pid, qty - 1)}
                            className={`w-12 h-11 flex items-center justify-center text-xl font-bold transition-colors ${
                              qty <= fromOrders && fromOrders > 0 ? 'text-gray-300 cursor-not-allowed' : 'text-amber-600 active:bg-amber-50'
                            }`}
                            disabled={qty <= fromOrders && fromOrders > 0}>
                            {qty === 1 && fromOrders === 0 ? <Trash2 size={16} className="text-red-400" /> : '−'}
                          </button>
                          <input type="number" min={fromOrders || 1} value={qty}
                            onChange={(e) => setQty(pid, parseInt(e.target.value) || 0)}
                            className="w-14 text-center text-lg font-bold border-x border-amber-300 h-11 focus:outline-none" />
                          <button type="button" onClick={() => setQty(pid, qty + 1)}
                            className="w-12 h-11 flex items-center justify-center text-xl font-bold text-amber-600 active:bg-amber-50 transition-colors">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-gray-400">Aucun produit trouvé</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-white px-5 py-4 shrink-0 sm:rounded-b-2xl">
          {totalSelected > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(selected).map(([pid, qty]) => {
                const prod = products.find((p) => p.id === pid);
                const fromOrder = orderQtys[pid] || 0;
                return (
                  <span key={pid} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium">
                    {fromOrder > 0 && <ShoppingBag size={12} className="text-blue-500" />}
                    {prod ? prod.name as string : pid} <strong>&times;{qty}</strong>
                    {fromOrder > 0 && fromOrder < qty && (
                      <span className="text-xs text-gray-400">(dont {fromOrder} cmd)</span>
                    )}
                    {fromOrder === 0 && (
                      <button type="button" onClick={() => setQty(pid, 0)}
                        className="ml-1 text-amber-400 hover:text-red-500">&times;</button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              {totalSelected > 0 ? `${totalSelected} produit(s) sélectionné(s)` : 'Aucun produit sélectionné'}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary px-5 py-2.5 text-base">Annuler</button>
              <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || totalSelected === 0}
                className="btn-primary px-6 py-2.5 text-base disabled:opacity-50 flex items-center gap-2">
                {createMutation.isPending ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Création...</>
                ) : (
                  <><Factory size={16} /> Créer le plan ({totalSelected})</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
