import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { productsApi } from '../../api/products.api';
import { ingredientsApi } from '../../api/inventory.api';
import { ChefHat, X, Search, Scale, BookOpen, DollarSign, ChevronRight, Plus, Pencil, Trash2, PlusCircle, Layers, History, Clock, Eye, TrendingUp, LayoutGrid, List, Filter } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useReferentiel } from '../../hooks/useReferentiel';

interface RecipeIngredient {
  ingredient_id?: string;
  ingredient_name: string;
  unit: string;
  ingredient_base_unit: string;
  quantity: number;
  unit_cost: string;
}

interface SubRecipeRef {
  id: number;
  sub_recipe_id: string;
  sub_recipe_name: string;
  sub_yield_quantity: number;
  sub_yield_unit: string;
  sub_total_cost: string;
  quantity: number;
}

interface RecipeDetail {
  id: string;
  name: string;
  product_id: string;
  product_name: string;
  product_price: string;
  instructions: string;
  yield_quantity: number;
  yield_unit: string;
  total_cost: string;
  is_base: boolean;
  ingredients: RecipeIngredient[];
  sub_recipes: SubRecipeRef[];
}

// Unit conversion factors for cost calculation
const UNIT_TO_BASE: Record<string, { base: string; factor: number }> = {
  kg: { base: 'kg', factor: 1 }, g: { base: 'kg', factor: 0.001 },
  l: { base: 'l', factor: 1 }, ml: { base: 'l', factor: 0.001 },
  unit: { base: 'unit', factor: 1 },
};
function unitConversionFactor(fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return 1;
  const from = UNIT_TO_BASE[fromUnit], to = UNIT_TO_BASE[toUnit];
  if (!from || !to || from.base !== to.base) return 1;
  return from.factor / to.factor;
}

// Compatible units grouped by type
const COMPATIBLE_UNITS: Record<string, string[]> = {
  kg: ['kg', 'g'], g: ['kg', 'g'],
  l: ['l', 'ml'], ml: ['l', 'ml'],
  unit: ['unit'],
};

