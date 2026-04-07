import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { replenishmentApi } from '../../api/replenishment.api';
import { productsApi } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  Plus, Package, ArrowRight, Clock, AlertTriangle, CheckCircle,
  Send, ShoppingBag, Trash2, Calendar, Search, X, Lightbulb, Truck,
} from 'lucide-react';
import { ASSIGNED_ROLE_LABELS } from '@ofauria/shared';

const STORE_ROLES = ['cashier', 'saleswoman'];
const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Envoyee',
  acknowledged: 'Prise en charge',
  preparing: 'En preparation',
  transferred: 'Transfere',
  partially_delivered: 'Partiellement livre',
  closed: 'Cloture',
  closed_with_discrepancy: 'Ecart',
  cancelled: 'Annule',
};

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-yellow-100 text-yellow-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  preparing: 'bg-indigo-100 text-indigo-700',
  transferred: 'bg-purple-100 text-purple-700',
  partially_delivered: 'bg-teal-100 text-teal-700',
  closed: 'bg-green-100 text-green-700',
  closed_with_discrepancy: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-50 text-blue-600',
  normal: 'bg-gray-50 text-gray-600',
  high: 'bg-orange-50 text-orange-600',
  urgent: 'bg-red-100 text-red-700',
};


const STATUS_ICONS: Record<string, typeof Clock> = {
  submitted: Clock,
  acknowledged: Send,
  preparing: ArrowRight,
  transferred: Package,
  closed: CheckCircle,
  partially_delivered: Truck,
  closed_with_discrepancy: AlertTriangle,
  cancelled: X,
};

