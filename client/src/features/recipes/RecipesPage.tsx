import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { productsApi } from '../../api/products.api';
import { ingredientsApi } from '../../api/inventory.api';
import { packagingApi } from '../../api/packaging.api';
import { contenantsApi } from '../../api/contenants.api';
import { ChefHat, X, Search, Scale, BookOpen, DollarSign, ChevronRight, Plus, Pencil, Trash2, PlusCircle, Layers, History, Clock, Eye, TrendingUp, LayoutGrid, List, Filter, Package, Box, Weight, ArrowUp, ArrowDown, ArrowUpDown, ListChecks, GripVertical, Timer, ShieldCheck, Repeat } from 'lucide-react';
import { getModeCalcul, MODE_LABELS } from '@ofauria/shared';
import ContenantsPage from '../production/ContenantsPage';
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

interface RecipeEtape {
  ordre: number;
  nom: string;
  duree_estimee_min: number | null;
  est_bloquante: boolean;
  timer_auto: boolean;
  controle_qualite: boolean;
  checklist_items: string[];
  est_repetable: boolean;
  nb_repetitions: number;
  responsable_role: string | null;
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
  contenant_id: string | null;
  contenant_nom: string | null;
  contenant_type: number | null;
  contenant_quantite_theorique: string | null;
  contenant_pertes_fixes: string | null;
  contenant_unite_lancement: string | null;
  contenant_poids_kg: string | null;
  margin_multiplier?: number | string | null;
  packaging?: Record<string, unknown>[];
  etapes: RecipeEtape[];
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

/** Affiche une quantite avec max 3 decimales, sans zeros traînants.
 *  Ex: "600.0000" → "600", "1.0520" → "1.052", "0.1252" → "0.125". */
function trimZeros(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!isFinite(n)) return '';
  return String(parseFloat(n.toFixed(3)));
}

// Compatible units grouped by type
const COMPATIBLE_UNITS: Record<string, string[]> = {
  kg: ['kg', 'g'], g: ['kg', 'g'],
  l: ['l', 'ml'], ml: ['l', 'ml'],
  unit: ['unit'],
};

