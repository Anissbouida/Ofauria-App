import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { productsApi } from '../../api/products.api';
import { ingredientsApi } from '../../api/inventory.api';
import { ChefHat, X, Search, Scale, BookOpen, DollarSign, ChevronRight, Plus, Pencil, Trash2, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface RecipeIngredient {
  ingredient_id?: string;
  ingredient_name: string;
  unit: string;
  quantity: number;
  unit_cost: string;
}

interface RecipeDetail {
  id: string;
  name: string;
  product_id: string;
  product_name: string;
  product_price: string;
  instructions: string;
  yield_quantity: number;
  total_cost: string;
  ingredients: RecipeIngredient[];
}

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: recipesApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recipes'] }); toast.success('Recette supprimee'); },
  });

  const filtered = recipes.filter((r: Record<string, unknown>) => {
    const s = search.toLowerCase();
    return !s || (r.name as string).toLowerCase().includes(s) || (r.product_name as string || '').toLowerCase().includes(s);
  });

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Recettes</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{recipes.length} recettes</span>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Nouvelle recette
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Rechercher une recette ou un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r: Record<string, unknown>) => (
            <div key={r.id as string} className="card hover:shadow-md hover:border-primary-200 transition-all group">
              <button onClick={() => setSelectedRecipeId(r.id as string)} className="w-full text-left">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <ChefHat size={20} className="text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{r.name as string}</h3>
                    <p className="text-sm text-gray-500 truncate">{r.product_name as string}</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-primary-500 transition-colors" />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Rendement: {r.yield_quantity as number} unites</span>
                  <span className="font-semibold text-primary-600">{parseFloat(r.total_cost as string || '0').toFixed(2)} DH</span>
                </div>
              </button>
              <div className="flex justify-end gap-1 mt-2 pt-2 border-t border-gray-50">
                <button onClick={() => openEdit(r.id as string)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Modifier">
                  <Pencil size={15} className="text-gray-400" />
                </button>
                <button onClick={() => { if (confirm('Supprimer cette recette ?')) deleteMutation.mutate(r.id as string); }} className="p-1.5 hover:bg-red-50 rounded-lg" title="Supprimer">
                  <Trash2 size={15} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-gray-400 col-span-full text-center py-8">Aucune recette trouvee</p>}
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

/* ============ DETAIL MODAL ============ */

function RecipeDetailModal({ recipeId, onClose, onEdit }: { recipeId: string; onClose: () => void; onEdit: () => void }) {
  const { data: recipe, isLoading } = useQuery<RecipeDetail>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId),
  });

  const [portions, setPortions] = useState<number | null>(null);

  const yieldQty = recipe?.yield_quantity || 1;
  const targetPortions = portions || yieldQty;
  const multiplier = targetPortions / yieldQty;

  const totalCost = recipe?.ingredients?.reduce((sum, ing) => {
    return sum + (ing.quantity * multiplier * parseFloat(ing.unit_cost || '0'));
  }, 0) || 0;

  const costPerUnit = targetPortions > 0 ? totalCost / targetPortions : 0;
  const sellingPrice = parseFloat(recipe?.product_price || '0');
  const margin = sellingPrice > 0 ? ((sellingPrice - costPerUnit) / sellingPrice * 100) : 0;
  const steps = recipe?.instructions?.split('. ').filter(s => s.trim()) || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b bg-gradient-to-r from-primary-50 to-orange-50">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary-100 rounded-xl">
                <ChefHat size={28} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-bakery-chocolate">{recipe?.name || 'Chargement...'}</h2>
                <p className="text-sm text-gray-500">{recipe?.product_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onEdit} className="p-2 hover:bg-white/50 rounded-lg" title="Modifier">
                <Pencil size={18} className="text-gray-500" />
              </button>
              <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
          </div>
          {recipe && (
            <div className="grid grid-cols-4 gap-3 mt-4">
              <div className="bg-white/70 rounded-lg p-3 text-center">
                <Scale size={16} className="mx-auto text-primary-500 mb-1" />
                <p className="text-xs text-gray-500">Rendement</p>
                <p className="font-bold text-sm">{yieldQty} unites</p>
              </div>
              <div className="bg-white/70 rounded-lg p-3 text-center">
                <DollarSign size={16} className="mx-auto text-green-500 mb-1" />
                <p className="text-xs text-gray-500">Cout total</p>
                <p className="font-bold text-sm">{totalCost.toFixed(2)} DH</p>
              </div>
              <div className="bg-white/70 rounded-lg p-3 text-center">
                <DollarSign size={16} className="mx-auto text-blue-500 mb-1" />
                <p className="text-xs text-gray-500">Cout/unite</p>
                <p className="font-bold text-sm">{costPerUnit.toFixed(2)} DH</p>
              </div>
              <div className="bg-white/70 rounded-lg p-3 text-center">
                <DollarSign size={16} className="mx-auto text-amber-500 mb-1" />
                <p className="text-xs text-gray-500">Marge</p>
                <p className={`font-bold text-sm ${margin >= 50 ? 'text-green-600' : margin >= 30 ? 'text-amber-600' : 'text-red-600'}`}>{margin.toFixed(1)}%</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <p className="text-gray-500 text-center py-8">Chargement de la recette...</p>
          ) : recipe ? (
            <>
              <div className="bg-blue-50 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-blue-800 mb-2">Calculateur de portions</h3>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-blue-700">Quantite souhaitee :</span>
                  <input type="number" min={1} value={targetPortions} onChange={(e) => setPortions(parseInt(e.target.value) || 1)} className="input w-24 text-center font-bold" />
                  <span className="text-sm text-blue-700">unites</span>
                  {portions !== null && portions !== yieldQty && (
                    <button onClick={() => setPortions(null)} className="text-xs text-blue-500 underline">Reinitialiser ({yieldQty})</button>
                  )}
                </div>
                {multiplier !== 1 && <p className="text-xs text-blue-600 mt-2">Les quantites sont multipliees par {multiplier.toFixed(2)}x</p>}
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Scale size={18} className="text-primary-600" /> Ingredients ({recipe.ingredients?.length || 0})
                </h3>
                {recipe.ingredients && recipe.ingredients.length > 0 ? (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Ingredient</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Quantite</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Unite</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Cout unit.</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Sous-total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {recipe.ingredients.map((ing, idx) => {
                          const qty = ing.quantity * multiplier;
                          const cost = qty * parseFloat(ing.unit_cost || '0');
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-sm font-medium">{ing.ingredient_name}</td>
                              <td className="px-4 py-2.5 text-sm text-right font-semibold text-primary-700">
                                {qty < 0.01 ? qty.toFixed(4) : qty < 1 ? qty.toFixed(3) : qty.toFixed(2)}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{ing.unit}</td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-500">{parseFloat(ing.unit_cost).toFixed(2)} DH</td>
                              <td className="px-4 py-2.5 text-sm text-right font-semibold">{cost.toFixed(2)} DH</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 font-bold">
                        <tr>
                          <td colSpan={4} className="px-4 py-2.5 text-sm text-right">Total</td>
                          <td className="px-4 py-2.5 text-sm text-right text-primary-600">{totalCost.toFixed(2)} DH</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">Aucun ingredient associe</p>
                )}
              </div>

              {recipe.instructions && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <BookOpen size={18} className="text-primary-600" /> Guide de production
                  </h3>
                  <div className="bg-amber-50 rounded-xl p-4 space-y-3">
                    {steps.map((step, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-sm font-bold">{idx + 1}</span>
                        <p className="text-sm text-amber-900 pt-1">{step.endsWith('.') ? step : `${step}.`}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-green-50 rounded-xl p-4">
                <h3 className="font-semibold text-sm text-green-800 mb-3">Resume de production</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-green-600">Quantite a produire</p><p className="font-bold text-lg text-green-800">{targetPortions} unites</p></div>
                  <div><p className="text-green-600">Cout total matieres</p><p className="font-bold text-lg text-green-800">{totalCost.toFixed(2)} DH</p></div>
                  <div><p className="text-green-600">Cout par unite</p><p className="font-bold text-lg text-green-800">{costPerUnit.toFixed(2)} DH</p></div>
                  <div><p className="text-green-600">Prix de vente</p><p className="font-bold text-lg text-green-800">{sellingPrice.toFixed(2)} DH</p></div>
                </div>
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

/* ============ FORM MODAL (CREATE / EDIT) ============ */

interface FormIngredient {
  ingredientId: string;
  quantity: string;
}

function RecipeFormModal({ recipeId, onClose, onSaved }: {
  recipeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!recipeId;

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

  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [instructions, setInstructions] = useState('');
  const [formIngredients, setFormIngredients] = useState<FormIngredient[]>([{ ingredientId: '', quantity: '' }]);

  // Initialize form when editing
  if (isEdit && existingRecipe && !initialized) {
    setName(existingRecipe.name);
    setProductId(existingRecipe.product_id);
    setYieldQuantity(String(existingRecipe.yield_quantity));
    setInstructions(existingRecipe.instructions || '');
    setFormIngredients(
      existingRecipe.ingredients.length > 0
        ? existingRecipe.ingredients.map(ing => ({
            ingredientId: ing.ingredient_id || '',
            quantity: String(ing.quantity),
          }))
        : [{ ingredientId: '', quantity: '' }]
    );
    setInitialized(true);
  }

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => recipesApi.create(data),
    onSuccess: () => { toast.success('Recette creee'); onSaved(); },
    onError: () => toast.error('Erreur lors de la creation'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => recipesApi.update(recipeId!, data),
    onSuccess: () => { toast.success('Recette mise a jour'); onSaved(); },
    onError: () => toast.error('Erreur lors de la mise a jour'),
  });

  const addIngredientRow = () => {
    setFormIngredients([...formIngredients, { ingredientId: '', quantity: '' }]);
  };

  const removeIngredientRow = (idx: number) => {
    if (formIngredients.length <= 1) return;
    setFormIngredients(formIngredients.filter((_, i) => i !== idx));
  };

  const updateIngredientRow = (idx: number, field: keyof FormIngredient, value: string) => {
    setFormIngredients(formIngredients.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };

  // Calculate live cost preview
  const liveCost = formIngredients.reduce((sum, row) => {
    if (!row.ingredientId || !row.quantity) return sum;
    const ing = allIngredients.find((i: Record<string, unknown>) => i.id === row.ingredientId);
    if (!ing) return sum;
    return sum + parseFloat(row.quantity) * parseFloat(ing.unit_cost || '0');
  }, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validIngredients = formIngredients
      .filter(row => row.ingredientId && row.quantity && parseFloat(row.quantity) > 0)
      .map(row => ({ ingredientId: row.ingredientId, quantity: parseFloat(row.quantity) }));

    if (validIngredients.length === 0) {
      toast.error('Ajoutez au moins un ingredient');
      return;
    }

    const data = {
      name,
      productId,
      yieldQuantity: parseInt(yieldQuantity) || 1,
      instructions,
      ingredients: validIngredients,
    };

    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Products without a recipe (+ current product if editing)
  const existingRecipeProductIds = new Set<string>();
  // We don't have this info easily, so we allow all products in the dropdown

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{isEdit ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={20} className="text-gray-500" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Name & Product */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nom de la recette</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Recette Croissant" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Produit associe</label>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">-- Choisir un produit --</option>
                {allProducts.map((p: Record<string, unknown>) => (
                  <option key={p.id as string} value={p.id as string}>{p.name as string}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Yield */}
          <div className="w-48">
            <label className="block text-sm font-medium mb-1">Rendement (unites produites)</label>
            <input type="number" min={1} className="input" value={yieldQuantity} onChange={(e) => setYieldQuantity(e.target.value)} required />
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-sm font-medium mb-1">Instructions de production</label>
            <textarea className="input" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder="Petrir farine, eau, sel, levure. Pointage 1h. Faconnage. Cuisson 250C 20min." />
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Scale size={18} className="text-primary-600" /> Ingredients
              </h3>
              <button type="button" onClick={addIngredientRow} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <PlusCircle size={16} /> Ajouter un ingredient
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_120px_80px_80px_40px] gap-2 text-xs font-medium text-gray-500 px-1">
                <span>Ingredient</span>
                <span>Quantite</span>
                <span>Unite</span>
                <span>Sous-total</span>
                <span></span>
              </div>
              {formIngredients.map((row, idx) => {
                const selectedIng = allIngredients.find((i: Record<string, unknown>) => i.id === row.ingredientId) as Record<string, unknown> | undefined;
                const rowCost = selectedIng && row.quantity ? parseFloat(row.quantity) * parseFloat(selectedIng.unit_cost as string || '0') : 0;
                return (
                  <div key={idx} className="grid grid-cols-[1fr_120px_80px_80px_40px] gap-2 items-center">
                    <select className="input text-sm py-1.5" value={row.ingredientId} onChange={(e) => updateIngredientRow(idx, 'ingredientId', e.target.value)}>
                      <option value="">-- Ingredient --</option>
                      {allIngredients.map((i: Record<string, unknown>) => (
                        <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                      ))}
                    </select>
                    <input type="number" step="0.0001" min="0" className="input text-sm py-1.5" value={row.quantity} onChange={(e) => updateIngredientRow(idx, 'quantity', e.target.value)} placeholder="0.00" />
                    <span className="text-sm text-gray-500 px-2">{selectedIng ? selectedIng.unit as string : '-'}</span>
                    <span className="text-sm font-semibold px-2">{rowCost > 0 ? `${rowCost.toFixed(2)} DH` : '-'}</span>
                    <button type="button" onClick={() => removeIngredientRow(idx)} className="p-1 hover:bg-red-50 rounded" disabled={formIngredients.length <= 1}>
                      <Trash2 size={14} className={formIngredients.length <= 1 ? 'text-gray-200' : 'text-red-400'} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Cost preview */}
            <div className="mt-3 pt-3 border-t flex justify-between items-center">
              <span className="text-sm text-gray-500">Cout total estime</span>
              <span className="font-bold text-primary-600">{liveCost.toFixed(2)} DH</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? 'Enregistrement...' : isEdit ? 'Mettre a jour' : 'Creer la recette'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
