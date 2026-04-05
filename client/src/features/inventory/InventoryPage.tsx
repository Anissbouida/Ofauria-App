import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import {
  AlertTriangle, Plus, Package, Search, ArrowUpDown, TrendingUp, TrendingDown,
  RotateCcw, Trash2, Clock, Pencil, X, History, ChevronDown, Filter, ClipboardList,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSettings } from '../../context/SettingsContext';

type SortKey = 'name' | 'quantity' | 'threshold' | 'status';
type SortDir = 'asc' | 'desc';
type ViewFilter = 'all' | 'low' | 'ok';

const INGREDIENT_CATEGORIES = [
  { value: 'farines', label: 'Farines & Cereales' },
  { value: 'sucres', label: 'Sucres & Edulcorants' },
  { value: 'produits_laitiers', label: 'Produits laitiers' },
  { value: 'oeufs', label: 'Oeufs & Ovoproduits' },
  { value: 'matieres_grasses', label: 'Matieres grasses' },
  { value: 'fruits', label: 'Fruits & Purees' },
  { value: 'chocolat', label: 'Chocolat & Cacao' },
  { value: 'fruits_secs', label: 'Fruits secs & Oleagineux' },
  { value: 'epices', label: 'Epices & Aromes' },
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
}

interface Transaction {
  id: string;
  ingredient_name: string;
  type: string;
  quantity_change: string;
  note: string;
  performed_by_name: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  restock: 'Restockage',
  production: 'Production',
  usage: 'Utilisation',
  adjustment: 'Ajustement',
  waste: 'Perte',
};
const TYPE_COLORS: Record<string, string> = {
  restock: 'text-green-600 bg-green-50',
  production: 'text-blue-600 bg-blue-50',
  usage: 'text-orange-600 bg-orange-50',
  adjustment: 'text-purple-600 bg-purple-50',
  waste: 'text-red-600 bg-red-50',
};

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [actionModal, setActionModal] = useState<{ type: 'restock' | 'adjust' | 'waste'; item: InventoryItem } | null>(null);
  const [editingThreshold, setEditingThreshold] = useState<string | null>(null);
  const [thresholdValue, setThresholdValue] = useState('');
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [costValue, setCostValue] = useState('');
  const [editingDetailThreshold, setEditingDetailThreshold] = useState<string | null>(null);
  const [detailThresholdValue, setDetailThresholdValue] = useState('');

  const { data: inventory = [], isLoading } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const { data: alerts = [] } = useQuery({ queryKey: ['inventory-alerts'], queryFn: inventoryApi.alerts });

  // Load transactions when an item is selected
  const { data: transactions = [] } = useQuery({
    queryKey: ['inventory-transactions', selectedItem?.ingredient_id],
    queryFn: () => inventoryApi.transactions(selectedItem?.ingredient_id),
    enabled: !!selectedItem,
  });

  // Mutations
  const restockMutation = useMutation({
    mutationFn: inventoryApi.restock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      setActionModal(null);
      toast.success('Stock mis a jour');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: inventoryApi.adjust,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      setActionModal(null);
      toast.success('Ajustement enregistre');
    },
  });

  const thresholdMutation = useMutation({
    mutationFn: inventoryApi.updateThreshold,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      setEditingThreshold(null);
      toast.success('Seuil mis a jour');
    },
  });

  const addIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setShowAddIngredient(false);
      toast.success('Ingredient ajoute');
    },
  });

  const updateIngredientMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => ingredientsApi.update(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditingCost(null);
      // Update selectedItem in memory so panel reflects changes immediately
      if (selectedItem && selectedItem.ingredient_id === variables.id) {
        const updates: Partial<InventoryItem> = {};
        if (variables.data.unitCost !== undefined) updates.unit_cost = String(variables.data.unitCost);
        if (variables.data.category !== undefined) updates.category = String(variables.data.category);
        setSelectedItem({ ...selectedItem, ...updates });
      }
      toast.success('Ingredient mis a jour');
    },
    onError: () => {
      toast.error('Erreur lors de la mise a jour');
    },
  });

  const deleteIngredientMutation = useMutation({
    mutationFn: ingredientsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      setSelectedItem(null);
      toast.success('Ingredient supprime');
    },
  });

  // Filter + sort
  const filteredInventory = useMemo(() => {
    let items = inventory as InventoryItem[];

    // Search
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.ingredient_name.toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q));
    }

    // Category filter
    if (categoryFilter) {
      items = items.filter(i => (i.category || 'autre') === categoryFilter);
    }

    // View filter
    if (viewFilter === 'low') {
      items = items.filter(i => parseFloat(i.current_quantity) <= parseFloat(i.minimum_threshold) && parseFloat(i.minimum_threshold) > 0);
    } else if (viewFilter === 'ok') {
      items = items.filter(i => parseFloat(i.current_quantity) > parseFloat(i.minimum_threshold) || parseFloat(i.minimum_threshold) === 0);
    }

    // Sort
    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.ingredient_name.localeCompare(b.ingredient_name); break;
        case 'quantity': cmp = parseFloat(a.current_quantity) - parseFloat(b.current_quantity); break;
        case 'threshold': cmp = parseFloat(a.minimum_threshold) - parseFloat(b.minimum_threshold); break;
        case 'status': {
          const aLow = parseFloat(a.current_quantity) <= parseFloat(a.minimum_threshold) && parseFloat(a.minimum_threshold) > 0;
          const bLow = parseFloat(b.current_quantity) <= parseFloat(b.minimum_threshold) && parseFloat(b.minimum_threshold) > 0;
          cmp = (aLow ? 0 : 1) - (bLow ? 0 : 1);
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return items;
  }, [inventory, search, categoryFilter, viewFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => (
    <ArrowUpDown size={12} className={`ml-1 inline ${sortKey === col ? 'text-gray-800' : 'text-gray-300'}`} />
  );

  const stockPercent = (item: InventoryItem) => {
    const threshold = parseFloat(item.minimum_threshold);
    if (threshold === 0) return 100;
    const qty = parseFloat(item.current_quantity);
    return Math.min(Math.round((qty / (threshold * 3)) * 100), 100);
  };

  const lowCount = (alerts as InventoryItem[]).length;
  const totalItems = (inventory as InventoryItem[]).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-bakery-chocolate">Inventaire</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalItems} ingredient(s) suivis</p>
        </div>
        <button onClick={() => setShowAddIngredient(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Ajouter un ingredient
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1">
            <Package size={14} /> Total ingredients
          </div>
          <p className="text-2xl font-bold">{totalItems}</p>
        </div>
        <button onClick={() => setViewFilter(viewFilter === 'low' ? 'all' : 'low')}
          className={`bg-white rounded-xl border p-4 shadow-sm text-left transition-colors ${viewFilter === 'low' ? 'border-red-300 bg-red-50' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2 text-red-500 text-xs font-medium mb-1">
            <AlertTriangle size={14} /> Stock bas
          </div>
          <p className="text-2xl font-bold text-red-600">{lowCount}</p>
        </button>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-green-500 text-xs font-medium mb-1">
            <TrendingUp size={14} /> Stock OK
          </div>
          <p className="text-2xl font-bold text-green-600">{totalItems - lowCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-blue-500 text-xs font-medium mb-1">
            <History size={14} /> Derniere mise a jour
          </div>
          <p className="text-sm font-medium text-gray-700 mt-1">
            {(inventory as InventoryItem[]).reduce((latest: string, item: InventoryItem) => {
              if (item.last_restocked_at && item.last_restocked_at > latest) return item.last_restocked_at;
              return latest;
            }, '') ? new Date((inventory as InventoryItem[]).reduce((latest: string, item: InventoryItem) => {
              if (item.last_restocked_at && item.last_restocked_at > latest) return item.last_restocked_at;
              return latest;
            }, '')).toLocaleDateString('fr-FR') : '—'}
          </p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher un ingredient ou fournisseur..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="input w-48">
          <option value="">Toutes les categories</option>
          {INGREDIENT_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {(['all', 'low', 'ok'] as ViewFilter[]).map(f => (
            <button key={f} onClick={() => setViewFilter(f)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                viewFilter === f
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={viewFilter === f ? { backgroundColor: settings.primaryColor } : undefined}
            >
              <Filter size={14} />
              {f === 'all' ? 'Tout' : f === 'low' ? 'Stock bas' : 'En stock'}
            </button>
          ))}
        </div>
      </div>

      {/* Main content: table + detail panel */}
      <div className="flex gap-4">
        {/* Table */}
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto flex-1 ${selectedItem ? 'hidden sm:block' : ''}`}
          style={{ maxHeight: 'calc(100vh - 20rem)' }}>
          {isLoading ? (
            <div className="p-8 text-center text-gray-400">Chargement...</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    Ingredient <SortIcon col="name" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                    Stock <SortIcon col="quantity" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell cursor-pointer select-none" onClick={() => toggleSort('threshold')}>
                    Seuil <SortIcon col="threshold" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">Fournisseur</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredInventory.map(item => {
                  const qty = parseFloat(item.current_quantity);
                  const threshold = parseFloat(item.minimum_threshold);
                  const isLow = threshold > 0 && qty <= threshold;
                  const isOut = qty <= 0;
                  const pct = stockPercent(item);
                  const isSelected = selectedItem?.ingredient_id === item.ingredient_id;

                  return (
                    <tr key={item.id} onClick={() => setSelectedItem(item)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : isLow ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isOut ? 'bg-red-100 text-red-500' : isLow ? 'bg-amber-100 text-amber-500' : 'bg-gray-100 text-gray-400'
                          }`}>
                            <Package size={16} />
                          </div>
                          <div>
                            <p className="font-medium text-sm leading-tight">{item.ingredient_name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[item.category || 'autre'] || CATEGORY_COLORS.autre}`}>
                                {INGREDIENT_CATEGORIES.find(c => c.value === (item.category || 'autre'))?.label || 'Autre'}
                              </span>
                              {item.unit_cost && <span className="text-[10px] text-gray-400">{parseFloat(item.unit_cost).toFixed(2)} DH/{item.unit}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <p className={`text-sm font-semibold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-800'}`}>
                            {qty.toFixed(qty % 1 === 0 ? 0 : 2)} {item.unit}
                          </p>
                          {/* Progress bar */}
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              isOut ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-green-400'
                            }`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {editingThreshold === item.ingredient_id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input type="number" step="0.01" className="input w-20 text-xs py-1 px-2" autoFocus
                              value={thresholdValue}
                              onChange={e => setThresholdValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                                if (e.key === 'Escape') {
                                  setEditingThreshold(null);
                                  e.currentTarget.dataset.cancelled = 'true';
                                }
                              }}
                              onBlur={(e) => {
                                if (e.currentTarget.dataset.cancelled === 'true') return;
                                thresholdMutation.mutate({ ingredientId: item.ingredient_id, threshold: parseFloat(thresholdValue) || 0 });
                              }}
                            />
                            <span className="text-xs text-gray-400">{item.unit}</span>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setEditingThreshold(item.ingredient_id); setThresholdValue(parseFloat(item.minimum_threshold).toString()); }}
                            className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
                            title="Cliquer pour modifier">
                            {parseFloat(item.minimum_threshold).toFixed(qty % 1 === 0 ? 0 : 2)} {item.unit}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-gray-500">{item.supplier || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => navigate('/accounting')}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Bon de commande fournisseur">
                            <ClipboardList size={16} />
                          </button>
                          <button onClick={() => setActionModal({ type: 'waste', item })}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Perte / Dechet">
                            <TrendingDown size={16} />
                          </button>
                          <button onClick={() => setActionModal({ type: 'adjust', item })}
                            className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-500 transition-colors" title="Ajustement">
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!isLoading && filteredInventory.length === 0 && (
            <p className="text-center py-8 text-gray-400">Aucun ingredient trouve</p>
          )}
        </div>

        {/* Detail panel (right side) */}
        {selectedItem && (
          <div className="w-full sm:w-80 lg:w-96 bg-white rounded-xl shadow-sm border border-gray-100 shrink-0 overflow-auto"
            style={{ maxHeight: 'calc(100vh - 20rem)' }}>
            {/* Detail header */}
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm">{selectedItem.ingredient_name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <select
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border-0 cursor-pointer ${CATEGORY_COLORS[selectedItem.category || 'autre'] || CATEGORY_COLORS.autre}`}
                    value={selectedItem.category || 'autre'}
                    onChange={e => {
                      updateIngredientMutation.mutate({ id: selectedItem.ingredient_id, data: { category: e.target.value } });
                      setSelectedItem({ ...selectedItem, category: e.target.value });
                    }}
                  >
                    {INGREDIENT_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                {selectedItem.supplier && <p className="text-xs text-gray-400 mt-0.5">{selectedItem.supplier}</p>}
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-1 hover:bg-gray-200 rounded-lg">
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            {/* Quick info */}
            <div className="p-4 space-y-3 border-b">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Stock actuel</span>
                <span className={`font-bold ${
                  parseFloat(selectedItem.current_quantity) <= 0 ? 'text-red-600' :
                  parseFloat(selectedItem.current_quantity) <= parseFloat(selectedItem.minimum_threshold) ? 'text-amber-600' : 'text-green-600'
                }`}>
                  {parseFloat(selectedItem.current_quantity).toFixed(2)} {selectedItem.unit}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Seuil minimum</span>
                {editingDetailThreshold === selectedItem.ingredient_id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.01" min="0" className="input w-20 text-xs py-1 px-2 text-right" autoFocus
                      value={detailThresholdValue}
                      onChange={e => setDetailThresholdValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                          setEditingDetailThreshold(null);
                          e.currentTarget.dataset.cancelled = 'true';
                        }
                      }}
                      onBlur={(e) => {
                        if (e.currentTarget.dataset.cancelled === 'true') return;
                        const val = parseFloat(detailThresholdValue) || 0;
                        thresholdMutation.mutate({ ingredientId: selectedItem.ingredient_id, threshold: val });
                        setSelectedItem({ ...selectedItem, minimum_threshold: String(val) });
                        setEditingDetailThreshold(null);
                      }}
                    />
                    <span className="text-xs text-gray-400">{selectedItem.unit}</span>
                  </div>
                ) : (
                  <button onClick={() => { setEditingDetailThreshold(selectedItem.ingredient_id); setDetailThresholdValue(parseFloat(selectedItem.minimum_threshold).toString()); }}
                    className="text-sm text-gray-700 hover:text-blue-600 hover:underline flex items-center gap-1"
                    title="Cliquer pour modifier le seuil">
                    {parseFloat(selectedItem.minimum_threshold).toFixed(2)} {selectedItem.unit}
                    <Pencil size={10} className="text-gray-300" />
                  </button>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Cout unitaire</span>
                {editingCost === selectedItem.ingredient_id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.01" className="input w-20 text-xs py-1 px-2 text-right" autoFocus
                      value={costValue}
                      onChange={e => setCostValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                          setEditingCost(null);
                          e.currentTarget.dataset.cancelled = 'true';
                        }
                      }}
                      onBlur={(e) => {
                        if (e.currentTarget.dataset.cancelled === 'true') return;
                        const newCost = parseFloat(costValue);
                        if (!isNaN(newCost) && newCost >= 0) {
                          updateIngredientMutation.mutate({ id: selectedItem.ingredient_id, data: { unitCost: newCost } });
                        } else {
                          setEditingCost(null);
                        }
                      }}
                    />
                    <span className="text-xs text-gray-400">DH/{selectedItem.unit}</span>
                  </div>
                ) : (
                  <button onClick={() => { setEditingCost(selectedItem.ingredient_id); setCostValue(selectedItem.unit_cost ? parseFloat(selectedItem.unit_cost).toString() : '0'); }}
                    className="text-sm text-gray-700 hover:text-blue-600 hover:underline flex items-center gap-1"
                    title="Cliquer pour modifier le prix">
                    {selectedItem.unit_cost ? `${parseFloat(selectedItem.unit_cost).toFixed(2)} DH/${selectedItem.unit}` : '—'}
                    <Pencil size={10} className="text-gray-300" />
                  </button>
                )}
              </div>
              {selectedItem.last_restocked_at && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Dernier restockage</span>
                  <span className="text-sm text-gray-700">{new Date(selectedItem.last_restocked_at).toLocaleDateString('fr-FR')}</span>
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="p-4 border-b flex gap-2">
              <button onClick={() => navigate('/accounting')}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-1">
                <ClipboardList size={14} /> Bon de commande
              </button>
              <button onClick={() => setActionModal({ type: 'waste', item: selectedItem })}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors flex items-center justify-center gap-1">
                <TrendingDown size={14} /> Perte
              </button>
              <button onClick={() => setActionModal({ type: 'adjust', item: selectedItem })}
                className="flex-1 py-2 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors flex items-center justify-center gap-1">
                <RotateCcw size={14} /> Ajuster
              </button>
            </div>

            {/* Transaction history */}
            <div className="p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Clock size={12} /> Historique des mouvements
              </h4>
              {(transactions as Transaction[]).length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucun mouvement</p>
              ) : (
                <div className="space-y-2">
                  {(transactions as Transaction[]).map(tx => {
                    const change = parseFloat(tx.quantity_change);
                    const isPositive = change > 0;
                    return (
                      <div key={tx.id} className="flex items-start gap-2.5 py-1.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs ${TYPE_COLORS[tx.type] || 'text-gray-600 bg-gray-50'}`}>
                          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[tx.type] || 'text-gray-600 bg-gray-50'}`}>
                              {TYPE_LABELS[tx.type] || tx.type}
                            </span>
                            <span className={`text-xs font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : ''}{change.toFixed(2)}
                            </span>
                          </div>
                          {tx.note && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{tx.note}</p>}
                          <p className="text-[10px] text-gray-300 mt-0.5">
                            {new Date(tx.created_at).toLocaleDateString('fr-FR')} {new Date(tx.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {tx.performed_by_name && ` — ${tx.performed_by_name}`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Delete ingredient */}
            <div className="p-4 border-t">
              <button onClick={() => {
                if (confirm(`Supprimer "${selectedItem.ingredient_name}" ?`))
                  deleteIngredientMutation.mutate(selectedItem.ingredient_id);
              }}
                className="w-full py-2 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5">
                <Trash2 size={14} /> Supprimer cet ingredient
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Modal (Restock / Waste / Adjust) */}
      {actionModal && <ActionModal
        type={actionModal.type as 'adjust' | 'waste'}
        item={actionModal.item}
        onClose={() => setActionModal(null)}
        onAdjust={(qty, type, note) => adjustMutation.mutate({ ingredientId: actionModal.item.ingredient_id, quantity: qty, type, note })}
        isLoading={adjustMutation.isPending}
      />}

      {/* Add Ingredient Modal */}
      {showAddIngredient && <AddIngredientModal
        onClose={() => setShowAddIngredient(false)}
        onSave={(data) => addIngredientMutation.mutate(data)}
        isLoading={addIngredientMutation.isPending}
      />}
    </div>
  );
}

/* ─── Action Modal ─── */
function ActionModal({ type, item, onClose, onAdjust, isLoading }: {
  type: 'adjust' | 'waste';
  item: InventoryItem;
  onClose: () => void;
  onAdjust: (qty: number, type: string, note: string) => void;
  isLoading: boolean;
}) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');

  const titles = { adjust: 'Ajuster le stock', waste: 'Declarer une perte' };
  const colors = { adjust: 'bg-purple-600 hover:bg-purple-700', waste: 'bg-red-600 hover:bg-red-700' };
  const icons = { adjust: <RotateCcw size={18} />, waste: <TrendingDown size={18} /> };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(qty);
    if (!q) return;
    if (type === 'waste') {
      onAdjust(-Math.abs(q), 'waste', note || `Perte declaree`);
    } else {
      onAdjust(q, 'adjustment', note || `Ajustement manuel`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${colors[type].split(' ')[0]}`}>
            {icons[type]}
          </div>
          <div>
            <h2 className="text-lg font-bold">{titles[type]}</h2>
            <p className="text-sm text-gray-500">{item.ingredient_name}</p>
          </div>
        </div>

        {/* Current stock info */}
        <div className="bg-gray-50 rounded-xl p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">Stock actuel</span>
          <span className="font-bold">{parseFloat(item.current_quantity).toFixed(2)} {item.unit}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {type === 'restock' ? 'Quantite a ajouter' : type === 'waste' ? 'Quantite perdue' : 'Quantite (+/-)'}
            </label>
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" min={type === 'waste' ? '0.01' : undefined}
                className="input flex-1" placeholder="0.00" value={qty} onChange={e => setQty(e.target.value)} autoFocus required />
              <span className="text-sm text-gray-500 font-medium w-10">{item.unit}</span>
            </div>
            {qty && (
              <p className="text-xs mt-1.5 text-gray-400">
                Stock apres : <strong className="text-gray-700">
                  {(parseFloat(item.current_quantity) + (type === 'waste' ? -Math.abs(parseFloat(qty)) : parseFloat(qty))).toFixed(2)} {item.unit}
                </strong>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note (optionnel)</label>
            <input className="input" placeholder="Raison du mouvement..." value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading || !qty}
              className={`flex-1 py-2.5 px-4 rounded-xl text-white font-medium transition-colors disabled:opacity-50 ${colors[type]}`}>
              {isLoading ? 'Enregistrement...' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Add Ingredient Modal ─── */
function AddIngredientModal({ onClose, onSave, isLoading }: {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ name: '', unit: 'kg', unitCost: '', supplier: '', category: 'autre' });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
            <Plus size={18} />
          </div>
          <h2 className="text-lg font-bold">Nouvel ingredient</h2>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: form.name,
            unit: form.unit,
            unitCost: parseFloat(form.unitCost) || 0,
            supplier: form.supplier || undefined,
            category: form.category,
          });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom de l'ingredient</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Farine T55" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Unite</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">Kilogramme (kg)</option>
                <option value="g">Gramme (g)</option>
                <option value="l">Litre (l)</option>
                <option value="ml">Millilitre (ml)</option>
                <option value="unit">Unite</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Cout unitaire (DH)</label>
              <input type="number" step="0.01" className="input" value={form.unitCost}
                onChange={e => setForm({ ...form, unitCost: e.target.value })} placeholder="0.00" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Categorie</label>
            <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {INGREDIENT_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fournisseur</label>
            <input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nom du fournisseur" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