export default function ReplenishmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const isStoreStaff = STORE_ROLES.includes(user?.role || '');
  const isAdmin = ['admin', 'manager'].includes(user?.role || '');
  const isChef = CHEF_ROLES.includes(user?.role || '');

  const { data, isLoading } = useQuery({
    queryKey: ['replenishment', { status: statusFilter }],
    queryFn: () => replenishmentApi.list({
      ...(statusFilter ? { status: statusFilter } : {}),
    }),
  });

  const cancelMutation = useMutation({
    mutationFn: replenishmentApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      toast.success('Demande annulee');
    },
  });

  const requests = data?.data || [];
  const tabs = ['', 'submitted', 'acknowledged', 'preparing', 'transferred', 'closed'];
  const tabLabels = ['Tous', 'Envoyee', 'Prise en charge', 'En preparation', 'Transfere', 'Cloture'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Approvisionnement</h1>
        {(isStoreStaff || isAdmin) && (
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Nouvelle demande
          </button>
        )}
      </div>

      {/* Status filter tabs */}
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
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">N</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Date</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Section</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Priorite</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Articles</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {requests.map((r: Record<string, unknown>) => {
                const effectiveStatus = (r.display_status as string) || (r.status as string);
                const StatusIcon = STATUS_ICONS[effectiveStatus] || STATUS_ICONS[r.status as string] || Clock;
                const itemCount = (r.item_count as number) || 0;
                const completedCount = (r.completed_count as number) || 0;

                return (
                  <tr key={r.id as string} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/replenishment/${r.id}`)}>
                    <td className="px-6 py-4 font-medium text-sm">
                      <span className="text-primary-600">#{r.request_number || r.id}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar size={16} className="text-gray-400" />
                        {format(new Date(r.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {r.assigned_role ? (
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-medium">
                          {ASSIGNED_ROLE_LABELS[r.assigned_role as string] || r.assigned_role}
                        </span>
                      ) : (r.requested_by_name as string || '—')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[r.priority as string] || PRIORITY_COLORS.normal}`}>
                        {PRIORITY_LABELS[r.priority as string] || r.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Package size={14} className="text-gray-400" />
                        <span>{completedCount}/{itemCount} article(s)</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[effectiveStatus] || STATUS_COLORS.submitted}`}>
                        <StatusIcon size={12} />
                        {STATUS_LABELS[effectiveStatus] || effectiveStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {['submitted', 'acknowledged'].includes(r.status as string) && (isAdmin || (isStoreStaff && r.requested_by === user?.id)) && (
                          <button
                            onClick={() => cancelMutation.mutate(r.id as string)}
                            className="p-2 hover:bg-red-50 rounded-lg text-red-500" title="Annuler">
                            <Trash2 size={16} />
                          </button>
                        )}
                        <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {requests.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <ShoppingBag size={40} className="mx-auto mb-3 opacity-50" />
              <p>Aucune demande d'approvisionnement</p>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <CreateRequestModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['replenishment'] });
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────── Create Request Modal ─────────────────── */

function CreateRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'suggestions' | 'catalog'>('suggestions');
  const [activeCategory, setActiveCategory] = useState('');
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [blockedItems, setBlockedItems] = useState<Array<{ productId: string; productName: string; unsoldQty: number; message: string }>>([]);
  const [validationDone, setValidationDone] = useState(false);

  // ═══ RULE 1: Check which products are already requested today ═══
  const { data: todayCheck } = useQuery({
    queryKey: ['replenishment-check-today'],
    queryFn: () => replenishmentApi.checkToday(),
  });
  const alreadyRequestedIds: string[] = todayCheck?.alreadyRequestedProductIds || [];

  const MARGIN = 1.10;

  const getDayName = () => {
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return days[new Date().getDay()];
  };

  const { data: recommendations, isLoading: recoLoading } = useQuery({
    queryKey: ['replenishment-recommendations'],
    queryFn: () => replenishmentApi.recommendations(),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const products = (productsData?.data || []) as Record<string, unknown>[];

  // Auto-populate from suggestions
  useEffect(() => {
    if (suggestionsLoaded) return;
    const recos = (recommendations || []) as Record<string, unknown>[];
    if (!recos.length && !products.length) return;

    const auto: Record<string, number> = {};
    if (recos.length > 0) {
      for (const r of recos) {
        const sold = parseInt(r.last_week_qty as string) || 0;
        const stock = parseFloat(r.current_stock as string) || 0;
        const need = Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock));
        if (need > 0) auto[r.product_id as string] = need;
      }
    } else {
      // Random suggestions for testing
      const avail = products.filter(p => p.is_available !== false);
      const shuffled = [...avail].sort(() => Math.random() - 0.5).slice(0, 12);
      for (const p of shuffled) auto[p.id as string] = Math.floor(Math.random() * 8) + 2;
    }

    if (Object.keys(auto).length > 0) {
      setSelected(auto);
      setSuggestionsLoaded(true);
      // Expand all categories by default
      const cats: Record<string, boolean> = {};
      for (const r of recos) cats[(r.category_name as string) || 'Autre'] = true;
      setExpandedCats(cats);
    }
  }, [recommendations, products, suggestionsLoaded]);

  const hasHistory = ((recommendations || []) as Record<string, unknown>[]).length > 0;

  // Group recommendations by category
  const recosByCategory: Record<string, Record<string, unknown>[]> = {};
  for (const r of ((recommendations || []) as Record<string, unknown>[])) {
    const cat = (r.category_name as string) || 'Autre';
    if (!recosByCategory[cat]) recosByCategory[cat] = [];
    recosByCategory[cat].push(r);
  }

  const categories = Array.from(
    new Map(products.filter(p => p.category_name).map(p => [p.category_id as number, p.category_name as string])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredProducts = products.filter((p) => {
    if (activeCategory && String(p.category_id) !== activeCategory) return false;
    if (search && !(p.name as string).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setQty = (productId: string, qty: number) => {
    setSelected(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const totalSelected = Object.keys(selected).length;
  const totalQty = Object.values(selected).reduce((s, q) => s + q, 0);

  const toggleCat = (cat: string) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  const selectAllCat = (items: Record<string, unknown>[]) => {
    const next = { ...selected };
    for (const item of items) {
      const pid = (item.product_id || item.id) as string;
      const sold = parseInt((item.last_week_qty as string) || '0') || 0;
      const stock = parseFloat((item.current_stock as string) || '0') || 0;
      const need = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
      next[pid] = need;
    }
    setSelected(next);
  };
  const deselectAllCat = (items: Record<string, unknown>[]) => {
    const next = { ...selected };
    for (const item of items) delete next[(item.product_id || item.id) as string];
    setSelected(next);
  };

  const createMutation = useMutation({
    mutationFn: replenishmentApi.create,
    onSuccess: () => { toast.success('Demande envoyée avec succès'); onCreated(); },
    onError: (error: unknown) => {
      const errData = (error as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
      const data = errData?.data as Record<string, unknown> | undefined;
      const err = data?.error as Record<string, unknown> | undefined;
      if (err?.code === 'ALL_PRODUCTS_ALREADY_REQUESTED') {
        toast.error(err.message as string);
      } else {
        toast.error('Erreur lors de la création');
      }
    },
  });

  // ═══ RULE 2: Validate unsold items before submitting ═══
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    const productIds = Object.keys(selected);
    if (!productIds.length) { toast.error('Sélectionnez au moins un produit'); return; }

    // ═══ RULE 2: Show unsold items warning (informative, not blocking) ═══
    if (!validationDone) {
      setSubmitting(true);
      try {
        const result = await replenishmentApi.checkItems(productIds);
        if (result.blockedItems?.length > 0) {
          setBlockedItems(result.blockedItems);
          setValidationDone(true);
          setSubmitting(false);
          return;
        }
      } catch (err) {
        console.error('Erreur de vérification des articles:', err);
        toast.error('Erreur lors de la vérification des articles');
        setSubmitting(false);
        return;
      }
    }

    const items = Object.entries(selected).map(([productId, requestedQuantity]) => ({ productId, requestedQuantity }));
    if (!items.length) { toast.error('Aucun article éligible à envoyer'); return; }
    setBlockedItems([]);
    setValidationDone(false);
    setSubmitting(false);
    createMutation.mutate({ priority, notes: notes || undefined, items });
  };

  // Filter suggestions by search
  const filterBySearch = (items: Record<string, unknown>[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(i => ((i.product_name || i.name) as string).toLowerCase().includes(q));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full sm:rounded-2xl flex flex-col sm:m-4 sm:h-[calc(100vh-2rem)] sm:max-w-5xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gradient-to-r from-indigo-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Package size={22} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">Demande de approvisionnement</h2>
              <p className="text-xs text-gray-500">{hasHistory ? `Basé sur les ventes de ${getDayName()} dernier (+10%)` : 'Suggestions aléatoires — aucun historique'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* ═══ RULE 1: Already requested products info ═══ */}
        {alreadyRequestedIds.length > 0 && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 shrink-0">
            <div className="flex items-center gap-3">
              <Package size={16} className="text-blue-600 shrink-0" />
              <p className="text-xs text-blue-700">{alreadyRequestedIds.length} produit(s) deja demande(s) aujourd'hui — ils ne seront pas inclus dans cette demande.</p>
            </div>
          </div>
        )}

        {/* ═══ RULE 2: Blocked items warning ═══ */}
        {blockedItems.length > 0 && (
          <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={16} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">Attention : {blockedItems.length} article(s) avec du stock non vendu</p>
                <p className="text-xs text-amber-600 mt-1">Ces articles ont encore du stock depuis le dernier approvisionnement. Vous pouvez quand meme les envoyer si necessaire.</p>
                <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                  {blockedItems.map(bi => (
                    <p key={bi.productId} className="text-xs text-amber-700">• {bi.productName} — {bi.unsoldQty} unite(s) restante(s)</p>
                  ))}
                </div>
                <p className="text-xs text-amber-700 font-medium mt-2">Cliquez sur « Confirmer l'envoi » pour continuer malgre tout.</p>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar: priority + search + notes */}
        <div className="px-6 py-3 border-b bg-white shrink-0">
          <div className="flex items-center gap-3">
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="input py-2 text-sm w-36">
              <option value="normal">🟢 Normale</option>
              <option value="high">🟠 Haute</option>
              <option value="urgent">🔴 Urgente</option>
            </select>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un produit..." className="input py-2 text-sm pl-9 w-full" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
            </div>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optionnel)" className="input py-2 text-sm w-56" />
            {/* Tabs */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setMode('suggestions')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'suggestions' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
                <Lightbulb size={13} className="inline -mt-0.5 mr-1" />Suggestions
              </button>
              <button onClick={() => setMode('catalog')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'catalog' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500'}`}>
                <ShoppingBag size={13} className="inline -mt-0.5 mr-1" />Catalogue
              </button>
            </div>
          </div>
        </div>

        {/* ══════ SUGGESTIONS ══════ */}
        {mode === 'suggestions' && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {recoLoading ? (
              <div className="text-center py-16 text-gray-400">
                <div className="animate-spin w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full mx-auto mb-3" />
                Chargement des suggestions...
              </div>
            ) : Object.keys(recosByCategory).length > 0 ? (
              Object.entries(recosByCategory).map(([catName, items]) => {
                const filtered = filterBySearch(items);
                if (!filtered.length) return null;
                const isExpanded = expandedCats[catName] !== false;
                const catSelectedCount = filtered.filter(i => selected[(i.product_id as string)]).length;

                return (
                  <div key={catName} className="border-b last:border-b-0">
                    {/* Category header */}
                    <div onClick={() => toggleCat(catName)}
                      className="w-full flex items-center justify-between px-6 py-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer select-none">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${catSelectedCount > 0 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                          {catSelectedCount}
                        </span>
                        <span className="font-semibold text-sm text-gray-700">{catName}</span>
                        <span className="text-xs text-gray-400">{filtered.length} produit{filtered.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {catSelectedCount < filtered.length ? (
                          <button onClick={() => selectAllCat(filtered)} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 hover:bg-blue-50 rounded">
                            Tout sélectionner
                          </button>
                        ) : (
                          <button onClick={() => deselectAllCat(filtered)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded">
                            Tout retirer
                          </button>
                        )}
                        <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                      </div>
                    </div>

                    {/* Items */}
                    {isExpanded && (
                      <div className="divide-y divide-gray-50">
                        {filtered.map((item) => {
                          const pid = item.product_id as string;
                          const sold = parseInt(item.last_week_qty as string) || 0;
                          const stock = parseFloat(item.current_stock as string) || 0;
                          const suggested = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
                          const qty = selected[pid] || 0;
                          const isSelected = qty > 0;

                          return (
                            <div key={pid} className={`flex items-center gap-4 px-6 py-2.5 transition-colors ${isSelected ? 'bg-primary-50/50' : 'hover:bg-gray-50'}`}>
                              {/* Checkbox */}
                              <button onClick={() => isSelected ? setQty(pid, 0) : setQty(pid, suggested)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300 hover:border-primary-400'}`}>
                                {isSelected && <CheckCircle size={14} className="text-white" />}
                              </button>

                              {/* Product name */}
                              <div className="flex-1 min-w-0">
                                <span className={`text-sm ${isSelected ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                                  {item.product_name as string}
                                </span>
                              </div>

                              {/* Stats pills */}
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title="Vendu la semaine dernière">
                                  📊 {sold}
                                </span>
                                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${stock > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`} title="Stock actuel">
                                  📦 {Math.floor(stock)}
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium" title="Quantité suggérée">
                                  💡 {suggested}
                                </span>
                              </div>

                              {/* Quantity controls */}
                              {isSelected ? (
                                <div className="flex items-center bg-white rounded-lg border border-primary-200 shrink-0 shadow-sm">
                                  <button onClick={() => setQty(pid, qty - 1)}
                                    className="w-8 h-8 flex items-center justify-center text-primary-600 font-bold hover:bg-primary-50 rounded-l-lg">−</button>
                                  <input type="number" min={1} value={qty}
                                    onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                                    className="w-12 text-center text-sm font-bold h-8 border-x border-primary-200 focus:outline-none focus:bg-primary-50" />
                                  <button onClick={() => setQty(pid, qty + 1)}
                                    className="w-8 h-8 flex items-center justify-center text-primary-600 font-bold hover:bg-primary-50 rounded-r-lg">+</button>
                                </div>
                              ) : (
                                <button onClick={() => setQty(pid, suggested)}
                                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-primary-100 hover:text-primary-700 transition-colors shrink-0">
                                  + Ajouter
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-16 text-gray-400">
                <Lightbulb size={40} className="mx-auto mb-3 opacity-30" />
                <p>Aucune donnée de vente pour {getDayName()}</p>
                <button onClick={() => setMode('catalog')} className="mt-3 text-primary-600 text-sm font-medium hover:underline">
                  → Sélectionner manuellement depuis le catalogue
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════ CATALOGUE ══════ */}
        {mode === 'catalog' && (
          <div className="flex flex-1 min-h-0">
            <div className="w-40 shrink-0 border-r bg-gray-50 overflow-y-auto py-2 px-2 flex flex-col gap-1">
              <button onClick={() => setActiveCategory('')}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${!activeCategory ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                Tous
              </button>
              {categories.map(([id, name]) => (
                <button key={id} onClick={() => setActiveCategory(String(id))}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeCategory === String(id) ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {name}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {filteredProducts.map((p) => {
                  const pid = p.id as string;
                  const qty = selected[pid] || 0;
                  const isSelected = qty > 0;
                  return (
                    <div key={pid} className={`rounded-xl border-2 p-2.5 transition-all select-none ${isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-150 bg-white hover:border-gray-300'}`}>
                      <div className="text-xs font-semibold text-gray-800 mb-1 leading-tight h-8" title={p.name as string}>
                        <span className="line-clamp-2">{p.name as string}</span>
                      </div>
                      {!isSelected ? (
                        <button onClick={() => setQty(pid, 1)}
                          className="w-full py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium">
                          <Plus size={12} className="inline -mt-0.5 mr-0.5" /> Ajouter
                        </button>
                      ) : (
                        <div className="flex items-center bg-white rounded-lg border border-primary-200 overflow-hidden">
                          <button onClick={() => setQty(pid, qty - 1)} className="w-8 h-7 flex items-center justify-center text-sm font-bold text-primary-600">−</button>
                          <input type="number" min={1} value={qty} onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                            className="flex-1 text-center text-xs font-bold h-7 border-x border-primary-200 focus:outline-none" />
                          <button onClick={() => setQty(pid, qty + 1)} className="w-8 h-7 flex items-center justify-center text-sm font-bold text-primary-600">+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!filteredProducts.length && <div className="text-center py-8 text-gray-400 text-sm">Aucun produit trouvé</div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t bg-white px-6 py-3 shrink-0 rounded-b-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">
                {totalSelected > 0 ? (
                  <><strong className="text-primary-600">{totalSelected}</strong> produit{totalSelected > 1 ? 's' : ''} — <strong className="text-primary-600">{totalQty}</strong> unités</>
                ) : 'Aucun produit sélectionné'}
              </span>
              {totalSelected > 0 && (
                <button onClick={() => setSelected({})} className="text-xs text-red-500 hover:text-red-700 font-medium">
                  Tout vider
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-secondary px-5 py-2.5">Annuler</button>
              <button onClick={handleSubmit} disabled={createMutation.isPending || submitting || !totalSelected}
                className="btn-primary px-6 py-2.5 disabled:opacity-50">
                {createMutation.isPending || submitting ? 'Vérification...' : validationDone ? 'Confirmer l\'envoi' : `Envoyer la demande`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
