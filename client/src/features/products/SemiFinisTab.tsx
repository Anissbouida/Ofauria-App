import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { stockFrigoApi } from '../../api/stock-frigo.api';
import { storesApi } from '../../api/stores.api';
import { useAuth } from '../../context/AuthContext';
import {
  Layers, Search, ChevronDown, ChevronRight, Snowflake,
  AlertTriangle, Package, BookOpen, Clock, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface BaseRecipe {
  id: string;
  name: string;
  product_id: string | null;
  product_name: string | null;
  product_image: string | null;
  yield_quantity: string | number;
  yield_unit: string;
  total_cost: string | number | null;
  instructions: string | null;
  is_base: boolean;
}

interface SummaryEntry {
  recipe_id: string;
  recipe_name: string;
  product_id: string | null;
  total_quantity: string;
  nb_lots: string | number;
  earliest_expiry: string | null;
  reserved_quantity: string;
}

interface StockEntry {
  id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  lot_number: string | null;
  produced_at: string;
  expires_at: string | null;
  contenant_nom: string | null;
  plan_date: string;
}

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th className={`${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 transition-colors`}
      onClick={() => onSort(sk)}>
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-amber-500" /> : <ArrowDown size={12} className="text-amber-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
        {label}
        {align !== 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-amber-500" /> : <ArrowDown size={12} className="text-amber-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
      </span>
    </th>
  );
}

