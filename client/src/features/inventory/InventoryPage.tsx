import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import {
  AlertTriangle, Package, Search, TrendingUp, TrendingDown,
  Clock, X, Boxes, ShieldCheck, CalendarClock, ChevronRight,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useSettings } from '../../context/SettingsContext';
import { format } from 'date-fns';

type SortKey = 'name' | 'quantity' | 'dlc' | 'lots';
type SortDir = 'asc' | 'desc';
type ViewFilter = 'all' | 'low' | 'ok' | 'expiring';

const INGREDIENT_CATEGORIES = [
  { value: 'farines', label: 'Farines & Céréales' },
  { value: 'sucres', label: 'Sucres & Édulcorants' },
  { value: 'produits_laitiers', label: 'Produits laitiers' },
  { value: 'oeufs', label: 'Oeufs & Ovoproduits' },
  { value: 'matieres_grasses', label: 'Matières grasses' },
  { value: 'fruits', label: 'Fruits & Purées' },
  { value: 'chocolat', label: 'Chocolat & Cacao' },
  { value: 'fruits_secs', label: 'Fruits secs & Oléagineux' },
  { value: 'epices', label: 'Épices & Arômes' },
  { value: 'levures', label: 'Levures & Agents levants' },
  { value: 'emballages', label: 'Emballages' },
  { value: 'autre', label: 'Autre' },
];

const CATEGORY_COLORS: Record<string, string> = {
  farines: 'bg-amber-100 text-amber-700',
  sucres: 'bg-pink-100 text-pink-700',
  produits_laitiers: 'bg-blue-100 text-blue-700',
  oeufs: 'bg-yellow-100 text-yellow-700',
  matieres_grasses: 'bg-orange-100 text-orange-700',
  fruits: 'bg-green-100 text-green-700',
  chocolat: 'bg-stone-200 text-stone-700',
  fruits_secs: 'bg-lime-100 text-lime-700',
  epices: 'bg-red-100 text-red-700',
  levures: 'bg-violet-100 text-violet-700',
  emballages: 'bg-gray-100 text-gray-600',
  autre: 'bg-gray-100 text-gray-500',
};