type ActiveTab = 'product' | 'base' | 'contenants';
type ViewMode = 'grid' | 'list';

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th onClick={() => onSort(sk)} style={{ textAlign: align }}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('contenants');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'total_cost' || key === 'cost_per_unit' || key === 'margin' || key === 'yield_quantity' ? 'desc' : 'asc'); }
  };

  const deleteMutation = useMutation({
    mutationFn: recipesApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recipes'] }); notify.success('Recette supprimee'); },
  });

  const filtered = recipes.filter((r: Record<string, any>) => {
    const s = search.toLowerCase();
    const matchSearch = !s || (r.name as string).toLowerCase().includes(s) || (r.product_name as string || '').toLowerCase().includes(s);
    const matchTab = activeTab === 'base' ? r.is_base === true : !r.is_base;
    return matchSearch && matchTab;
  });

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = ((a.name as string) || '').localeCompare((b.name as string) || ''); break;
        case 'is_base': cmp = (a.is_base === b.is_base ? 0 : a.is_base ? -1 : 1); break;
        case 'contenant_nom': cmp = ((a.contenant_nom as string) || '').localeCompare((b.contenant_nom as string) || ''); break;
        case 'yield_quantity': cmp = ((a.yield_quantity as number) || 0) - ((b.yield_quantity as number) || 0); break;
        case 'total_cost': cmp = parseFloat((a.total_cost as string) || '0') - parseFloat((b.total_cost as string) || '0'); break;
        case 'cost_per_unit': {
          const cA = parseFloat((a.total_cost as string) || '0') / ((a.yield_quantity as number) || 1);
          const cB = parseFloat((b.total_cost as string) || '0') / ((b.yield_quantity as number) || 1);
          cmp = cA - cB; break;
        }
        case 'margin': {
          const prA = parseFloat((a.product_price as string) || '0');
          const cpuA = parseFloat((a.total_cost as string) || '0') / ((a.yield_quantity as number) || 1);
          const mA = prA > 0 ? (prA - cpuA) / prA * 100 : 0;
          const prB = parseFloat((b.product_price as string) || '0');
          const cpuB = parseFloat((b.total_cost as string) || '0') / ((b.yield_quantity as number) || 1);
          const mB = prB > 0 ? (prB - cpuB) / prB * 100 : 0;
          cmp = mA - mB; break;
        }
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const baseCount = recipes.filter((r: Record<string, any>) => r.is_base === true).length;
  const productCount = recipes.filter((r: Record<string, any>) => !r.is_base).length;

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
    <div className="odoo-scope">
      {/* ══════ CONTROL BAR ══════ */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Recettes</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">
            {activeTab === 'contenants' ? 'Contenants'
              : activeTab === 'base' ? 'Préparations de base'
              : 'Recettes produits finis'}
          </span>
        </div>
        {activeTab !== 'contenants' && (
          <button onClick={openCreate} className="odoo-btn-primary">
            <Plus size={14} /> Nouveau
          </button>
        )}
        <div style={{ flex: 1 }} />
        {activeTab !== 'contenants' && (
          <span className="odoo-pager">
            <strong>{sortedFiltered.length}</strong> / {activeTab === 'base' ? baseCount : productCount}
          </span>
        )}
        {activeTab !== 'contenants' && (
          <div className="odoo-view-switcher">
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'active' : ''} title="Vue liste">
              <List size={14} />
            </button>
            <button onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? 'active' : ''} title="Vue kanban">
              <LayoutGrid size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ══════ TABS ══════ */}
      <div className="odoo-tabs">
        <button onClick={() => { setActiveTab('contenants'); setSearch(''); }}
          className={`odoo-tab ${activeTab === 'contenants' ? 'active' : ''}`}>
          <Package size={13} /> Contenants
        </button>
        <button onClick={() => { setActiveTab('base'); setSearch(''); }}
          className={`odoo-tab ${activeTab === 'base' ? 'active' : ''}`}>
          <Layers size={13} /> Préparations de base
          {baseCount > 0 && (
            <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>{baseCount}</span>
          )}
        </button>
        <button onClick={() => { setActiveTab('product'); setSearch(''); }}
          className={`odoo-tab ${activeTab === 'product' ? 'active' : ''}`}>
          <ChefHat size={13} /> Recettes produits finis
          {productCount > 0 && (
            <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>{productCount}</span>
          )}
        </button>
      </div>

      {activeTab === 'contenants' ? <div style={{ padding: '1rem' }}><ContenantsPage /></div> : <>
      {/* ══════ SEARCH PANEL ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text"
          placeholder={activeTab === 'base' ? 'Rechercher une préparation de base...' : 'Rechercher une recette ou un produit...'}
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="odoo-search-input" />
        {search && (
          <span className="odoo-filter-chip">
            Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
      </div>

      {/* ══════ CONTENT ══════ */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : viewMode === 'grid' ? (
        /* ═══ GRID View (kanban Odoo) ═══ */
        sortedFiltered.length === 0 ? (
          <div style={{ padding: '5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <BookOpen size={48} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>Aucune recette trouvée</p>
            <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Essayez de modifier vos filtres</p>
          </div>
        ) : (
        <div className="odoo-kanban">
          <div className="odoo-kanban-grid">
            {sortedFiltered.map((r: Record<string, any>) => {
              const totalCost = parseFloat(r.total_cost as string || '0');
              const yieldQty = r.yield_quantity as number || 1;
              const costPerUnit = totalCost / yieldQty;
              // Fallback : pas de produit lie → calcule prix attendu via margin_multiplier
              const productPrice = parseFloat(r.product_price as string || '0');
              const rMargin = parseFloat(String(r.margin_multiplier ?? '0'));
              const price = productPrice > 0 ? productPrice : (rMargin > 0 ? costPerUnit * rMargin : 0);
              const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;
              const cardStatus = !r.is_base && price > 0 ? (margin >= 50 ? 'ok' : margin >= 30 ? 'warning' : 'danger') : 'ok';

              return (
                <div key={r.id as string}
                  className={`odoo-kanban-card ${cardStatus}`}
                  onClick={() => setSelectedRecipeId(r.id as string)}>
                  <div className="odoo-kanban-card-title">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {r.is_base ? <Layers size={14} style={{ color: 'var(--theme-accent)' }} /> : <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />}
                      {r.name as string}
                    </span>
                    <span className={`odoo-tag ${r.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                      {r.is_base ? 'Base' : 'Produit'}
                    </span>
                  </div>
                  <div className="odoo-kanban-card-supplier">
                    {r.is_base ? 'Préparation de base' : (r.product_name as string || 'Aucun produit')}
                  </div>
                  <div className="odoo-kanban-card-stock">
                    <span className="odoo-kanban-card-stock-value" style={{ color: 'var(--theme-accent)' }}>
                      {totalCost.toFixed(2)}
                    </span>
                    <span className="odoo-kanban-card-stock-unit">DH coût total</span>
                  </div>
                  <div className="odoo-kanban-card-split">
                    <span>Rendement <strong>{yieldQty} {r.yield_unit as string || 'u.'}</strong></span>
                    <span style={{ color: 'var(--theme-bg-separator)' }}>·</span>
                    <span>Coût/u. <strong>{costPerUnit.toFixed(2)} DH</strong></span>
                  </div>
                  <div className="odoo-kanban-card-footer">
                    <span>
                      {r.contenant_nom && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--theme-text-muted)' }}>
                          <Box size={9} /> {r.contenant_nom as string}
                        </span>
                      )}
                    </span>
                    {!r.is_base && price > 0 && (
                      <span className={`odoo-tag ${margin >= 50 ? 'odoo-tag-green' : margin >= 30 ? 'odoo-tag-yellow' : 'odoo-tag-red'}`}>
                        Marge {margin.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )
      ) : (
        /* ═══ LIST View (table dense Odoo) ═══ */
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <SortHeader label="Recette" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" sortKey="is_base" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Contenant" sortKey="contenant_nom" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Rendement" sortKey="yield_quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Coût total" sortKey="total_cost" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Coût/u." sortKey="cost_per_unit" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Marge" sortKey="margin" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  Aucune recette trouvée
                </td></tr>
              ) : sortedFiltered.map((r: Record<string, any>) => {
                const totalCost = parseFloat(r.total_cost as string || '0');
                const yieldQty = r.yield_quantity as number || 1;
                const costPerUnit = totalCost / yieldQty;
                // Fallback : pas de produit lie → prix attendu via margin_multiplier
                const productPrice = parseFloat(r.product_price as string || '0');
                const rMargin = parseFloat(String(r.margin_multiplier ?? '0'));
                const price = productPrice > 0 ? productPrice : (rMargin > 0 ? costPerUnit * rMargin : 0);
                const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;
                const dotClass = !r.is_base && price > 0
                  ? (margin >= 50 ? 'ok' : margin >= 30 ? 'warning' : 'danger')
                  : 'neutral';

                return (
                  <tr key={r.id as string} onClick={() => setSelectedRecipeId(r.id as string)}>
                    <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        {r.is_base ? <Layers size={13} style={{ color: 'var(--theme-accent)' }} /> : <ChefHat size={13} style={{ color: 'var(--theme-accent)' }} />}
                        {r.name as string}
                      </span>
                    </td>
                    <td>
                      <span className={`odoo-tag ${r.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                        {r.is_base ? 'Base' : 'Produit'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      {r.contenant_nom ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Box size={11} /> {r.contenant_nom as string}
                        </span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 500 }}>{yieldQty}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{r.yield_unit as string || 'u.'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 600 }}>{totalCost.toFixed(2)}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 500 }}>{costPerUnit.toFixed(2)}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!r.is_base && price > 0 ? (
                        <span className={`odoo-tag ${margin >= 50 ? 'odoo-tag-green' : margin >= 30 ? 'odoo-tag-yellow' : 'odoo-tag-red'}`}>
                          {margin.toFixed(0)}%
                        </span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        <button onClick={() => setSelectedRecipeId(r.id as string)}
                          className="odoo-pager-btn" title="Voir">
                          <Eye size={13} />
                        </button>
                        <button onClick={() => openEdit(r.id as string)}
                          className="odoo-pager-btn" title="Modifier">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => { if (confirm('Supprimer cette recette ?')) deleteMutation.mutate(r.id as string); }}
                          className="odoo-pager-btn" title="Supprimer"
                          style={{ color: '#dc3545' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          defaultIsBase={activeTab === 'base'}
          onClose={() => { setShowForm(false); setEditingRecipeId(null); }}
          onSaved={() => {
            setShowForm(false);
            setEditingRecipeId(null);
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
          }}
        />
      )}
      </>}
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
    // Conversion d'unite : le unit_cost est en DH/{ingredient_base_unit}.
    // Si la recette utilise une autre unite compatible (ex: ing.unit='g' alors
    // que le cout est par kg), il faut convertir pour ne pas multiplier des
    // grammes par un prix en DH/kg.
    const factor = unitConversionFactor(ing.unit || ing.ingredient_base_unit, ing.ingredient_base_unit);
    return sum + (ing.quantity * factor * multiplier * parseFloat(ing.unit_cost || '0'));
  }, 0) || 0;

  const subRecipeCost = recipe?.sub_recipes?.reduce((sum, sr) => {
    const costPerUnit = parseFloat(sr.sub_total_cost || '0') / (sr.sub_yield_quantity || 1);
    return sum + costPerUnit * sr.quantity * multiplier;
  }, 0) || 0;

  const totalCost = ingredientCost + subRecipeCost;
  const costPerUnit = targetPortions > 0 ? totalCost / targetPortions : 0;
  // Prix de vente : priorite au product.price (defini), sinon fallback sur
  // costPerUnit * margin_multiplier (cas des recettes sans produit lie comme OFAURIA).
  const productPrice = parseFloat(recipe?.product_price || '0');
  const recipeMargin = parseFloat(String(recipe?.margin_multiplier ?? '0'));
  const sellingPrice = productPrice > 0
    ? productPrice
    : (recipeMargin > 0 ? costPerUnit * recipeMargin : 0);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        {/* Control bar (header with breadcrumb + actions) */}
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            {recipe?.is_base ? <Layers size={14} style={{ color: 'var(--theme-accent)' }} /> : <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />}
            <span>{recipe?.is_base ? 'Préparation de base' : 'Recette produit fini'}</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">{recipe?.name || 'Chargement...'}</span>
          </div>
          <button onClick={onEdit} className="odoo-btn-secondary">
            <Pencil size={13} /> Modifier
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        {/* Smart buttons row (KPI tiles Odoo) */}
        {recipe && (
          <div className="odoo-smart-button-row">
            <div className="odoo-smart-button">
              <div className="odoo-smart-button-value">{yieldQty}</div>
              <div className="odoo-smart-button-label"><Scale size={11} /> Rendement ({recipe.yield_unit || 'u.'})</div>
            </div>
            <div className="odoo-smart-button">
              <div className="odoo-smart-button-value">{totalCost.toFixed(2)}</div>
              <div className="odoo-smart-button-label"><DollarSign size={11} /> Coût total (DH)</div>
            </div>
            <div className="odoo-smart-button">
              <div className="odoo-smart-button-value">{costPerUnit.toFixed(2)}</div>
              <div className="odoo-smart-button-label">
                <DollarSign size={11} /> {recipe.contenant_unite_lancement ? MODE_LABELS[getModeCalcul(recipe.contenant_unite_lancement)].coutUnitaire : 'Coût/unité'}
              </div>
            </div>
            {!recipe.is_base && (
              <div className="odoo-smart-button">
                <div className="odoo-smart-button-value" style={{
                  color: margin >= 50 ? '#28a745' : margin >= 30 ? '#b85d1a' : '#dc3545',
                }}>
                  {margin.toFixed(1)}%
                </div>
                <div className="odoo-smart-button-label"><TrendingUp size={11} /> Marge</div>
              </div>
            )}
          </div>
        )}

        {/* Form header (title + status tags + contenant) */}
        {recipe && (
          <div className="odoo-form-header">
            <h1 className="odoo-form-title">{recipe.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 6, flexWrap: 'wrap' }}>
              <span className={`odoo-tag ${recipe.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                {recipe.is_base ? 'Base' : 'Produit'}
              </span>
              {recipe.product_name && !recipe.is_base && (
                <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{recipe.product_name}</span>
              )}
              {recipe.contenant_nom && (() => {
                const cMode = getModeCalcul(recipe.contenant_unite_lancement || 'unit');
                const cLabels = MODE_LABELS[cMode];
                const qteTheo = parseFloat(recipe.contenant_quantite_theorique || '0');
                const pertes = parseFloat(recipe.contenant_pertes_fixes || '0');
                const net = qteTheo - pertes;
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginLeft: 4 }}>
                    <Box size={12} />
                    <strong style={{ color: 'var(--theme-text-strong)' }}>{recipe.contenant_nom}</strong>
                    <span className={`odoo-tag ${cMode === 'poids' ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>{cMode === 'poids' ? 'POIDS' : 'PIÈCES'}</span>
                    <span>· {cLabels.quantiteTheorique}: <strong>{qteTheo}</strong></span>
                    {pertes > 0 && <span>· {cLabels.pertesFixes}: <strong style={{ color: '#dc3545' }}>-{pertes}</strong></span>}
                    <span>· {cLabels.netCible}: <strong style={{ color: '#28a745' }}>{net}</strong></span>
                    {cMode === 'pieces' && recipe.contenant_poids_kg && <span>· Poids: <strong>{recipe.contenant_poids_kg} kg</strong></span>}
                  </span>
                );
              })()}
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--theme-bg-page)' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
              <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : recipe ? (
            <>
              {/* Portions calculator */}
              <div className="odoo-section">
                <div className="odoo-section-header"><Scale size={12} /> Calculateur de portions</div>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', backgroundColor: 'var(--theme-bg-card)' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Quantité souhaitée :</span>
                  <input type="number" min={0.1} step="0.1" value={targetPortions} onChange={(e) => setPortions(parseFloat(e.target.value) || 1)}
                    className="input" style={{ width: 100, textAlign: 'center', fontWeight: 600 }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{recipe.yield_unit || 'unités'}</span>
                  {portions !== null && portions !== yieldQty && (
                    <button onClick={() => setPortions(null)} className="odoo-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                      Réinitialiser ({yieldQty})
                    </button>
                  )}
                  {multiplier !== 1 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--theme-accent)', fontWeight: 500 }}>
                      Quantités × <strong>{multiplier.toFixed(2)}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Sub-recipes */}
              {recipe.sub_recipes && recipe.sub_recipes.length > 0 && (
                <div className="odoo-section">
                  <div className="odoo-section-header">
                    <Layers size={12} /> Préparations de base ({recipe.sub_recipes.length})
                  </div>
                  <table className="odoo-table">
                    <thead>
                      <tr>
                        <th>Préparation</th>
                        <th style={{ textAlign: 'right' }}>Quantité</th>
                        <th style={{ textAlign: 'right' }}>Rendement</th>
                        <th style={{ textAlign: 'right' }}>Coût unit.</th>
                        <th style={{ textAlign: 'right' }}>Sous-total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.sub_recipes.map((sr, idx) => {
                        const costPerU = parseFloat(sr.sub_total_cost || '0') / (sr.sub_yield_quantity || 1);
                        const qty = sr.quantity * multiplier;
                        const cost = costPerU * qty;
                        return (
                          <tr key={idx} style={{ cursor: 'default' }}>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Layers size={11} style={{ color: 'var(--theme-accent)' }} />
                                <strong>{sr.sub_recipe_name}</strong>
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--theme-accent)' }}>{qty.toFixed(2)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{sr.sub_yield_quantity} {sr.sub_yield_unit || 'u.'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{costPerU.toFixed(2)} DH</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{cost.toFixed(2)} DH</td>
                          </tr>
                        );
                      })}
                      <tr style={{ backgroundColor: 'var(--theme-bg-page)', fontWeight: 700, cursor: 'default' }}>
                        <td colSpan={4} style={{ textAlign: 'right' }}>Sous-total préparations</td>
                        <td style={{ textAlign: 'right', color: 'var(--theme-accent)' }}>{subRecipeCost.toFixed(2)} DH</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Ingredients */}
              <div className="odoo-section">
                <div className="odoo-section-header">
                  <Scale size={12} /> Ingrédients ({recipe.ingredients?.length || 0})
                </div>
                {recipe.ingredients && recipe.ingredients.length > 0 ? (
                  <table className="odoo-table">
                    <thead>
                      <tr>
                        <th>Ingrédient</th>
                        <th style={{ textAlign: 'right' }}>Quantité</th>
                        <th style={{ textAlign: 'right' }}>Unité</th>
                        <th style={{ textAlign: 'right' }}>Coût unit.</th>
                        <th style={{ textAlign: 'right' }}>Sous-total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.ingredients.map((ing, idx) => {
                        const qty = ing.quantity * multiplier;
                        const factor = unitConversionFactor(ing.unit || ing.ingredient_base_unit, ing.ingredient_base_unit);
                        const cost = qty * factor * parseFloat(ing.unit_cost || '0');
                        return (
                          <tr key={idx} style={{ cursor: 'default' }}>
                            <td><strong>{ing.ingredient_name}</strong></td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--theme-accent)' }}>
                              {qty < 0.01 ? qty.toFixed(4) : qty < 1 ? qty.toFixed(3) : qty.toFixed(2)}
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{ing.unit}</td>
                            <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>
                              {parseFloat(ing.unit_cost).toFixed(2)} DH/{ing.ingredient_base_unit}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{cost.toFixed(2)} DH</td>
                          </tr>
                        );
                      })}
                      <tr style={{ backgroundColor: 'var(--theme-bg-page)', fontWeight: 700, cursor: 'default' }}>
                        <td colSpan={4} style={{ textAlign: 'right' }}>Sous-total ingrédients</td>
                        <td style={{ textAlign: 'right', color: 'var(--theme-accent)' }}>{ingredientCost.toFixed(2)} DH</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p style={{ padding: '1rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                    Aucun ingrédient associé
                  </p>
                )}
              </div>

              {/* Total cost combined */}
              {recipe.sub_recipes && recipe.sub_recipes.length > 0 && recipe.ingredients && recipe.ingredients.length > 0 && (
                <div className="odoo-section">
                  <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--theme-bg-card)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--theme-text-strong)' }}>Coût total (préparations + ingrédients)</span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--theme-accent)' }}>{totalCost.toFixed(2)} DH</span>
                  </div>
                </div>
              )}

              {/* Instructions */}
              {recipe.instructions && (
                <div className="odoo-section">
                  <div className="odoo-section-header"><BookOpen size={12} /> Guide de production</div>
                  <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-card)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {steps.map((step, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                        <span style={{
                          flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                          backgroundColor: 'var(--theme-accent-light)', color: 'var(--theme-accent)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700,
                        }}>{idx + 1}</span>
                        <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-strong)', paddingTop: 2 }}>
                          {step.endsWith('.') ? step : `${step}.`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Étapes de production */}
              {recipe.etapes && recipe.etapes.length > 0 && (
                <div className="odoo-section">
                  <div className="odoo-section-header"><ListChecks size={12} /> Étapes de production ({recipe.etapes.length})</div>
                  <div>
                    {recipe.etapes.sort((a, b) => a.ordre - b.ordre).map((etape, idx) => (
                      <div key={idx} style={{
                        padding: '0.625rem 1rem', borderTop: idx > 0 ? '1px solid var(--theme-bg-separator)' : 'none',
                        display: 'flex', gap: '0.625rem', alignItems: 'flex-start', backgroundColor: 'var(--theme-bg-card)',
                      }}>
                        <span style={{
                          flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                          backgroundColor: 'var(--theme-accent-light)', color: 'var(--theme-accent)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.8125rem', fontWeight: 700,
                        }}>{etape.ordre}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '0.8125rem' }}>{etape.nom}</strong>
                            {etape.est_bloquante && <span className="odoo-tag odoo-tag-red">BLOQUANTE</span>}
                            {etape.timer_auto && <span className="odoo-tag odoo-tag-blue"><Timer size={9} /> AUTO</span>}
                            {etape.controle_qualite && <span className="odoo-tag odoo-tag-green"><ShieldCheck size={9} /> QC</span>}
                            {etape.est_repetable && <span className="odoo-tag odoo-tag-purple"><Repeat size={9} /> x{etape.nb_repetitions}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem', marginTop: 4, fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                            {etape.duree_estimee_min && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={10} /> {etape.duree_estimee_min} min</span>
                            )}
                            {etape.responsable_role && <span>Rôle : {etape.responsable_role}</span>}
                          </div>
                          {etape.checklist_items && etape.checklist_items.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {etape.checklist_items.map((item, ci) => (
                                <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                                  <div style={{ width: 12, height: 12, borderRadius: 2, border: '1px solid var(--theme-bg-separator)', flexShrink: 0 }} />
                                  {item}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Production summary */}
              <div className="odoo-section">
                <div className="odoo-section-header">Résumé de production</div>
                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-card)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>Quantité à produire</div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 2 }}>{targetPortions} u.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>Coût total matières</div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 2 }}>{totalCost.toFixed(2)} DH</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>Coût par unité</div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 2 }}>{costPerUnit.toFixed(2)} DH</div>
                  </div>
                  {!recipe.is_base && (
                    <div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>Prix de vente</div>
                      <div style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 2 }}>{sellingPrice.toFixed(2)} DH</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Version history */}
              <div className="odoo-section">
                <button onClick={() => setShowVersions(!showVersions)}
                  className="odoo-section-header"
                  style={{ width: '100%', cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                  <History size={12} /> Historique des modifications ({versions.length})
                  <ChevronRight size={12} style={{ marginLeft: 'auto', transform: showVersions ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {showVersions && (
                  versions.length > 0 ? (
                    <div>
                      {versions.map((v, idx) => (
                        <div key={v.id} style={{
                          padding: '0.625rem 1rem', borderTop: idx > 0 ? '1px solid var(--theme-bg-separator)' : 'none',
                          fontSize: '0.75rem', backgroundColor: 'var(--theme-bg-card)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <strong>Version {v.version_number}</strong>
                            <span style={{ color: 'var(--theme-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Clock size={10} />
                              {new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ color: 'var(--theme-text-muted)' }}>
                            <div>Nom : {v.name} · Rendement : {v.yield_quantity} · Coût : {parseFloat(v.total_cost || '0').toFixed(2)} DH</div>
                            <div>{(v.ingredients as unknown[]).length} ingrédient(s), {(v.sub_recipes as unknown[]).length} sous-recette(s)</div>
                            {v.changed_by_name && <div>Par : {v.changed_by_name}</div>}
                            {v.change_note && <div style={{ fontStyle: 'italic' }}>Note : {v.change_note}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-card)', fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>
                      Aucune modification enregistrée
                    </p>
                  )
                )}
              </div>
            </>
          ) : (
            <p style={{ padding: '2rem', textAlign: 'center', color: '#dc3545' }}>Recette introuvable</p>
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

interface FormEtape {
  ordre: number;
  nom: string;
  duree_estimee_min: string;
  est_bloquante: boolean;
  timer_auto: boolean;
  controle_qualite: boolean;
  checklist_items: string[];
  est_repetable: boolean;
  nb_repetitions: string;
  responsable_role: string;
}

type FormTab = 'info' | 'composition' | 'etapes' | 'instructions';

/**
 * Champ de selection avec recherche automatique.
 * Remplace les <select> natifs pour faciliter la saisie quand la liste est longue.
 * - Clic/focus : ouvre le menu avec input de recherche auto-focus
 * - Tape pour filtrer (insensible a la casse et aux accents)
 * - Fleches haut/bas : navigation ; Entree : selection ; Echap : fermeture
 * - Clic exterieur : fermeture
 */
function SearchableSelect({
  items, value, onChange, placeholder = '-- Choisir --', renderHint, className = '',
}: {
  items: Record<string, any>[];
  value: string;
  onChange: (id: string, item?: Record<string, any>) => void;
  placeholder?: string;
  renderHint?: (item: Record<string, any>) => string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = items.find(i => i.id === value);

  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = normalize(query);
    return items.filter(i => normalize(String(i.name || '')).includes(q));
  }, [items, query]);

  // Compute popup position relative to button, with flip-up when near bottom.
  const recomputePosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popupHeight = 320; // max popup height (approx)
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < popupHeight && rect.top > popupHeight;
    const width = Math.max(rect.width, 320);
    setPopupStyle({
      position: 'fixed',
      left: rect.left,
      width,
      top: flipUp ? undefined : rect.bottom + 4,
      bottom: flipUp ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: popupHeight,
      zIndex: 100,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recomputePosition();
    const onResize = () => recomputePosition();
    const onScroll = () => recomputePosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true); // capture: catch modal scroll too
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => { setHighlight(0); }, [query]);

  // Keep highlighted item in view when navigating with keyboard
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pick = (item: Record<string, any>) => {
    onChange(item.id as string, item);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  const popup = open ? (
    <div ref={popupRef} style={popupStyle}
      className="bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col overflow-hidden">
      <div className="p-2 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Rechercher..." autoComplete="off"
            className="w-full pl-8 pr-2 py-1.5 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-gray-400">Aucun resultat</div>
        ) : filtered.map((item, i) => {
          const hint = renderHint ? renderHint(item) : null;
          const isActive = i === highlight;
          const isSelected = item.id === value;
          return (
            <button key={item.id as string} type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(item)}
              className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 text-sm transition-colors ${
                isActive ? 'bg-amber-50' : 'bg-white'
              } ${isSelected ? 'font-semibold text-amber-700' : 'text-gray-800'}`}>
              <span className="truncate flex-1">{item.name as string}</span>
              {hint && <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">{hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button ref={buttonRef} type="button" onClick={() => setOpen(o => !o)}
        className={`w-full px-3 py-2 bg-gray-50 border rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-amber-500 flex items-center justify-between gap-2 ${
          open ? 'border-amber-400 ring-2 ring-amber-500' : 'border-gray-200 hover:border-gray-300'
        }`}>
        <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
          {selected ? (selected.name as string) : placeholder}
        </span>
        <ChevronRight size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {popup && createPortal(popup, document.body)}
    </div>
  );
}

function RecipeFormModal({ recipeId, onClose, onSaved, defaultIsBase = false }: {
  recipeId: string | null;
  onClose: () => void;
  onSaved: () => void;
  defaultIsBase?: boolean;
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

  // Catalogue emballages — modele dedie, separe des ingredients (pas de DLC, pas de FEFO).
  const { data: allPackaging = [] } = useQuery({
    queryKey: ['packaging-items-list'],
    queryFn: () => packagingApi.list(),
  });

  const { data: baseRecipes = [] } = useQuery({
    queryKey: ['base-recipes'],
    queryFn: recipesApi.listBase,
  });

  const { data: allContenants = [] } = useQuery({
    queryKey: ['contenants-active'],
    queryFn: () => contenantsApi.list().then((r: Record<string, any>) => (r.data || r) as Record<string, any>[]),
  });

  const { entries: yieldUnits } = useReferentiel('yield_units');

  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [contenantId, setContenantId] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [yieldUnit, setYieldUnit] = useState('unit');
  const [marginMultiplier, setMarginMultiplier] = useState('3');
  const [salePrice, setSalePrice] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isBase, setIsBase] = useState(defaultIsBase);
  const [formIngredients, setFormIngredients] = useState<FormIngredient[]>([{ ingredientId: '', quantity: '', unit: '' }]);
  // Phase Emballages : state separe pointant vers packaging_items
  const [formPackaging, setFormPackaging] = useState<{ packagingId: string; quantity: string; unit: string }[]>([]);
  const [formSubRecipes, setFormSubRecipes] = useState<FormSubRecipe[]>([]);
  const [formEtapes, setFormEtapes] = useState<FormEtape[]>([]);

  if (isEdit && existingRecipe && !initialized) {
    setName(existingRecipe.name);
    setProductId(existingRecipe.product_id || '');
    setContenantId(existingRecipe.contenant_id || '');
    setYieldQuantity(String(existingRecipe.yield_quantity));
    setYieldUnit(existingRecipe.yield_unit || 'unit');
    // Normalise a 2 decimales pour eviter "3.0400" stocke en NUMERIC SQL.
    setMarginMultiplier(parseFloat(String(existingRecipe.margin_multiplier ?? 3)).toFixed(2));
    setSalePrice(existingRecipe.product_price ? parseFloat(String(existingRecipe.product_price)).toFixed(2) : '');
    setInstructions(existingRecipe.instructions || '');
    setIsBase(existingRecipe.is_base || false);
    setFormIngredients(
      existingRecipe.ingredients.length > 0
        ? existingRecipe.ingredients.map(ing => ({ ingredientId: ing.ingredient_id || '', quantity: trimZeros(ing.quantity), unit: ing.unit || '' }))
        : [{ ingredientId: '', quantity: '', unit: '' }]
    );
    setFormSubRecipes(
      existingRecipe.sub_recipes && existingRecipe.sub_recipes.length > 0
        ? existingRecipe.sub_recipes.map(sr => ({ subRecipeId: sr.sub_recipe_id, quantity: trimZeros(sr.quantity) }))
        : []
    );
    setFormPackaging(
      Array.isArray((existingRecipe as Record<string, any>).packaging) && ((existingRecipe as Record<string, any>).packaging as Record<string, any>[]).length > 0
        ? ((existingRecipe as Record<string, any>).packaging as Record<string, any>[]).map(p => ({
            packagingId: p.packaging_id as string,
            quantity: trimZeros(p.quantity as string | number),
            unit: (p.unit as string) || (p.base_unit as string) || 'piece',
          }))
        : []
    );
    setFormEtapes(
      existingRecipe.etapes && existingRecipe.etapes.length > 0
        ? existingRecipe.etapes.map(e => ({
            ordre: e.ordre, nom: e.nom, duree_estimee_min: e.duree_estimee_min ? String(e.duree_estimee_min) : '',
            est_bloquante: e.est_bloquante, timer_auto: e.timer_auto, controle_qualite: e.controle_qualite,
            checklist_items: e.checklist_items || [], est_repetable: e.est_repetable,
            nb_repetitions: String(e.nb_repetitions || 1), responsable_role: e.responsable_role || '',
          }))
        : []
    );
    setInitialized(true);
  }

  const extractError = (err: unknown): string => {
    const e = err as { response?: { data?: { error?: { message?: string; details?: Record<string, string[]> } } }; message?: string };
    const details = e?.response?.data?.error?.details;
    if (details) {
      const first = Object.entries(details)[0];
      if (first) return `${first[0]}: ${first[1].join(', ')}`;
    }
    return e?.response?.data?.error?.message || e?.message || 'Erreur inconnue';
  };

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => recipesApi.create(data),
    onSuccess: () => { notify.success('Recette creee'); onSaved(); },
    onError: (err) => notify.error(`Erreur lors de la creation : ${extractError(err)}`),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => recipesApi.update(recipeId!, data),
    onSuccess: () => { notify.success('Recette mise a jour'); onSaved(); },
    onError: (err) => notify.error(`Erreur lors de la mise a jour : ${extractError(err)}`),
  });

  const addIngredientRow = () => setFormIngredients([...formIngredients, { ingredientId: '', quantity: '', unit: '' }]);
  const removeIngredientRow = (idx: number) => { if (formIngredients.length <= 1) return; setFormIngredients(formIngredients.filter((_, i) => i !== idx)); };
  const updateIngredientRow = (idx: number, field: keyof FormIngredient, value: string) => setFormIngredients(formIngredients.map((row, i) => i === idx ? { ...row, [field]: value } : row));

  const addSubRecipeRow = () => setFormSubRecipes([...formSubRecipes, { subRecipeId: '', quantity: '' }]);
  const removeSubRecipeRow = (idx: number) => setFormSubRecipes(formSubRecipes.filter((_, i) => i !== idx));
  const updateSubRecipeRow = (idx: number, field: keyof FormSubRecipe, value: string) => setFormSubRecipes(formSubRecipes.map((row, i) => i === idx ? { ...row, [field]: value } : row));

  const addEtapeRow = () => setFormEtapes([...formEtapes, {
    ordre: formEtapes.length + 1, nom: '', duree_estimee_min: '', est_bloquante: true,
    timer_auto: false, controle_qualite: false, checklist_items: [], est_repetable: false,
    nb_repetitions: '1', responsable_role: '',
  }]);
  const removeEtapeRow = (idx: number) => {
    const updated = formEtapes.filter((_, i) => i !== idx).map((e, i) => ({ ...e, ordre: i + 1 }));
    setFormEtapes(updated);
  };
  const updateEtapeRow = (idx: number, field: string, value: unknown) => setFormEtapes(formEtapes.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  const moveEtape = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= formEtapes.length) return;
    const arr = [...formEtapes];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setFormEtapes(arr.map((e, i) => ({ ...e, ordre: i + 1 })));
  };

  const availableBaseRecipes = baseRecipes.filter((br: Record<string, any>) => br.id !== recipeId);

  // Cout des ingredients alimentaires (formIngredients pointe sur ingredients table)
  const computeIngRowCost = (row: FormIngredient): number => {
    if (!row.ingredientId || !row.quantity) return 0;
    const ing = allIngredients.find((i: Record<string, any>) => i.id === row.ingredientId);
    if (!ing) return 0;
    const ingBaseUnit = ing.unit as string || 'unit';
    const recipeUnit = row.unit || ingBaseUnit;
    const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
    return parseFloat(row.quantity) * parseFloat(ing.unit_cost as string || '0') * factor;
  };
  const ingredientCost = formIngredients.reduce((sum, row) => sum + computeIngRowCost(row), 0);
  const foodCost = ingredientCost;  // Tous les ingredients sont alimentaires maintenant (les emballages sont separes)

  // Cout emballages (formPackaging pointe sur packaging_items table)
  const computePkgRowCost = (row: { packagingId: string; quantity: string }): number => {
    if (!row.packagingId || !row.quantity) return 0;
    const pkg = (allPackaging as Record<string, any>[]).find(p => p.id === row.packagingId);
    if (!pkg) return 0;
    return parseFloat(row.quantity) * parseFloat(pkg.unit_cost as string || '0');
  };
  const packagingCost = formPackaging.reduce((sum, row) => sum + computePkgRowCost(row), 0);

  const subRecipeCost = formSubRecipes.reduce((sum, row) => {
    if (!row.subRecipeId || !row.quantity) return sum;
    const sr = baseRecipes.find((r: Record<string, any>) => r.id === row.subRecipeId);
    if (!sr) return sum;
    const costPerUnit = parseFloat(sr.total_cost || '0') / (parseFloat(sr.yield_quantity as string) || 1);
    return sum + costPerUnit * parseFloat(row.quantity);
  }, 0);

  const liveCost = ingredientCost + subRecipeCost + packagingCost;

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

    const validEtapes = formEtapes
      .filter(e => e.nom.trim())
      .map(e => ({
        ordre: e.ordre,
        nom: e.nom.trim(),
        duree_estimee_min: e.duree_estimee_min ? parseFloat(e.duree_estimee_min) : null,
        est_bloquante: e.est_bloquante,
        timer_auto: e.timer_auto,
        controle_qualite: e.controle_qualite,
        checklist_items: e.checklist_items.filter(c => c.trim()),
        est_repetable: e.est_repetable,
        nb_repetitions: parseInt(e.nb_repetitions) || 1,
        responsable_role: e.responsable_role || null,
      }));

    // Packaging valides : on filtre les lignes vides
    const validPackaging = formPackaging
      .filter(row => row.packagingId && row.quantity && parseFloat(row.quantity) > 0)
      .map(row => ({ packagingId: row.packagingId, quantity: parseFloat(row.quantity), unit: row.unit || 'piece' }));

    const data: Record<string, any> = {
      name,
      productId: isBase ? null : (productId || null),
      contenantId: contenantId || null,
      yieldQuantity: parseFloat(yieldQuantity) || 1,
      yieldUnit,
      marginMultiplier: parseFloat(marginMultiplier) || 3,
      instructions,
      isBase,
      etapes: validEtapes,
      ingredients: validIngredients,
      subRecipes: validSubRecipes,
      packaging: validPackaging,
    };

    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const tabs: { key: FormTab; label: string; icon: React.ReactNode }[] = [
    { key: 'info', label: 'Informations', icon: <ChefHat size={16} /> },
    { key: 'composition', label: 'Composition', icon: <Scale size={16} /> },
    { key: 'etapes', label: `Etapes${formEtapes.length > 0 ? ` (${formEtapes.length})` : ''}`, icon: <ListChecks size={16} /> },
    { key: 'instructions', label: 'Instructions', icon: <BookOpen size={16} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 880, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        {/* Control bar */}
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            {isBase ? <Layers size={14} style={{ color: 'var(--theme-accent)' }} /> : <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />}
            <span>{isBase ? 'Préparation de base' : 'Recette'}</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">
              {isEdit ? (name || 'Modifier') : (defaultIsBase ? 'Nouvelle préparation' : 'Nouvelle recette')}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div className="odoo-tabs">
          {tabs.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`odoo-tab ${activeTab === tab.key ? 'active' : ''}`}>
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
                {/* Base toggle — hidden when defaultIsBase forces base mode */}
                {defaultIsBase ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                        <Layers size={18} className="text-amber-600" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-amber-800">Preparation de base</span>
                        <p className="text-xs text-amber-600">Reutilisable dans d'autres recettes (pate, creme...)</p>
                      </div>
                    </div>
                  </div>
                ) : (
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
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isBase ? 'Nom de la preparation' : 'Nom de la recette'}</label>
                  <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white font-medium"
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder={isBase ? 'ex: Pate a croissant' : 'ex: Recette Croissant'} required />
                </div>

                {/* Produit associe — visible uniquement en edition */}
                {isEdit && !isBase && productId && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Produit associe</label>
                    <div className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
                      {allProducts.find((p: Record<string, any>) => p.id === productId)?.name as string || productId}
                    </div>
                  </div>
                )}

                {/* Contenant — optionnel (baguettes/pieces unitaires n'en ont pas) */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    <span className="flex items-center gap-2">
                      <Box size={15} className="text-blue-500" />
                      Contenant
                      <span className="text-xs font-normal text-gray-400">(optionnel)</span>
                    </span>
                  </label>
                  <select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium"
                    value={contenantId} onChange={(e) => {
                      const cId = e.target.value;
                      setContenantId(cId);
                      if (cId) {
                        const ct = allContenants.find((c: Record<string, any>) => c.id === cId) as Record<string, any> | undefined;
                        if (ct) {
                          const qteTheo = parseFloat(ct.quantite_theorique as string || '0');
                          const pertes = parseFloat(ct.pertes_fixes as string || '0');
                          const net = qteTheo - pertes;
                          setYieldQuantity(String(net > 0 ? net : qteTheo));
                          setYieldUnit(ct.unite_lancement as string || 'unit');
                        }
                      }
                    }}>
                    <option value="">— Aucun contenant (produit unitaire) —</option>
                    {allContenants.map((c: Record<string, any>) => {
                      const cMode = getModeCalcul(c.unite_lancement as string || 'unit');
                      const cLabels = MODE_LABELS[cMode];
                      return (
                        <option key={c.id as string} value={c.id as string}>
                          [{cMode === 'poids' ? 'KG' : 'PCS'}] {c.nom as string} — {c.quantite_theorique as string} {cLabels.uniteRendement}{cMode === 'pieces' && c.poids_kg ? ` (${c.poids_kg} kg)` : ''} (pertes: {c.pertes_fixes as string})
                        </option>
                      );
                    })}
                  </select>
                  {contenantId && (() => {
                    const ct = allContenants.find((c: Record<string, any>) => c.id === contenantId) as Record<string, any> | undefined;
                    if (!ct) return null;
                    const qteTheo = parseFloat(ct.quantite_theorique as string || '0');
                    const pertes = parseFloat(ct.pertes_fixes as string || '0');
                    const net = qteTheo - pertes;
                    const ctMode = getModeCalcul(ct.unite_lancement as string || 'unit');
                    const ctLabels = MODE_LABELS[ctMode];
                    return (
                      <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                ctMode === 'poids' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                              }`}>{ctMode === 'poids' ? 'POIDS' : 'PIECES'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <div className="text-center">
                                <span className="block text-blue-400">{ctLabels.quantiteTheorique}</span>
                                <span className="font-bold text-blue-700">{qteTheo}</span>
                              </div>
                              <div className="text-center">
                                <span className="block text-blue-400">{ctLabels.pertesFixes}</span>
                                <span className="font-bold text-red-500">-{pertes}</span>
                              </div>
                              <div className="text-center">
                                <span className="block text-blue-400">{ctLabels.netCible}</span>
                                <span className="font-bold text-green-600">{net} {ctLabels.uniteRendement}</span>
                              </div>
                              {ctMode === 'pieces' && ct.poids_kg && (
                                <div className="text-center">
                                  <span className="block text-blue-400">Poids matiere</span>
                                  <span className="font-bold text-blue-700">{ct.poids_kg as string} kg</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                  })()}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Rendement</label>
                  <div className="flex gap-2">
                    <input type="number" min={0.001} step="any"
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
                  <p className="text-xs text-gray-400 mt-1">{contenantId ? 'Pre-rempli depuis le contenant — ajustable si besoin' : 'Ex: 5 kg pour une pate, 3 moules pour une genoise'}</p>
                </div>

                {!isBase && (() => {
                  const yieldQ = parseFloat(yieldQuantity) || 1;
                  const costPerUnit = yieldQ > 0 ? liveCost / yieldQ : 0;
                  const handleMultiplierChange = (val: string) => {
                    setMarginMultiplier(val);
                    const m = parseFloat(val);
                    if (!isNaN(m) && costPerUnit > 0) setSalePrice((costPerUnit * m).toFixed(2));
                  };
                  const handlePriceChange = (val: string) => {
                    setSalePrice(val);
                    const p = parseFloat(val);
                    if (!isNaN(p) && costPerUnit > 0) setMarginMultiplier((p / costPerUnit).toFixed(2));
                  };
                  return (
                    <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                      <div className="text-sm font-semibold text-gray-700">Tarification</div>

                      <div className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                        <div className="text-xs text-gray-500">Coût / pièce (calculé)</div>
                        <div className="font-bold text-gray-800">{costPerUnit.toFixed(2)} DH</div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Multiplicateur de marge</label>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">×</span>
                            <input
                              type="number" min={0.01} step="0.01"
                              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-bold"
                              value={marginMultiplier}
                              onChange={(e) => handleMultiplierChange(e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Prix de vente (DH)</label>
                          <input
                            type="number" min={0} step="0.01"
                            className="w-full px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-bold text-amber-900"
                            value={salePrice}
                            onChange={(e) => handlePriceChange(e.target.value)}
                            placeholder={(costPerUnit * (parseFloat(marginMultiplier) || 0)).toFixed(2)}
                          />
                        </div>
                      </div>

                      <p className="text-xs text-gray-500">
                        Saisis l'un OU l'autre — l'autre se recalcule. Le prix du produit lié sera mis à jour à l'enregistrement.
                      </p>
                    </div>
                  );
                })()}
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
                            const selectedSr = availableBaseRecipes.find((r: Record<string, any>) => r.id === row.subRecipeId) as Record<string, any> | undefined;
                            const srCost = selectedSr && row.quantity
                              ? (parseFloat(selectedSr.total_cost as string || '0') / (parseFloat(selectedSr.yield_quantity as string) || 1)) * parseFloat(row.quantity)
                              : 0;
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 items-center px-4 py-2">
                                <SearchableSelect
                                  items={availableBaseRecipes as Record<string, any>[]}
                                  value={row.subRecipeId}
                                  onChange={(id) => updateSubRecipeRow(idx, 'subRecipeId', id)}
                                  placeholder="-- Preparation --"
                                  renderHint={(r) => r.yield_quantity ? `${r.yield_quantity} ${r.yield_unit || 'u.'}` : null}
                                />
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

                {/* Section : Ingredients alimentaires (table ingredients) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Scale size={16} className="text-amber-700" /> Ingredients alimentaires
                      {foodCost > 0 && <span className="text-xs text-gray-400 font-normal ml-1">{foodCost.toFixed(2)} DH</span>}
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
                        const selectedIng = allIngredients.find((i: Record<string, any>) => i.id === row.ingredientId) as Record<string, any> | undefined;
                        const ingBaseUnit = selectedIng ? selectedIng.unit as string : 'unit';
                        const currentUnit = row.unit || ingBaseUnit;
                        const compatibleUnits = COMPATIBLE_UNITS[ingBaseUnit] || [ingBaseUnit];
                        const factor = unitConversionFactor(currentUnit, ingBaseUnit);
                        const rowCost = selectedIng && row.quantity ? parseFloat(row.quantity) * parseFloat(selectedIng.unit_cost as string || '0') * factor : 0;
                        return (
                          <div key={idx} className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 items-center px-4 py-2">
                            <SearchableSelect
                              items={allIngredients as Record<string, any>[]}
                              value={row.ingredientId}
                              onChange={(id, item) => {
                                const updated = [...formIngredients];
                                updated[idx] = { ...updated[idx], ingredientId: id, unit: item ? (item.unit as string) : '' };
                                setFormIngredients(updated);
                              }}
                              placeholder="-- Ingredient --"
                              renderHint={(i) => {
                                const cost = parseFloat(i.unit_cost as string || '0');
                                const parts: string[] = [];
                                if (i.unit) parts.push(i.unit as string);
                                if (cost > 0) parts.push(`${cost.toFixed(2)} DH/${i.unit as string}`);
                                return parts.length ? parts.join(' · ') : null;
                              }}
                            />
                            <input type="number" step="any" min="0"
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

                {/* Section : Emballages (table packaging_items dediee, sans DLC ni FEFO) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Package size={16} className="text-blue-700" /> Emballages
                      {packagingCost > 0 && <span className="text-xs text-gray-400 font-normal ml-1">{packagingCost.toFixed(2)} DH</span>}
                    </h3>
                    <button type="button" onClick={() => setFormPackaging([...formPackaging, { packagingId: '', quantity: '', unit: 'piece' }])}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium px-3 py-1.5 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                      <PlusCircle size={14} /> Ajouter
                    </button>
                  </div>
                  <div className="border border-blue-100 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 text-xs font-semibold text-blue-700 px-4 py-2.5 bg-blue-50/50 uppercase tracking-wider">
                      <span>Emballage</span>
                      <span>Quantite</span>
                      <span>Unite</span>
                      <span>Cout</span>
                      <span></span>
                    </div>
                    <div className="divide-y divide-blue-50">
                      {formPackaging.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-gray-400 italic">
                          Aucun emballage — clique sur Ajouter (caissette, boite, etiquette, film...)
                        </div>
                      ) : (
                        formPackaging.map((row, idx) => {
                          const selectedPkg = (allPackaging as Record<string, any>[]).find(p => p.id === row.packagingId);
                          const baseUnit = (selectedPkg?.unit as string) || 'piece';
                          const rowCost = selectedPkg && row.quantity ? parseFloat(row.quantity) * parseFloat(selectedPkg.unit_cost as string || '0') : 0;
                          return (
                            <div key={idx} className="grid grid-cols-[1fr_100px_90px_80px_40px] gap-2 items-center px-4 py-2">
                              <SearchableSelect
                                items={allPackaging as Record<string, any>[]}
                                value={row.packagingId}
                                onChange={(id, item) => {
                                  const updated = [...formPackaging];
                                  updated[idx] = { ...updated[idx], packagingId: id, unit: item ? (item.unit as string) : 'piece' };
                                  setFormPackaging(updated);
                                }}
                                placeholder="-- Emballage --"
                                renderHint={(p) => {
                                  const cost = parseFloat(p.unit_cost as string || '0');
                                  const parts: string[] = [];
                                  if (p.format) parts.push(p.format as string);
                                  if (cost > 0) parts.push(`${cost.toFixed(2)} DH/${p.unit as string}`);
                                  return parts.length ? parts.join(' · ') : null;
                                }}
                              />
                              <input type="number" step="any" min="0"
                                className="w-full px-3 py-2 bg-blue-50/30 border border-blue-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-semibold"
                                value={row.quantity}
                                onChange={(e) => {
                                  const updated = [...formPackaging];
                                  updated[idx] = { ...updated[idx], quantity: e.target.value };
                                  setFormPackaging(updated);
                                }}
                                placeholder="0" />
                              <span className="text-xs text-gray-500 text-center font-medium">{baseUnit}</span>
                              <span className="text-xs font-bold text-blue-700 text-center">{rowCost > 0 ? `${rowCost.toFixed(2)}` : '—'}</span>
                              <button type="button" onClick={() => setFormPackaging(formPackaging.filter((_, i) => i !== idx))}
                                className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={14} className="text-red-400" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Live cost — split alimentaires / emballages / preparations de base */}
                <div style={{
                  border: '1px solid var(--theme-bg-separator)',
                  backgroundColor: 'var(--theme-bg-secondary)',
                  borderRadius: 4, padding: '0.625rem 0.875rem',
                  display: 'flex', flexDirection: 'column', gap: '0.375rem',
                }}>
                  {subRecipeCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--theme-text-muted)' }}>Préparations de base</span>
                      <span style={{ fontWeight: 600, color: 'var(--theme-accent)' }}>{subRecipeCost.toFixed(2)} DH</span>
                    </div>
                  )}
                  {foodCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--theme-text-muted)' }}>
                        <Scale size={11} style={{ color: 'var(--theme-accent)' }} /> Ingrédients alimentaires
                      </span>
                      <span style={{ fontWeight: 600 }}>{foodCost.toFixed(2)} DH</span>
                    </div>
                  )}
                  {packagingCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--theme-text-muted)' }}>
                        <Package size={11} style={{ color: '#1f6391' }} /> Emballages
                      </span>
                      <span style={{ fontWeight: 600, color: '#1f6391' }}>{packagingCost.toFixed(2)} DH</span>
                    </div>
                  )}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    paddingTop: 6, borderTop: '1px solid var(--theme-bg-separator)',
                  }}>
                    <span style={{ fontWeight: 600 }}>Coût total estimé</span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--theme-accent)' }}>
                      {liveCost.toFixed(2)} DH
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* ═══ Tab: Etapes ═══ */}
            {activeTab === 'etapes' && (
              <>
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <ListChecks size={20} className="text-indigo-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-indigo-800">Etapes de production</h3>
                      <p className="text-xs text-indigo-600 mt-0.5">Definissez les etapes a suivre lors de la production. Les etapes bloquantes empechent de passer a la suite tant qu'elles ne sont pas validees.</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-gray-700">{formEtapes.length} etape{formEtapes.length !== 1 ? 's' : ''}</h3>
                  <button type="button" onClick={addEtapeRow}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-medium px-3 py-1.5 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
                    <PlusCircle size={14} /> Ajouter une etape
                  </button>
                </div>

                {formEtapes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <ListChecks size={36} className="mb-2 text-gray-300" />
                    <p className="text-sm font-medium">Aucune etape definie</p>
                    <p className="text-xs mt-1">Cliquez sur "Ajouter une etape" pour commencer</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formEtapes.map((etape, idx) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                        {/* Header row */}
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col gap-0.5">
                            <button type="button" onClick={() => moveEtape(idx, -1)} disabled={idx === 0}
                              className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-20 transition-colors">
                              <ArrowUp size={12} />
                            </button>
                            <button type="button" onClick={() => moveEtape(idx, 1)} disabled={idx === formEtapes.length - 1}
                              className="p-0.5 hover:bg-gray-100 rounded disabled:opacity-20 transition-colors">
                              <ArrowDown size={12} />
                            </button>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {etape.ordre}
                          </div>
                          <input type="text" placeholder="Nom de l'etape (ex: Petrissage, Repos frigo...)"
                            className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            value={etape.nom} onChange={(e) => updateEtapeRow(idx, 'nom', e.target.value)} />
                          <button type="button" onClick={() => removeEtapeRow(idx)}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} className="text-red-400" />
                          </button>
                        </div>

                        {/* Options row */}
                        <div className="flex items-center gap-4 flex-wrap ml-14">
                          <div className="flex items-center gap-2">
                            <Timer size={14} className="text-gray-400" />
                            <input type="number" min="0" step="1" placeholder="min"
                              className="w-20 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                              value={etape.duree_estimee_min} onChange={(e) => updateEtapeRow(idx, 'duree_estimee_min', e.target.value)} />
                            <span className="text-xs text-gray-400">min</span>
                          </div>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                              checked={etape.est_bloquante} onChange={(e) => updateEtapeRow(idx, 'est_bloquante', e.target.checked)} />
                            <span className="text-xs text-gray-600">Bloquante</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                              checked={etape.timer_auto} onChange={(e) => updateEtapeRow(idx, 'timer_auto', e.target.checked)} />
                            <span className="text-xs text-gray-600">Timer auto</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-500"
                              checked={etape.controle_qualite} onChange={(e) => updateEtapeRow(idx, 'controle_qualite', e.target.checked)} />
                            <span className="text-xs text-gray-600">Controle qualite</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                              checked={etape.est_repetable} onChange={(e) => updateEtapeRow(idx, 'est_repetable', e.target.checked)} />
                            <span className="text-xs text-gray-600">Repetable</span>
                          </label>

                          {etape.est_repetable && (
                            <div className="flex items-center gap-1">
                              <Repeat size={12} className="text-purple-400" />
                              <input type="number" min="1" step="1"
                                className="w-14 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-purple-500"
                                value={etape.nb_repetitions} onChange={(e) => updateEtapeRow(idx, 'nb_repetitions', e.target.value)} />
                              <span className="text-xs text-gray-400">fois</span>
                            </div>
                          )}
                        </div>

                        {/* Checklist (visible if controle_qualite) */}
                        {etape.controle_qualite && (
                          <div className="ml-14 bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-green-700">Checklist qualite</span>
                              <button type="button" onClick={() => updateEtapeRow(idx, 'checklist_items', [...etape.checklist_items, ''])}
                                className="text-[10px] text-green-600 hover:text-green-700 font-medium">+ Ajouter</button>
                            </div>
                            {etape.checklist_items.map((item, ci) => (
                              <div key={ci} className="flex items-center gap-2">
                                <div className="w-3.5 h-3.5 rounded border border-green-300 flex-shrink-0" />
                                <input type="text" placeholder="Point de controle..."
                                  className="flex-1 px-2 py-1 bg-white border border-green-200 rounded text-xs focus:ring-1 focus:ring-green-500"
                                  value={item} onChange={(e) => {
                                    const items = [...etape.checklist_items];
                                    items[ci] = e.target.value;
                                    updateEtapeRow(idx, 'checklist_items', items);
                                  }} />
                                <button type="button" onClick={() => {
                                  updateEtapeRow(idx, 'checklist_items', etape.checklist_items.filter((_, j) => j !== ci));
                                }} className="p-1 hover:bg-red-50 rounded"><X size={12} className="text-red-400" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
          <div style={{
            position: 'sticky', bottom: 0,
            backgroundColor: 'var(--theme-bg-card)',
            borderTop: '1px solid var(--theme-bg-separator)',
            padding: '0.625rem 1rem',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem',
          }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">
              Annuler
            </button>
            <button type="submit" disabled={isPending} className="odoo-btn-primary">
              {isPending ? (
                <>
                  <div style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Pencil size={13} /> {isEdit ? 'Mettre à jour' : 'Créer la recette'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