export default function SemiFinisTab() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState(user?.storeId || '');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'total_cost' || key === 'stock' || key === 'lots' ? 'desc' : 'asc'); }
  };

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: storesApi.list,
  });

  const storeId = selectedStoreId || (stores.length > 0 ? (stores[0] as Record<string, unknown>).id as string : '');

  const { data: allRecipes = [], isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesApi.list,
  });

  // Unified stock per base recipe: pulls from semi_finished_stock (used by
  // the production dependency resolver) AND stock_semifini_frigo (lot tracking).
  // Keyed by recipe_id so it matches regardless of whether the base recipe has
  // a product_id or not.
  const { data: summary = [] } = useQuery({
    queryKey: ['stock-frigo-base-recipes', storeId],
    queryFn: () => stockFrigoApi.baseRecipes(storeId),
    enabled: !!storeId,
  });

  const { data: stockItems = [] } = useQuery({
    queryKey: ['stock-frigo', storeId, false],
    queryFn: () => stockFrigoApi.list(storeId, false),
    enabled: !!storeId,
  });

  // Filter to only base recipes (semi-finis)
  const baseRecipes = useMemo(
    () => (allRecipes as BaseRecipe[]).filter(r => r.is_base === true),
    [allRecipes]
  );

  // Build stock map by recipe_id (source of truth: base recipes can exist
  // without a linked product).
  const stockByRecipe = useMemo(() => {
    const map: Record<string, SummaryEntry> = {};
    for (const s of summary as SummaryEntry[]) {
      map[s.recipe_id] = s;
    }
    return map;
  }, [summary]);

  const lotsByProduct = useMemo(() => {
    const map: Record<string, StockEntry[]> = {};
    for (const entry of stockItems as StockEntry[]) {
      if (!map[entry.product_id]) map[entry.product_id] = [];
      map[entry.product_id].push(entry);
    }
    return map;
  }, [stockItems]);

  const filtered = baseRecipes.filter(r => {
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      (r.product_name?.toLowerCase().includes(q) ?? false)
    );
  });

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va: string | number, vb: string | number;
      const stockA = stockByRecipe[a.id];
      const stockB = stockByRecipe[b.id];
      switch (sortKey) {
        case 'name': va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case 'yield': va = parseFloat(String(a.yield_quantity)) || 0; vb = parseFloat(String(b.yield_quantity)) || 0; break;
        case 'total_cost': va = parseFloat(String(a.total_cost)) || 0; vb = parseFloat(String(b.total_cost)) || 0; break;
        case 'stock': va = stockA ? parseFloat(stockA.total_quantity) : 0; vb = stockB ? parseFloat(stockB.total_quantity) : 0; break;
        case 'lots': va = stockA ? (typeof stockA.nb_lots === 'number' ? stockA.nb_lots : parseInt(stockA.nb_lots)) : 0; vb = stockB ? (typeof stockB.nb_lots === 'number' ? stockB.nb_lots : parseInt(stockB.nb_lots)) : 0; break;
        case 'expiry': va = stockA?.earliest_expiry ? new Date(stockA.earliest_expiry).getTime() : Infinity; vb = stockB?.earliest_expiry ? new Date(stockB.earliest_expiry).getTime() : Infinity; break;
        default: va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, stockByRecipe, sortKey, sortDir]);

  const totalWithStock = baseRecipes.filter(r => {
    const s = stockByRecipe[r.id];
    return s && parseFloat(s.total_quantity) > 0;
  }).length;

  const expiringCount = (stockItems as StockEntry[]).filter(e => {
    if (!e.expires_at) return false;
    const d = new Date(e.expires_at);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return d <= tomorrow;
  }).length;

  return (
    <div className="space-y-5">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Layers size={20} className="text-amber-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Semi-finis & Produits de base</h2>
            <p className="text-xs text-gray-500">Recettes de base et stock intermediaire</p>
          </div>
        </div>
        {stores.length > 1 && (
          <select
            value={storeId}
            onChange={e => setSelectedStoreId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {(stores as Record<string, unknown>[]).map(s => (
              <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
            ))}
          </select>
        )}
      </div>

      {/* ─── Summary cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-amber-700">{baseRecipes.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Recettes de base</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-cyan-700">{totalWithStock}</div>
          <div className="text-xs text-gray-500 mt-0.5">En stock</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-700">
            {(summary as SummaryEntry[]).reduce((sum, s) => sum + (typeof s.nb_lots === 'number' ? s.nb_lots : parseInt(s.nb_lots)), 0)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Lots actifs</div>
        </div>
        {expiringCount > 0 ? (
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
            <div className="text-2xl font-bold text-red-700">{expiringCount}</div>
            <div className="text-xs text-red-500 mt-0.5">Expiration imminente</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-300">0</div>
            <div className="text-xs text-gray-500 mt-0.5">Expiration imminente</div>
          </div>
        )}
      </div>

      {/* ─── Search ─── */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un semi-fini..."
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
      </div>

      {/* ─── List ─── */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Layers size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">Aucun semi-fini</p>
          <p className="text-xs text-gray-400 mt-1">
            Creez des recettes marquees comme &quot;recette de base&quot; dans le module Recettes
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 w-8"></th>
                  <SortHeader label="Nom" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Rendement" sortKey="yield" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Cout" sortKey="total_cost" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Stock frigo" sortKey="stock" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Lots" sortKey="lots" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Proche exp." sortKey="expiry" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map(recipe => {
                  const stock = stockByRecipe[recipe.id];
                  const lots = recipe.product_id ? (lotsByProduct[recipe.product_id] ?? []) : [];
                  const isExpanded = expandedId === recipe.id;
                  const stockQty = stock ? parseFloat(stock.total_quantity) : 0;
                  const reservedQty = stock ? parseFloat(stock.reserved_quantity) : 0;
                  const earliestExpiry = stock?.earliest_expiry
                    ? new Date(stock.earliest_expiry)
                    : null;
                  const isExpiring = earliestExpiry && earliestExpiry <= new Date(Date.now() + 86400000);
                  const nbLots = stock
                    ? (typeof stock.nb_lots === 'number' ? stock.nb_lots : parseInt(stock.nb_lots))
                    : 0;

                  return (
                    <SemiFiniRow
                      key={recipe.id}
                      recipe={recipe}
                      storeId={storeId}
                      stockQty={stockQty}
                      reservedQty={reservedQty}
                      nbLots={nbLots}
                      earliestExpiry={earliestExpiry}
                      isExpiring={!!isExpiring}
                      isExpanded={isExpanded}
                      lots={lots}
                      onToggle={() => setExpandedId(isExpanded ? null : recipe.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row ───
interface LineageProduction {
  id: string;
  plan_date: string;
  status: string;
  notes: string | null;
  completed_at: string | null;
  planned_quantity: number | string;
  actual_quantity: number | string | null;
  item_status: string;
}

interface LineageReservation {
  id: string;
  parent_plan_id: string;
  quantity_from_stock: string;
  quantity_needed: string;
  dep_status: string;
  created_at: string;
  plan_date: string;
  plan_status: string;
  plan_notes: string | null;
  target_role: string | null;
}

interface LineageTransaction {
  type: string;
  quantity_change: string;
  created_at: string;
  notes: string | null;
  production_plan_id: string | null;
  plan_date: string | null;
  plan_status: string | null;
  plan_notes: string | null;
}

interface Lineage {
  current: { quantity_available: string; unit: string; last_produced_at: string | null } | null;
  productions: LineageProduction[];
  reservations: LineageReservation[];
  transactions: LineageTransaction[];
}

function SemiFiniRow({
  recipe, storeId, stockQty, reservedQty, nbLots, earliestExpiry, isExpiring, isExpanded, lots, onToggle,
}: {
  recipe: BaseRecipe;
  storeId: string;
  stockQty: number;
  reservedQty: number;
  nbLots: number;
  earliestExpiry: Date | null;
  isExpiring: boolean;
  isExpanded: boolean;
  lots: StockEntry[];
  onToggle: () => void;
}) {
  // Fetch full recipe details on expand (ingredients + sub-recipes)
  const { data: fullRecipe } = useQuery({
    queryKey: ['recipe', recipe.id],
    queryFn: () => recipesApi.getById(recipe.id),
    enabled: isExpanded,
  });

  // Lineage (productions + reservations + recent transactions)
  const { data: lineage } = useQuery<Lineage>({
    queryKey: ['recipe-lineage', recipe.id, storeId],
    queryFn: () => stockFrigoApi.recipeLineage(recipe.id, storeId),
    enabled: isExpanded && !!storeId,
  });

  const yieldQty = typeof recipe.yield_quantity === 'string'
    ? parseFloat(recipe.yield_quantity)
    : recipe.yield_quantity;
  const cost = recipe.total_cost
    ? (typeof recipe.total_cost === 'string' ? parseFloat(recipe.total_cost) : recipe.total_cost)
    : null;

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-gray-50 hover:bg-amber-50/30 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          {isExpanded
            ? <ChevronDown size={16} className="text-gray-400" />
            : <ChevronRight size={16} className="text-gray-400" />}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <BookOpen size={14} className="text-amber-700" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 truncate">{recipe.name}</div>
              {recipe.product_name && recipe.product_name !== recipe.name && (
                <div className="text-xs text-gray-500 truncate">{recipe.product_name}</div>
              )}
            </div>
          </div>
        </td>
        <td className="text-center px-3 py-3 text-gray-700 whitespace-nowrap">
          {yieldQty} {recipe.yield_unit}
        </td>
        <td className="text-center px-3 py-3 text-gray-700 whitespace-nowrap">
          {cost != null ? `${cost.toFixed(2)} MAD` : '—'}
        </td>
        <td className="text-center px-3 py-3">
          <div className="flex flex-col items-center gap-0.5">
            {stockQty > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 text-xs font-semibold">
                <Snowflake size={12} />
                {stockQty.toFixed(2)} {recipe.yield_unit}
              </span>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
            {reservedQty > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
                <Clock size={10} />
                {reservedQty.toFixed(2)} reserve
              </span>
            )}
          </div>
        </td>
        <td className="text-center px-3 py-3">
          {nbLots > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-gray-700">
              <Package size={12} className="text-gray-400" />
              {nbLots}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="text-center px-3 py-3">
          {earliestExpiry ? (
            <span className={`inline-flex items-center gap-1 text-xs ${isExpiring ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
              {isExpiring && <AlertTriangle size={12} />}
              {format(earliestExpiry, 'dd/MM', { locale: fr })}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
      </tr>

      {/* Expanded panel */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-gray-50 px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Ingredients */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Composition
                </h4>
                {!fullRecipe ? (
                  <p className="text-xs text-gray-400">Chargement...</p>
                ) : (
                  <div className="space-y-1">
                    {((fullRecipe as Record<string, unknown>).ingredients as Record<string, unknown>[] ?? []).length === 0 &&
                     ((fullRecipe as Record<string, unknown>).sub_recipes as Record<string, unknown>[] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400">Aucun ingredient defini</p>
                    ) : (
                      <>
                        {((fullRecipe as Record<string, unknown>).ingredients as Record<string, unknown>[] ?? []).map((ing, i) => (
                          <div key={`ing-${i}`} className="flex justify-between text-sm bg-white rounded px-2 py-1 border border-gray-100">
                            <span className="text-gray-700">{ing.ingredient_name as string}</span>
                            <span className="text-gray-500 font-mono text-xs">
                              {ing.quantity as string} {ing.unit as string}
                            </span>
                          </div>
                        ))}
                        {((fullRecipe as Record<string, unknown>).sub_recipes as Record<string, unknown>[] ?? []).map((sr, i) => (
                          <div key={`sr-${i}`} className="flex justify-between text-sm bg-amber-50 rounded px-2 py-1 border border-amber-100">
                            <span className="text-amber-800 flex items-center gap-1">
                              <Layers size={10} />
                              {sr.sub_recipe_name as string}
                            </span>
                            <span className="text-amber-600 font-mono text-xs">
                              {sr.quantity as string} {sr.sub_yield_unit as string}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
                {recipe.instructions && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Instructions
                    </h4>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap bg-white rounded p-2 border border-gray-100">
                      {recipe.instructions}
                    </p>
                  </div>
                )}
              </div>

              {/* Traceability: productions + reservations + transactions */}
              <div className="space-y-4">
                {/* Current stock snapshot */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Etat actuel
                  </h4>
                  <div className="bg-white rounded p-2 border border-gray-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Stock libre</span>
                      <span className="font-semibold text-gray-800">
                        {stockQty.toFixed(2)} {recipe.yield_unit}
                      </span>
                    </div>
                    {reservedQty > 0 && (
                      <div className="flex justify-between mt-1 text-amber-700">
                        <span>Reserve par plans en cours</span>
                        <span className="font-semibold">{reservedQty.toFixed(2)} {recipe.yield_unit}</span>
                      </div>
                    )}
                    {lineage?.current?.last_produced_at && (
                      <div className="flex justify-between mt-1 text-gray-400">
                        <span>Derniere production</span>
                        <span>{format(new Date(lineage.current.last_produced_at), 'dd/MM HH:mm', { locale: fr })}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active reservations */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Reservations actives ({lineage?.reservations.length ?? 0})
                  </h4>
                  {!lineage ? (
                    <p className="text-xs text-gray-400">Chargement...</p>
                  ) : lineage.reservations.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune reservation en cours</p>
                  ) : (
                    <div className="space-y-1">
                      {lineage.reservations.map(r => (
                        <div key={r.id} className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs">
                          <div className="flex justify-between items-start">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-amber-800 truncate">
                                {r.plan_notes || `Plan du ${format(new Date(r.plan_date), 'dd/MM', { locale: fr })}`}
                              </div>
                              <div className="text-amber-600 mt-0.5">
                                {format(new Date(r.plan_date), 'dd MMM yyyy', { locale: fr })} · {r.plan_status} · {r.target_role}
                              </div>
                            </div>
                            <span className="font-bold text-amber-900 ml-2 whitespace-nowrap">
                              {parseFloat(r.quantity_from_stock).toFixed(2)} {recipe.yield_unit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Production history */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Historique de production ({lineage?.productions.length ?? 0})
                  </h4>
                  {!lineage ? null : lineage.productions.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune production enregistree</p>
                  ) : (
                    <div className="space-y-1">
                      {lineage.productions.slice(0, 5).map(p => (
                        <div key={p.id} className="bg-white border border-gray-100 rounded px-2 py-1.5 text-xs">
                          <div className="flex justify-between items-start">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-gray-800 truncate">
                                {p.notes || `Plan ${format(new Date(p.plan_date), 'dd/MM', { locale: fr })}`}
                              </div>
                              <div className="text-gray-500 mt-0.5">
                                {format(new Date(p.plan_date), 'dd MMM yyyy', { locale: fr })} · {p.status}
                                {p.completed_at && ` · Terminé ${format(new Date(p.completed_at), 'dd/MM HH:mm', { locale: fr })}`}
                              </div>
                            </div>
                            <span className="text-gray-700 font-semibold ml-2 whitespace-nowrap">
                              {p.actual_quantity != null
                                ? `${parseFloat(String(p.actual_quantity)).toFixed(2)}`
                                : `${parseFloat(String(p.planned_quantity)).toFixed(2)}`
                              } batch{parseFloat(String(p.actual_quantity ?? p.planned_quantity)) > 1 ? 'es' : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent movements */}
                {lineage && lineage.transactions.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Derniers mouvements
                    </h4>
                    <div className="space-y-0.5">
                      {lineage.transactions.slice(0, 6).map((tx, i) => {
                        const qty = parseFloat(tx.quantity_change);
                        const positive = qty >= 0;
                        const typeLabel: Record<string, string> = {
                          production: 'Production',
                          consumption: 'Consommation',
                          reservation: 'Reservation',
                          release: 'Liberation',
                          waste: 'Perte',
                          adjustment: 'Ajustement',
                        };
                        return (
                          <div key={i} className="flex justify-between items-center text-xs bg-white rounded px-2 py-1 border border-gray-50">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${positive ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                              <span className="text-gray-700">{typeLabel[tx.type] || tx.type}</span>
                              {tx.plan_notes && (
                                <span className="text-gray-400 truncate">· {tx.plan_notes}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`font-mono font-semibold ${positive ? 'text-green-700' : 'text-amber-700'}`}>
                                {positive ? '+' : ''}{qty.toFixed(2)}
                              </span>
                              <span className="text-gray-400">{format(new Date(tx.created_at), 'dd/MM HH:mm', { locale: fr })}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Lots (if any — newer tracking system) */}
                {lots.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Lots frigo
                    </h4>
                    <div className="space-y-1">
                      {lots.map(lot => {
                        const expires = lot.expires_at ? new Date(lot.expires_at) : null;
                        const expiring = expires && expires <= new Date(Date.now() + 86400000);
                        return (
                          <div
                            key={lot.id}
                            className={`flex items-center justify-between text-sm rounded px-2 py-1.5 border ${
                              expiring ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Snowflake size={12} className="text-cyan-500 flex-shrink-0" />
                              <span className="text-gray-700 font-mono text-xs truncate">
                                {lot.lot_number || 'sans lot'}
                              </span>
                              {lot.contenant_nom && (
                                <span className="text-xs text-gray-400 truncate">· {lot.contenant_nom}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-gray-700 font-semibold text-xs">
                                {parseFloat(lot.quantity).toFixed(2)} {recipe.yield_unit}
                              </span>
                              {expires && (
                                <span className={`inline-flex items-center gap-1 text-xs ${expiring ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
                                  <Clock size={10} />
                                  {format(expires, 'dd/MM/yy', { locale: fr })}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