interface InventoryItem {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: string;
  minimum_threshold: string;
  unit: string;
  unit_cost: string;
  supplier: string;
  category: string;
  last_restocked_at: string | null;
  active_lots_count: string;
  nearest_dlc: string | null;
  expired_lots_count: string;
  expiring_soon_count: string;
  active_lot_numbers: string | null;
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showAddIngredient, setShowAddIngredient] = useState(false);

  const { data: expiringLots = [] } = useQuery({ queryKey: ['ingredient-lots-expiring'], queryFn: () => ingredientLotsApi.expiring(7) });
  const { data: expiredLots = [] } = useQuery({ queryKey: ['ingredient-lots-expired'], queryFn: ingredientLotsApi.expired });
  const { data: inventory = [], isLoading } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const { data: alerts = [] } = useQuery({ queryKey: ['inventory-alerts'], queryFn: inventoryApi.alerts });

  const addIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventory'] }); setShowAddIngredient(false); notify.success('Ingrédient ajouté'); },
  });

  const filteredInventory = useMemo(() => {
    let items = inventory as InventoryItem[];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.ingredient_name.toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q) || (i.active_lot_numbers || '').toLowerCase().includes(q));
    }
    if (categoryFilter) items = items.filter(i => (i.category || 'autre') === categoryFilter);
    if (viewFilter === 'low') items = items.filter(i => parseFloat(i.current_quantity) <= parseFloat(i.minimum_threshold) && parseFloat(i.minimum_threshold) > 0);
    else if (viewFilter === 'ok') items = items.filter(i => parseFloat(i.current_quantity) > parseFloat(i.minimum_threshold) || parseFloat(i.minimum_threshold) === 0);
    else if (viewFilter === 'expiring') items = items.filter(i => (parseInt(i.expired_lots_count) || 0) > 0 || (parseInt(i.expiring_soon_count) || 0) > 0);

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.ingredient_name.localeCompare(b.ingredient_name); break;
        case 'quantity': cmp = parseFloat(a.current_quantity) - parseFloat(b.current_quantity); break;
        case 'dlc': {
          const aDlc = a.nearest_dlc ? new Date(a.nearest_dlc).getTime() : Infinity;
          const bDlc = b.nearest_dlc ? new Date(b.nearest_dlc).getTime() : Infinity;
          cmp = aDlc - bDlc; break;
        }
        case 'lots': cmp = (parseInt(a.active_lots_count) || 0) - (parseInt(b.active_lots_count) || 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [inventory, search, categoryFilter, viewFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const lowCount = (alerts as InventoryItem[]).length;
  const totalItems = (inventory as InventoryItem[]).length;
  const expiringCount = (inventory as InventoryItem[]).filter(i => (parseInt(i.expired_lots_count) || 0) > 0 || (parseInt(i.expiring_soon_count) || 0) > 0).length;

  const SortHeader = ({ col, children, className = '' }: { col: SortKey; children: React.ReactNode; className?: string }) => (
    <th onClick={() => toggleSort(col)}
      className={`text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 transition-colors ${className}`}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === col && <span className="text-violet-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* ══════ HERO ══════ */}
      <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-2xl p-6 text-white relative overflow-hidden shadow-lg">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck size={24} /> Inventaire & Traçabilité</h1>
            <p className="text-sm text-white/70 mt-1">Traçabilité complète des ingrédients</p>
          </div>
          <button onClick={() => setShowAddIngredient(true)}
            className="px-5 py-2.5 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white rounded-xl font-medium transition-all flex items-center gap-2 text-sm shadow-md">
            <Package size={16} /> Ajouter un ingrédient
          </button>
        </div>
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <button onClick={() => setViewFilter('all')} className={`bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center transition-all hover:bg-white/20 ${viewFilter === 'all' ? 'ring-2 ring-white/40' : ''}`}>
            <p className="text-2xl font-bold">{totalItems}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><Package size={12} /> Total</p>
          </button>
          <button onClick={() => setViewFilter(viewFilter === 'low' ? 'all' : 'low')} className={`bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center transition-all hover:bg-white/20 ${viewFilter === 'low' ? 'ring-2 ring-red-300' : ''}`}>
            <p className="text-2xl font-bold text-red-200">{lowCount}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><AlertTriangle size={12} /> Stock bas</p>
          </button>
          <button onClick={() => setViewFilter(viewFilter === 'ok' ? 'all' : 'ok')} className={`bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center transition-all hover:bg-white/20 ${viewFilter === 'ok' ? 'ring-2 ring-emerald-300' : ''}`}>
            <p className="text-2xl font-bold text-emerald-200">{totalItems - lowCount}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><TrendingUp size={12} /> Stock OK</p>
          </button>
          <button onClick={() => setViewFilter(viewFilter === 'expiring' ? 'all' : 'expiring')} className={`bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center transition-all hover:bg-white/20 ${viewFilter === 'expiring' ? 'ring-2 ring-amber-300' : ''}`}>
            <p className="text-2xl font-bold text-amber-200">{expiringCount}</p>
            <p className="text-xs text-white/70 flex items-center justify-center gap-1"><CalendarClock size={12} /> DLC critique</p>
          </button>
        </div>
      </div>

      {/* ══════ DLC ALERTS ══════ */}
      {(expiredLots as Record<string, unknown>[]).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
          <div className="px-5 py-2.5 border-b border-red-100 bg-gradient-to-r from-red-50 to-rose-50 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center"><AlertTriangle size={12} className="text-white" /></div>
            <span className="text-xs font-bold text-red-700">{(expiredLots as Record<string, unknown>[]).length} lot(s) expiré(s) avec stock restant</span>
          </div>
          <div className="divide-y divide-red-50">
            {(expiredLots as Record<string, unknown>[]).slice(0, 3).map((lot) => (
              <div key={lot.id as string} className="px-5 py-2 flex items-center justify-between text-xs hover:bg-red-50/30">
                <span className="text-gray-700"><strong>{lot.ingredient_name as string}</strong> — <span className="font-mono text-red-600">{lot.supplier_lot_number as string || '?'}</span> — expiré depuis {lot.days_expired as number}j</span>
                <span className="font-bold text-red-600">{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(expiringLots as Record<string, unknown>[]).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="px-5 py-2.5 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center"><Clock size={12} className="text-white" /></div>
            <span className="text-xs font-bold text-amber-700">{(expiringLots as Record<string, unknown>[]).length} lot(s) expirent dans les 7 prochains jours</span>
          </div>
          <div className="divide-y divide-amber-50">
            {(expiringLots as Record<string, unknown>[]).slice(0, 3).map((lot) => (
              <div key={lot.id as string} className="px-5 py-2 flex items-center justify-between text-xs hover:bg-amber-50/30">
                <span className="text-gray-700"><strong>{lot.ingredient_name as string}</strong> — <span className="font-mono text-amber-600">{lot.supplier_lot_number as string || '?'}</span> — DLC dans {lot.days_until_expiry as number}j</span>
                <span className="font-bold text-amber-600">{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════ SEARCH + FILTERS ══════ */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par nom, fournisseur, N° lot..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input w-48">
          <option value="">Toutes les catégories</option>
          {INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* ══════ TABLE ══════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100">
              <tr>
                <SortHeader col="name">Ingrédient</SortHeader>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Catégorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Fournisseur</th>
                <SortHeader col="quantity">Stock</SortHeader>
                <SortHeader col="lots" className="hidden lg:table-cell">Lots</SortHeader>
                <SortHeader col="dlc" className="hidden lg:table-cell">DLC</SortHeader>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
              ) : filteredInventory.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun ingrédient trouvé</td></tr>
              ) : filteredInventory.map((item, idx) => {
                const qty = parseFloat(item.current_quantity);
                const threshold = parseFloat(item.minimum_threshold);
                const isLow = threshold > 0 && qty <= threshold;
                const isOut = qty <= 0;
                const lotsCount = parseInt(item.active_lots_count) || 0;
                const expiredCount = parseInt(item.expired_lots_count) || 0;
                const expiringSoonCount = parseInt(item.expiring_soon_count) || 0;
                const nearestDlc = item.nearest_dlc ? new Date(item.nearest_dlc) : null;
                const daysUntilDlc = nearestDlc ? Math.ceil((nearestDlc.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                const pct = threshold > 0 ? Math.min(Math.round((qty / (threshold * 3)) * 100), 100) : (qty > 0 ? 100 : 0);

                return (
                  <tr key={item.id} onClick={() => navigate(`/inventory/${item.ingredient_id}`)}
                    className={`cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-gray-50/30' : ''} ${
                      expiredCount > 0 ? 'hover:bg-red-50/40' : isLow ? 'hover:bg-amber-50/40' : 'hover:bg-violet-50/40'
                    }`}>
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-8 rounded-full shrink-0 ${
                          expiredCount > 0 ? 'bg-red-500' : isOut ? 'bg-red-400' : isLow ? 'bg-amber-400' : expiringSoonCount > 0 ? 'bg-amber-300' : 'bg-emerald-400'
                        }`} />
                        <span className="font-medium text-sm text-gray-900">{item.ingredient_name}</span>
                      </div>
                    </td>
                    {/* Category */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[item.category || 'autre'] || CATEGORY_COLORS.autre}`}>
                        {INGREDIENT_CATEGORIES.find(c => c.value === (item.category || 'autre'))?.label || 'Autre'}
                      </span>
                    </td>
                    {/* Supplier */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-gray-500">{item.supplier || '—'}</span>
                    </td>
                    {/* Stock */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-800'}`}>
                          {qty.toFixed(qty % 1 === 0 ? 0 : 1)}
                        </span>
                        <span className="text-[10px] text-gray-400">{item.unit}</span>
                        <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                          <div className={`h-full rounded-full ${isOut ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                    {/* Lots */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {lotsCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold">
                          <Boxes size={10} /> {lotsCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    {/* DLC */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {nearestDlc ? (
                        <span className={`text-xs font-medium ${
                          daysUntilDlc !== null && daysUntilDlc < 0 ? 'text-red-600' :
                          daysUntilDlc !== null && daysUntilDlc <= 7 ? 'text-amber-600' : 'text-gray-500'
                        }`}>
                          {format(nearestDlc, 'dd/MM/yy')}
                          {daysUntilDlc !== null && daysUntilDlc <= 30 && (
                            <span className="text-[10px] ml-1 font-normal">({daysUntilDlc < 0 ? `${Math.abs(daysUntilDlc)}j!` : `${daysUntilDlc}j`})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    {/* Chevron */}
                    <td className="px-4 py-3"><ChevronRight size={16} className="text-gray-300" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Ingredient Modal */}
      {showAddIngredient && <AddIngredientModal
        onClose={() => setShowAddIngredient(false)}
        onSave={(data) => addIngredientMutation.mutate(data)}
        isLoading={addIngredientMutation.isPending} />}
    </div>
  );
}

/* ─── Add Ingredient Modal ─── */
function AddIngredientModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (data: Record<string, unknown>) => void; isLoading: boolean;
}) {
  const [form, setForm] = useState({ name: '', unit: 'kg', unitCost: '', supplier: '', category: 'autre' });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Package size={20} className="text-white" /></div>
            <div><h2 className="text-lg font-bold text-white">Nouvel ingrédient</h2><p className="text-sm text-white/70">Ajouter au suivi inventaire</p></div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name, unit: form.unit, unitCost: parseFloat(form.unitCost) || 0, supplier: form.supplier || undefined, category: form.category }); }} className="p-5 space-y-4">
          <div><label className="block text-sm font-medium mb-1">Nom de l'ingrédient *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Farine T55" autoFocus /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Unité</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">Kilogramme (kg)</option><option value="g">Gramme (g)</option><option value="l">Litre (l)</option><option value="ml">Millilitre (ml)</option><option value="unit">Unité</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Coût unitaire (DH)</label><input type="number" step="0.01" className="input" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} placeholder="0.00" required /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Catégorie</label><select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Fournisseur</label><input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nom du fournisseur" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading} className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50">{isLoading ? 'Ajout...' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
