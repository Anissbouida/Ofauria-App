import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { stockFrigoApi } from '../../api/stock-frigo.api';
import { storesApi } from '../../api/stores.api';
import { useAuth } from '../../context/AuthContext';
import {
  Layers, Search, ChevronDown, ChevronRight, Snowflake,
  AlertTriangle, Package, Clock, ArrowUp, ArrowDown, ArrowUpDown,
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

  const storeId = selectedStoreId || (stores.length > 0 ? (stores[0] as Record<string, any>).id as string : '');

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

  const totalLotsActifs = (summary as SummaryEntry[]).reduce((sum, s) => sum + (typeof s.nb_lots === 'number' ? s.nb_lots : parseInt(s.nb_lots)), 0);

  return (
    <>
      {/* ─── Stat tiles ─── */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Produits de base</div>
          <div className="odoo-stat-card-value">{baseRecipes.length}</div>
          <div className="odoo-stat-card-sub">recettes</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">En stock</div>
          <div className="odoo-stat-card-value">{totalWithStock}</div>
          <div className="odoo-stat-card-sub">au frigo</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Lots actifs</div>
          <div className="odoo-stat-card-value">{totalLotsActifs}</div>
          <div className="odoo-stat-card-sub">en cours</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Expiration ≤24h</div>
          <div className="odoo-stat-card-value" style={{ color: expiringCount > 0 ? '#dc3545' : undefined }}>{expiringCount}</div>
          <div className="odoo-stat-card-sub">imminents</div>
        </div>
      </div>

      {/* ─── Search panel ─── */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un produit de base..."
          className="odoo-search-input"
        />
        {stores.length > 1 && (
          <select
            value={storeId}
            onChange={e => setSelectedStoreId(e.target.value)}
            className="odoo-filter-dropdown"
            style={{ marginLeft: 'auto' }}
          >
            {(stores as Record<string, any>[]).map(s => (
              <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
            ))}
          </select>
        )}
      </div>

      {/* ─── List ─── */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Layers size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun produit de base</p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
            Créez des recettes marquées comme &quot;recette de base&quot; dans le module Recettes
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <SortHeader label="Nom" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Rendement" sortKey="yield" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Coût" sortKey="total_cost" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Stock frigo" sortKey="stock" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Lots" sortKey="lots" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Proche exp." sortKey="expiry" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
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
      )}
    </>
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

  const dotClass = isExpiring ? 'danger' : stockQty > 0 ? 'ok' : 'neutral';

  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td><span className={`odoo-status-dot ${dotClass}`} /></td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            {isExpanded
              ? <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} />
              : <ChevronRight size={13} style={{ color: 'var(--theme-text-muted)' }} />}
            <Layers size={13} style={{ color: 'var(--theme-accent)' }} />
            {recipe.name}
            {recipe.product_name && recipe.product_name !== recipe.name && (
              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', fontWeight: 400 }}>· {recipe.product_name}</span>
            )}
          </span>
        </td>
        <td style={{ textAlign: 'right' }}>
          <span style={{ fontWeight: 500 }}>{yieldQty}</span>
          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{recipe.yield_unit}</span>
        </td>
        <td style={{ textAlign: 'right' }}>
          {cost != null ? (
            <>
              <span style={{ fontWeight: 600 }}>{cost.toFixed(2)}</span>
              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
            </>
          ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {stockQty > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, justifyContent: 'flex-end' }}>
              <Snowflake size={11} style={{ color: 'var(--theme-accent)' }} />
              <span style={{ fontWeight: 600 }}>{stockQty.toFixed(2)}</span>
              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{recipe.yield_unit}</span>
              {reservedQty > 0 && (
                <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 4 }} title={`Réservé: ${reservedQty.toFixed(2)} ${recipe.yield_unit}`}>
                  −{reservedQty.toFixed(2)}
                </span>
              )}
            </span>
          ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {nbLots > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', color: 'var(--theme-text-muted)' }}>
              <Package size={11} /> {nbLots}
            </span>
          ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {earliestExpiry ? (
            isExpiring ? (
              <span className="odoo-tag odoo-tag-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <AlertTriangle size={10} /> {format(earliestExpiry, 'dd/MM', { locale: fr })}
              </span>
            ) : (
              <span style={{ color: 'var(--theme-text-muted)' }}>{format(earliestExpiry, 'dd/MM', { locale: fr })}</span>
            )
          ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
      </tr>

      {/* Expanded panel */}
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '16px 20px' }}>
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
                    {((fullRecipe as Record<string, any>).ingredients as Record<string, any>[] ?? []).length === 0 &&
                     ((fullRecipe as Record<string, any>).sub_recipes as Record<string, any>[] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400">Aucun ingredient defini</p>
                    ) : (
                      <>
                        {((fullRecipe as Record<string, any>).ingredients as Record<string, any>[] ?? []).map((ing, i) => (
                          <div key={`ing-${i}`} className="flex justify-between text-sm bg-white rounded px-2 py-1 border border-gray-100">
                            <span className="text-gray-700">{ing.ingredient_name as string}</span>
                            <span className="text-gray-500 font-mono text-xs">
                              {ing.quantity as string} {ing.unit as string}
                            </span>
                          </div>
                        ))}
                        {((fullRecipe as Record<string, any>).sub_recipes as Record<string, any>[] ?? []).map((sr, i) => (
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