type RecipeFilter = 'all' | 'base' | 'product';
type ViewMode = 'grid' | 'list';

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const deleteMutation = useMutation({
    mutationFn: recipesApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recipes'] }); notify.success('Recette supprimee'); },
  });

  const filtered = recipes.filter((r: Record<string, unknown>) => {
    const s = search.toLowerCase();
    const matchSearch = !s || (r.name as string).toLowerCase().includes(s) || (r.product_name as string || '').toLowerCase().includes(s);
    const matchFilter = filter === 'all' ||
      (filter === 'base' && r.is_base === true) ||
      (filter === 'product' && !r.is_base);
    return matchSearch && matchFilter;
  });

  const baseCount = recipes.filter((r: Record<string, unknown>) => r.is_base === true).length;
  const productCount = recipes.filter((r: Record<string, unknown>) => !r.is_base).length;
  const avgCost = recipes.length > 0 ? recipes.reduce((s: number, r: Record<string, unknown>) => s + parseFloat(r.total_cost as string || '0'), 0) / recipes.length : 0;

  const openEdit = (id: string) => {
    setEditingRecipeId(id);
    setShowForm(true);
    setSelectedRecipeId(null);
  };

  const openCreate = () => {
    setEditingRecipeId(null);
    setShowForm(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recettes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filter !== 'all' ? `${filtered.length} sur ${recipes.length} recettes` : `${recipes.length} recettes au catalogue`}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 shadow-md hover:shadow-lg transition-shadow">
          <Plus size={18} /> Nouvelle recette
        </button>
      </div>

      {/* Stats cards — clickable filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div onClick={() => setFilter(filter === 'all' ? 'all' : 'all')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            filter === 'all' ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200' : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <BookOpen size={20} className="text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{recipes.length}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>
        </div>
        <div onClick={() => setFilter(filter === 'base' ? 'all' : 'base')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            filter === 'base' ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200' : 'bg-white border-gray-100 hover:border-amber-200 hover:bg-amber-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Layers size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">{baseCount}</div>
              <div className="text-xs text-gray-500">Prep. de base</div>
            </div>
          </div>
        </div>
        <div onClick={() => setFilter(filter === 'product' ? 'all' : 'product')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            filter === 'product' ? 'bg-green-50 border-green-300 ring-2 ring-green-200' : 'bg-white border-gray-100 hover:border-green-200 hover:bg-green-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <ChefHat size={20} className="text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-green-700">{productCount}</div>
              <div className="text-xs text-gray-500">Produits finis</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
              <TrendingUp size={20} className="text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-700">{avgCost.toFixed(1)}</div>
              <div className="text-xs text-gray-500">Cout moy. (DH)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Rechercher une recette ou un produit..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white transition-colors" />
          </div>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                filter === 'base' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'
              }`}>
              {filter === 'base' ? 'Prep. de base' : 'Produits finis'}
              <X size={14} />
            </button>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}>
              <LayoutGrid size={18} />
            </button>
            <button onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full" />
        </div>
      ) : viewMode === 'grid' ? (
        /* ═══ Grid View ═══ */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" style={{ maxHeight: 'calc(100vh - 22rem)', overflowY: 'auto' }}>
          {filtered.map((r: Record<string, unknown>) => {
            const totalCost = parseFloat(r.total_cost as string || '0');
            const yieldQty = r.yield_quantity as number || 1;
            const costPerUnit = totalCost / yieldQty;
            const price = parseFloat(r.product_price as string || '0');
            const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;

            return (
              <div key={r.id as string}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden group hover:shadow-md transition-all cursor-pointer ${
                  r.is_base ? 'border-l-4 border-l-amber-400' : 'border-gray-100'
                }`}
                onClick={() => setSelectedRecipeId(r.id as string)}
              >
                {/* Header */}
                <div className={`p-4 ${r.is_base ? 'bg-gradient-to-r from-amber-50 to-yellow-50' : 'bg-gradient-to-r from-orange-50 to-amber-50'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl shrink-0 ${r.is_base ? 'bg-amber-100' : 'bg-white/80'}`}>
                      {r.is_base ? <Layers size={22} className="text-amber-600" /> : <ChefHat size={22} className="text-amber-700" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm text-gray-900 truncate" title={r.name as string}>{r.name as string}</h3>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {r.is_base
                          ? <span className="text-amber-600 font-medium">Preparation de base</span>
                          : (r.product_name as string || 'Aucun produit')}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Stats */}
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                      <div className="text-xs text-gray-400">Rendement</div>
                      <div className="text-sm font-bold text-gray-700">{yieldQty} {r.yield_unit as string || 'u.'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                      <div className="text-xs text-gray-400">Cout total</div>
                      <div className="text-sm font-bold text-amber-700">{totalCost.toFixed(2)} DH</div>
                    </div>
                  </div>
                  {!r.is_base && price > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs text-gray-400">Marge</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        margin >= 50 ? 'bg-green-100 text-green-700' : margin >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>{margin.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
                {/* Actions */}
                <div className="border-t border-gray-50 px-4 py-2 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openEdit(r.id as string)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Modifier">
                    <Pencil size={14} className="text-gray-400" />
                  </button>
                  <button onClick={() => { if (confirm('Supprimer cette recette ?')) deleteMutation.mutate(r.id as string); }}
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer">
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-400">
              <BookOpen size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucune recette trouvee</p>
              <p className="text-sm mt-1">Essayez de modifier vos filtres</p>
            </div>
          )}
        </div>
      ) : (
        /* ═══ List View ═══ */
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto" style={{ maxHeight: 'calc(100vh - 22rem)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Recette</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Produit</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rendement</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cout total</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cout/u.</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Marge</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r: Record<string, unknown>) => {
                const totalCost = parseFloat(r.total_cost as string || '0');
                const yieldQty = r.yield_quantity as number || 1;
                const costPerUnit = totalCost / yieldQty;
                const price = parseFloat(r.product_price as string || '0');
                const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;

                return (
                  <tr key={r.id as string} className="hover:bg-amber-50/30 transition-colors cursor-pointer" onClick={() => setSelectedRecipeId(r.id as string)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${r.is_base ? 'bg-amber-100' : 'bg-orange-50'}`}>
                          {r.is_base ? <Layers size={16} className="text-amber-600" /> : <ChefHat size={16} className="text-amber-700" />}
                        </div>
                        <span className="font-semibold text-sm text-gray-900">{r.name as string}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        r.is_base ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {r.is_base ? 'Base' : 'Produit'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {r.is_base ? <span className="text-gray-300">—</span> : (r.product_name as string || '—')}
                    </td>
                    <td className="px-5 py-3 text-center text-sm font-semibold text-gray-700">{yieldQty} {r.yield_unit as string || 'u.'}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-bold text-gray-900">{totalCost.toFixed(2)}</span>
                      <span className="text-xs text-gray-400 ml-0.5">DH</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-medium text-gray-600">{costPerUnit.toFixed(2)}</span>
                      <span className="text-xs text-gray-400 ml-0.5">DH</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {!r.is_base && price > 0 ? (
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          margin >= 50 ? 'bg-green-100 text-green-700' : margin >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        }`}>{margin.toFixed(0)}%</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setSelectedRecipeId(r.id as string)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Voir">
                          <Eye size={15} className="text-gray-400" />
                        </button>
                        <button onClick={() => openEdit(r.id as string)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Modifier">
                          <Pencil size={15} className="text-gray-500" />
                        </button>
                        <button onClick={() => { if (confirm('Supprimer cette recette ?')) deleteMutation.mutate(r.id as string); }}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer">
                          <Trash2 size={15} className="text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <BookOpen size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucune recette trouvee</p>
              <p className="text-sm mt-1">Essayez de modifier vos filtres</p>
            </div>
          )}
        </div>
      )}

      {selectedRecipeId && (
        <RecipeDetailModal
          recipeId={selectedRecipeId}
          onClose={() => setSelectedRecipeId(null)}
          onEdit={() => openEdit(selectedRecipeId)}
        />
      )}

      {showForm && (
        <RecipeFormModal
          recipeId={editingRecipeId}
          onClose={() => { setShowForm(false); setEditingRecipeId(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditingRecipeId(null);
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DETAIL MODAL — Redesigned
   ═══════════════════════════════════════════════════════════════════════════ */

function RecipeDetailModal({ recipeId, onClose, onEdit }: { recipeId: string; onClose: () => void; onEdit: () => void }) {
  const { data: recipe, isLoading } = useQuery<RecipeDetail>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId),
  });

  const { data: versions = [] } = useQuery<Array<{
    id: string; version_number: number; name: string; instructions: string;
    yield_quantity: number; total_cost: string; is_base: boolean;
    ingredients: unknown[]; sub_recipes: unknown[];
    changed_by_name: string; change_note: string; created_at: string;
  }>>({
    queryKey: ['recipe-versions', recipeId],
    queryFn: () => recipesApi.versions(recipeId),
  });

  const [showVersions, setShowVersions] = useState(false);
  const [portions, setPortions] = useState<number | null>(null);

  const yieldQty = recipe?.yield_quantity || 1;
  const targetPortions = portions || yieldQty;
  const multiplier = targetPortions / yieldQty;

  const ingredientCost = recipe?.ingredients?.reduce((sum, ing) => {
    return sum + (ing.quantity * multiplier * parseFloat(ing.unit_cost || '0'));
  }, 0) || 0;

  const subRecipeCost = recipe?.sub_recipes?.reduce((sum, sr) => {
    const costPerUnit = parseFloat(sr.sub_total_cost || '0') / (sr.sub_yield_quantity || 1);
    return sum + costPerUnit * sr.quantity * multiplier;
  }, 0) || 0;

  const totalCost = ingredientCost + subRecipeCost;
  const costPerUnit = targetPortions > 0 ? totalCost / targetPortions : 0;
  const sellingPrice = parseFloat(recipe?.product_price || '0');
  const margin = sellingPrice > 0 ? ((sellingPrice - costPerUnit) / sellingPrice * 100) : 0;

  const steps = (() => {
    if (!recipe?.instructions) return [];
    const text = recipe.instructions.trim();
    const numberedMatch = text.match(/\d+\.\s/);
    if (numberedMatch) return text.split(/\d+\.\s+/).filter(s => s.trim()).map(s => s.trim().replace(/\.$/, ''));
    if (text.includes('\n')) return text.split('\n').filter(s => s.trim()).map(s => s.trim());
    return text.split('. ').filter(s => s.trim());
  })();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`p-6 border-b bg-gradient-to-r ${recipe?.is_base ? 'from-amber-50 to-yellow-50' : 'from-orange-50 to-amber-50'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${recipe?.is_base ? 'bg-amber-100' : 'bg-white/80 shadow-sm'}`}>
                {recipe?.is_base ? <Layers size={28} className="text-amber-600" /> : <ChefHat size={28} className="text-amber-700" />}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{recipe?.name || 'Chargement...'}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {recipe?.is_base
                    ? <span className="text-amber-600 font-medium">Preparation de base</span>
                    : recipe?.product_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onEdit} className="px-3 py-2 bg-white/70 hover:bg-white rounded-lg text-sm font-medium text-gray-600 transition-colors flex items-center gap-1.5">
                <Pencil size={14} /> Modifier
              </button>
              <button onClick={onClose} className="w-9 h-9 bg-white/70 hover:bg-white rounded-lg flex items-center justify-center transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Key stats */}
          {recipe && (
            <div className={`grid ${recipe.is_base ? 'grid-cols-3' : 'grid-cols-4'} gap-3 mt-5`}>
              <div className="bg-white/80 backdrop-blur rounded-xl p-3 text-center shadow-sm">
                <Scale size={16} className="mx-auto text-amber-600 mb-1" />
                <p className="text-[11px] text-gray-400 uppercase tracking-wider">Rendement</p>
                <p className="font-bold text-lg text-gray-900">{yieldQty} <span className="text-xs font-normal">{recipe.yield_unit || 'u.'}</span></p>
              </div>
              <div className="bg-white/80 backdrop-blur rounded-xl p-3 text-center shadow-sm">
                <DollarSign size={16} className="mx-auto text-green-600 mb-1" />
                <p className="text-[11px] text-gray-400 uppercase tracking-wider">Cout total</p>
                <p className="font-bold text-lg text-gray-900">{totalCost.toFixed(2)} <span className="text-xs font-normal">DH</span></p>
              </div>
              <div className="bg-white/80 backdrop-blur rounded-xl p-3 text-center shadow-sm">
                <DollarSign size={16} className="mx-auto text-blue-600 mb-1" />
                <p className="text-[11px] text-gray-400 uppercase tracking-wider">Cout/unite</p>
                <p className="font-bold text-lg text-gray-900">{costPerUnit.toFixed(2)} <span className="text-xs font-normal">DH</span></p>
              </div>
              {!recipe.is_base && (
                <div className="bg-white/80 backdrop-blur rounded-xl p-3 text-center shadow-sm">
                  <TrendingUp size={16} className={`mx-auto mb-1 ${margin >= 50 ? 'text-green-600' : margin >= 30 ? 'text-amber-600' : 'text-red-600'}`} />
                  <p className="text-[11px] text-gray-400 uppercase tracking-wider">Marge</p>
                  <p className={`font-bold text-lg ${margin >= 50 ? 'text-green-700' : margin >= 30 ? 'text-amber-700' : 'text-red-700'}`}>{margin.toFixed(1)}%</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full" />
            </div>
          ) : recipe ? (
            <>
              {/* Portions calculator */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-blue-800 mb-2 flex items-center gap-2">
                  <Scale size={16} /> Calculateur de portions
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-blue-700">Quantite souhaitee :</span>
                  <input type="number" min={0.1} step="0.1" value={targetPortions} onChange={(e) => setPortions(parseFloat(e.target.value) || 1)}
                    className="w-24 text-center font-bold px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                  <span className="text-sm text-blue-700">{recipe.yield_unit || 'unites'}</span>
                  {portions !== null && portions !== yieldQty && (
                    <button onClick={() => setPortions(null)} className="text-xs text-blue-500 hover:text-blue-700 underline">Reinitialiser ({yieldQty})</button>
                  )}
                </div>
                {multiplier !== 1 && <p className="text-xs text-blue-600 mt-2">Quantites multipliees par <strong>{multiplier.toFixed(2)}x</strong></p>}
              </div>

              {/* Sub-recipes */}
              {recipe.sub_recipes && recipe.sub_recipes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                    <Layers size={18} className="text-amber-600" /> Preparations de base
                    <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{recipe.sub_recipes.length}</span>
                  </h3>
                  <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-amber-50">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Preparation</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Quantite</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Rendement</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Cout unit.</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Sous-total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-50">
                        {recipe.sub_recipes.map((sr, idx) => {
                          const costPerU = parseFloat(sr.sub_total_cost || '0') / (sr.sub_yield_quantity || 1);
                          const qty = sr.quantity * multiplier;
                          const cost = costPerU * qty;
                          return (
                            <tr key={idx} className="hover:bg-amber-50/50">
                              <td className="px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                                <Layers size={14} className="text-amber-500" /> {sr.sub_recipe_name}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right font-semibold text-amber-700">{qty.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{sr.sub_yield_quantity} {sr.sub_yield_unit || 'u.'}</td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{costPerU.toFixed(2)} DH</td>
                              <td className="px-4 py-2.5 text-sm text-right font-bold">{cost.toFixed(2)} DH</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-amber-50 font-bold">
                        <tr>
                          <td colSpan={4} className="px-4 py-2.5 text-sm text-right">Sous-total preparations</td>
                          <td className="px-4 py-2.5 text-sm text-right text-amber-700">{subRecipeCost.toFixed(2)} DH</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Ingredients */}
              <div>
                <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                  <Scale size={18} className="text-amber-700" /> Ingredients
                  <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{recipe.ingredients?.length || 0}</span>
                </h3>
                {recipe.ingredients && recipe.ingredients.length > 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ingredient</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Quantite</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Unite</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cout unit.</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Sous-total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {recipe.ingredients.map((ing, idx) => {
                          const qty = ing.quantity * multiplier;
                          const cost = qty * parseFloat(ing.unit_cost || '0');
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-sm font-medium">{ing.ingredient_name}</td>
                              <td className="px-4 py-2.5 text-sm text-right font-semibold text-amber-700">
                                {qty < 0.01 ? qty.toFixed(4) : qty < 1 ? qty.toFixed(3) : qty.toFixed(2)}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{ing.unit}</td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{parseFloat(ing.unit_cost).toFixed(2)} DH</td>
                              <td className="px-4 py-2.5 text-sm text-right font-bold">{cost.toFixed(2)} DH</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 font-bold">
                        <tr>
                          <td colSpan={4} className="px-4 py-2.5 text-sm text-right">Sous-total ingredients</td>
                          <td className="px-4 py-2.5 text-sm text-right text-amber-700">{ingredientCost.toFixed(2)} DH</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">Aucun ingredient associe</p>
                )}
              </div>

              {/* Total cost */}
              {recipe.sub_recipes && recipe.sub_recipes.length > 0 && recipe.ingredients && recipe.ingredients.length > 0 && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 flex justify-between items-center">
                  <span className="font-semibold text-gray-700">Cout total (preparations + ingredients)</span>
                  <span className="text-xl font-bold text-amber-700">{totalCost.toFixed(2)} DH</span>
                </div>
              )}

              {/* Instructions */}
              {recipe.instructions && (
                <div>
                  <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                    <BookOpen size={18} className="text-amber-700" /> Guide de production
                  </h3>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
                    {steps.map((step, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-sm font-bold">{idx + 1}</span>
                        <p className="text-sm text-amber-900 pt-1">{step.endsWith('.') ? step : `${step}.`}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Production summary */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h3 className="font-semibold text-sm text-green-800 mb-3">Resume de production</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-green-600 text-xs">Quantite a produire</p>
                    <p className="font-bold text-lg text-green-800">{targetPortions} u.</p>
                  </div>
                  <div>
                    <p className="text-green-600 text-xs">Cout total matieres</p>
                    <p className="font-bold text-lg text-green-800">{totalCost.toFixed(2)} DH</p>
                  </div>
                  <div>
                    <p className="text-green-600 text-xs">Cout par unite</p>
                    <p className="font-bold text-lg text-green-800">{costPerUnit.toFixed(2)} DH</p>
                  </div>
                  {!recipe.is_base && (
                    <div>
                      <p className="text-green-600 text-xs">Prix de vente</p>
                      <p className="font-bold text-lg text-green-800">{sellingPrice.toFixed(2)} DH</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Version history */}
              <div className="border-t border-gray-100 pt-4">
                <button onClick={() => setShowVersions(!showVersions)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
                  <History size={16} /> Historique des modifications
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{versions.length}</span>
                  <ChevronRight size={14} className={`transition-transform ${showVersions ? 'rotate-90' : ''}`} />
                </button>
                {showVersions && versions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {versions.map((v) => (
                      <div key={v.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-700">Version {v.version_number}</span>
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock size={12} />
                            {new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 space-y-0.5">
                          <p>Nom: {v.name} · Rendement: {v.yield_quantity} · Cout: {parseFloat(v.total_cost || '0').toFixed(2)} DH</p>
                          <p>{(v.ingredients as unknown[]).length} ingredient(s), {(v.sub_recipes as unknown[]).length} sous-recette(s)</p>
                          {v.changed_by_name && <p className="text-gray-400">Par: {v.changed_by_name}</p>}
                          {v.change_note && <p className="italic text-gray-400">Note: {v.change_note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {showVersions && versions.length === 0 && (
                  <p className="mt-2 text-sm text-gray-400 italic">Aucune modification enregistree</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-red-500 text-center py-8">Recette introuvable</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORM MODAL — Redesigned with tabs
   ═══════════════════════════════════════════════════════════════════════════ */

interface FormIngredient {
  ingredientId: string;
  quantity: string;
  unit: string;
}

interface FormSubRecipe {
  subRecipeId: string;
  quantity: string;
}

type FormTab = 'info' | 'composition' | 'instructions';

function RecipeFormModal({ recipeId, onClose, onSaved }: {
  recipeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!recipeId;
  const [activeTab, setActiveTab] = useState<FormTab>('info');

  const { data: existingRecipe } = useQuery<RecipeDetail>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId!),
    enabled: isEdit,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-for-recipe'],
    queryFn: () => productsApi.list({ limit: '500' }).then(r => r.data),
  });

  const { data: allIngredients = [] } = useQuery({
    queryKey: ['ingredients-list'],
    queryFn: ingredientsApi.list,
  });

  const { data: baseRecipes = [] } = useQuery({
    queryKey: ['base-recipes'],
    queryFn: recipesApi.listBase,
  });

  const { entries: yieldUnits } = useReferentiel('yield_units');

  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [yieldUnit, setYieldUnit] = useState('unit');
  const [instructions, setInstructions] = useState('');
  const [isBase, setIsBase] = useState(false);
  const [formIngredients, setFormIngredients] = useState<FormIngredient[]>([{ ingredientId: '', quantity: '', unit: '' }]);
  const [formSubRecipes, setFormSubRecipes] = useState<FormSubRecipe[]>([]);

  if (isEdit && existingRecipe && !initialized) {
    setName(existingRecipe.name);
    setProductId(existingRecipe.product_id || '');
    setYieldQuantity(String(existingRecipe.yield_quantity));
    setYieldUnit(existingRecipe.yield_unit || 'unit');
    setInstructions(existingRecipe.instructions || '');
    setIsBase(existingRecipe.is_base || false);
    setFormIngredients(
      existingRecipe.ingredients.length > 0
        ? existingRecipe.ingredients.map(ing => ({ ingredientId: ing.ingredient_id || '', quantity: String(ing.quantity), unit: ing.unit || '' }))
        : [{ ingredientId: '', quantity: '', unit: '' }]
    );
    setFormSubRecipes(
      existingRecipe.sub_recipes && existingRecipe.sub_recipes.length > 0
        ? existingRecipe.sub_recipes.map(sr => ({ subRecipeId: sr.sub_recipe_id, quantity: String(sr.quantity) }))
        : []
    );
    setInitialized(true);
  }

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => recipesApi.create(data),
    onSuccess: () => { notify.success('Recette creee'); onSaved(); },
    onError: () => notify.error('Erreur lors de la creation'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => recipesApi.update(recipeId!, data),
    onSuccess: () => { notify.success('Recette mise a jour'); onSaved(); },
    onError: () => notify.error('Erreur lors de la mise a jour'),
  });

  const addIngredientRow = () => setFormIngredients([...formIngredients, { ingredientId: '', quantity: '', unit: '' }]);
  const removeIngredientRow = (idx: number) => { if (formIngredients.length <= 1) return; setFormIngredients(formIngredients.filter((_, i) => i !== idx)); };
  const updateIngredientRow = (idx: number, field: keyof FormIngredient, value: string) => setFormIngredients(formIngredients.map((row, i) => i === idx ? { ...row, [field]: value } : row));

  const addSubRecipeRow = () => setFormSubRecipes([...formSubRecipes, { subRecipeId: '', quantity: '' }]);
  const removeSubRecipeRow = (idx: number) => setFormSubRecipes(formSubRecipes.filter((_, i) => i !== idx));
  const updateSubRecipeRow = (idx: number, field: keyof FormSubRecipe, value: string) => setFormSubRecipes(formSubRecipes.map((row, i) => i === idx ? { ...row, [field]: value } : row));

  const availableBaseRecipes = baseRecipes.filter((br: Record<string, unknown>) => br.id !== recipeId);

  const ingredientCost = formIngredients.reduce((sum, row) => {
    if (!row.ingredientId || !row.quantity) return sum;
    const ing = allIngredients.find((i: Record<string, unknown>) => i.id === row.ingredientId);
    if (!ing) return sum;
    const ingBaseUnit = ing.unit as string || 'unit';
    const recipeUnit = row.unit || ingBaseUnit;
    const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
    return sum + parseFloat(row.quantity) * parseFloat(ing.unit_cost as string || '0') * factor;
  }, 0);

  const subRecipeCost = formSubRecipes.reduce((sum, row) => {
    if (!row.subRecipeId || !row.quantity) return sum;
    const sr = baseRecipes.find((r: Record<string, unknown>) => r.id === row.subRecipeId);
    if (!sr) return sum;
    const costPerUnit = parseFloat(sr.total_cost || '0') / (parseFloat(sr.yield_quantity as string) || 1);
    return sum + costPerUnit * parseFloat(row.quantity);
  }, 0);

  const liveCost = ingredientCost + subRecipeCost;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validIngredients = formIngredients
      .filter(row => row.ingredientId && row.quantity && parseFloat(row.quantity) > 0)
      .map(row => ({ ingredientId: row.ingredientId, quantity: parseFloat(row.quantity), unit: row.unit || null }));

    const validSubRecipes = formSubRecipes
      .filter(row => row.subRecipeId && row.quantity && parseFloat(row.quantity) > 0)
      .map(row => ({ subRecipeId: row.subRecipeId, quantity: parseFloat(row.quantity) }));

    if (validIngredients.length === 0 && validSubRecipes.length === 0) {
      notify.error('Ajoutez au moins un ingredient ou une preparation de base');
      return;
    }

    const data: Record<string, unknown> = {
      name,
      productId: isBase ? null : productId,
      yieldQuantity: parseFloat(yieldQuantity) || 1,
      yieldUnit,
      instructions,
      isBase,
      ingredients: validIngredients,
      subRecipes: validSubRecipes,
    };

    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const tabs: { key: FormTab; label: string; icon: React.ReactNode }[] = [
    { key: 'info', label: 'Informations', icon: <ChefHat size={16} /> },
    { key: 'composition', label: 'Composition', icon: <Scale size={16} /> },
    { key: 'instructions', label: 'Instructions', icon: <BookOpen size={16} /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isBase ? 'bg-amber-100' : 'bg-orange-50'}`}>
              {isBase ? <Layers size={22} className="text-amber-600" /> : <ChefHat size={22} className="text-amber-700" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
              {name && <p className="text-xs text-gray-400 mt-0.5">{name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
              }`}>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* ═══ Tab: Info ═══ */}
            {activeTab === 'info' && (
              <>
                {/* Base toggle */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                        <Layers size={18} className="text-amber-600" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-gray-900">Preparation de base</span>
                        <p className="text-xs text-gray-400">Reutilisable dans d'autres recettes (pate, creme...)</p>
                      </div>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${isBase ? 'bg-amber-500' : 'bg-gray-300'}`}
                      onClick={() => setIsBase(!isBase)}>
                      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                        style={{ transform: isBase ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nom de la recette</label>
                  <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white font-medium"
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder={isBase ? 'ex: Pate a croissant' : 'ex: Recette Croissant'} required />
                </div>

                {!isBase && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Produit associe</label>
                    <select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={productId} onChange={(e) => setProductId(e.target.value)} required={!isBase}>
                      <option value="">-- Choisir un produit --</option>
                      {allProducts.map((p: Record<string, unknown>) => (
                        <option key={p.id as string} value={p.id as string}>{p.name as string}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Rendement</label>
                  <div className="flex gap-2">
                    <input type="number" min={0.1} step="0.1"
                      className="w-28 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-bold"
                      value={yieldQuantity} onChange={(e) => setYieldQuantity(e.target.value)} required />
                    <select
                      className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium"
                      value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)}>
                      {yieldUnits.map(u => (
                        <option key={u.code} value={u.code}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Ex: 5 kg pour une pate, 3 moules pour une genoise</p>
                </div>
              </>
            )}

            {/* ═══ Tab: Composition ═══ */}
            {activeTab === 'composition' && (
              <>
                {/* Sub-recipes */}
                {!isBase && availableBaseRecipes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Layers size={16} className="text-amber-600" /> Preparations de base
                      </h3>
                      <button type="button" onClick={addSubRecipeRow}
                        className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 font-medium px-3 py-1.5 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
                        <PlusCircle size={14} /> Ajouter
                      </button>
                    </div>

                    {formSubRecipes.length > 0 ? (
                      <div className="border border-amber-200 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 text-xs font-semibold text-amber-700 px-4 py-2.5 bg-amber-50 uppercase tracking-wider">
                          <span>Preparation</span>
                          <span>Quantite</span>
                          <span>Rendement</span>
                          <span>Cout</span>
                          <span></span>
                        </div>
                        <div className="divide-y divide-amber-50">
                          {formSubRecipes.map((row, idx) => {
                            const selectedSr = availableBaseRecipes.find((r: Record<string, unknown>) => r.id === row.subRecipeId) as Record<string, unknown> | undefined;
                            const srCost = selectedSr && row.quantity
                              ? (parseFloat(selectedSr.total_cost as string || '0') / (parseFloat(selectedSr.yield_quantity as string) || 1)) * parseFloat(row.quantity)
                              : 0;
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 items-center px-4 py-2">
                                <select className="w-full px-3 py-2 bg-gray-50 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                  value={row.subRecipeId} onChange={(e) => updateSubRecipeRow(idx, 'subRecipeId', e.target.value)}>
                                  <option value="">-- Preparation --</option>
                                  {availableBaseRecipes.map((r: Record<string, unknown>) => (
                                    <option key={r.id as string} value={r.id as string}>{r.name as string}</option>
                                  ))}
                                </select>
                                <input type="number" step="0.01" min="0"
                                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 font-semibold"
                                  value={row.quantity} onChange={(e) => updateSubRecipeRow(idx, 'quantity', e.target.value)} placeholder="0" />
                                <span className="text-xs text-gray-500 text-center">{selectedSr ? `${selectedSr.yield_quantity} ${selectedSr.yield_unit || 'u.'}` : '—'}</span>
                                <span className="text-xs font-bold text-amber-700 text-center">{srCost > 0 ? `${srCost.toFixed(2)}` : '—'}</span>
                                <button type="button" onClick={() => removeSubRecipeRow(idx)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 size={14} className="text-red-400" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic bg-gray-50 rounded-xl p-4 text-center">Aucune preparation de base ajoutee</p>
                    )}
                  </div>
                )}

                {/* Ingredients */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Scale size={16} className="text-amber-700" /> Ingredients
                    </h3>
                    <button type="button" onClick={addIngredientRow}
                      className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 font-medium px-3 py-1.5 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
                      <PlusCircle size={14} /> Ajouter
                    </button>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 uppercase tracking-wider">
                      <span>Ingredient</span>
                      <span>Quantite</span>
                      <span>Unite</span>
                      <span>Cout</span>
                      <span></span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {formIngredients.map((row, idx) => {
                        const selectedIng = allIngredients.find((i: Record<string, unknown>) => i.id === row.ingredientId) as Record<string, unknown> | undefined;
                        const ingBaseUnit = selectedIng ? selectedIng.unit as string : 'unit';
                        const currentUnit = row.unit || ingBaseUnit;
                        const compatibleUnits = COMPATIBLE_UNITS[ingBaseUnit] || [ingBaseUnit];
                        const factor = unitConversionFactor(currentUnit, ingBaseUnit);
                        const rowCost = selectedIng && row.quantity ? parseFloat(row.quantity) * parseFloat(selectedIng.unit_cost as string || '0') * factor : 0;
                        return (
                          <div key={idx} className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 items-center px-4 py-2">
                            <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                              value={row.ingredientId} onChange={(e) => {
                                const newIng = allIngredients.find((i: Record<string, unknown>) => i.id === e.target.value) as Record<string, unknown> | undefined;
                                const updated = [...formIngredients];
                                updated[idx] = { ...updated[idx], ingredientId: e.target.value, unit: newIng ? newIng.unit as string : '' };
                                setFormIngredients(updated);
                              }}>
                              <option value="">-- Ingredient --</option>
                              {allIngredients.map((i: Record<string, unknown>) => (
                                <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                              ))}
                            </select>
                            <input type="number" step="0.01" min="0"
                              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 font-semibold"
                              value={row.quantity} onChange={(e) => updateIngredientRow(idx, 'quantity', e.target.value)} placeholder="0" />
                            <select className="w-full px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 font-medium"
                              value={currentUnit} onChange={(e) => updateIngredientRow(idx, 'unit', e.target.value)}>
                              {compatibleUnits.map(u => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                            <span className="text-xs font-bold text-gray-700 text-center">{rowCost > 0 ? `${rowCost.toFixed(2)}` : '—'}</span>
                            <button type="button" onClick={() => removeIngredientRow(idx)}
                              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors" disabled={formIngredients.length <= 1}>
                              <Trash2 size={14} className={formIngredients.length <= 1 ? 'text-gray-200' : 'text-red-400'} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Live cost */}
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 space-y-2">
                  {subRecipeCost > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-amber-600">Preparations de base</span>
                      <span className="font-semibold text-amber-700">{subRecipeCost.toFixed(2)} DH</span>
                    </div>
                  )}
                  {ingredientCost > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Ingredients</span>
                      <span className="font-semibold text-gray-700">{ingredientCost.toFixed(2)} DH</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1 border-t border-amber-200">
                    <span className="font-semibold text-gray-700">Cout total estime</span>
                    <span className="font-bold text-amber-700 text-xl">{liveCost.toFixed(2)} DH</span>
                  </div>
                </div>
              </>
            )}

            {/* ═══ Tab: Instructions ═══ */}
            {activeTab === 'instructions' && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <BookOpen size={20} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-amber-800">Guide de production</h3>
                      <p className="text-xs text-amber-600 mt-0.5">Decrivez les etapes de preparation. Utilisez des numeros (1. 2. 3.) ou des retours a la ligne pour separer les etapes.</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Instructions</label>
                  <textarea
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white resize-none leading-relaxed"
                    rows={10} value={instructions} onChange={(e) => setInstructions(e.target.value)}
                    placeholder={"1. Petrir la farine, l'eau, le sel et la levure\n2. Laisser reposer 1 heure (pointage)\n3. Faconner les pieces\n4. Enfourner a 250°C pendant 20 minutes"} />
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={isPending}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2">
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enregistrement...
                </>
              ) : isEdit ? 'Mettre a jour' : 'Creer la recette'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
