import { currencySymbol } from '../../utils/money';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { stockFrigoApi } from '../../api/stock-frigo.api';
import { storesApi } from '../../api/stores.api';
import { useAuth } from '../../context/AuthContext';
import {
  Layers, Search, ChevronDown, ChevronRight, Snowflake,
  Package, Clock, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { DataPanel, EmptyState, KpiCard, KpiGrid, LoadingState, NoResultState, SearchBar, TableFooter, Toolbar } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const secHeader: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 8 };
const emptyTxt: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--theme-text-muted)' };
const tileBox: React.CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', padding: '8px 10px', fontSize: '0.8125rem', display: 'grid', gap: 4 };

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...secHeader, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left' }}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

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
    <th style={{ textAlign: align }}><button type="button" className="ds-sort" onClick={() => onSort(sk)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </button></th>
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
      {/* ─── Indicateurs ─── */}
      <KpiGrid>
        <KpiCard label="Produits de base" value={baseRecipes.length} sub="Recettes intermédiaires" />
        <KpiCard label="En stock" value={totalWithStock} sub="Au frigo" />
        <KpiCard label="Lots actifs" value={totalLotsActifs} sub="En cours" />
        <KpiCard label="Expiration sous 24 h" value={expiringCount} sub={expiringCount > 0 ? 'Lots à utiliser en priorité' : 'Aucun lot imminent'} tone={expiringCount > 0 ? 'red' : undefined} />
      </KpiGrid>

      {/* ─── Barre d'outils ─── */}
      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit de base" />
        {stores.length > 1 && (
          <SearchSelect
            options={(stores as Record<string, any>[]).map(s => ({ id: s.id as string, label: s.name as string }))}
            value={storeId}
            onChange={id => id && setSelectedStoreId(id)}
            placeholder="Magasin"
          />
        )}
      </Toolbar>

      {/* ─── List ─── */}
      {isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        search
          ? <NoResultState text="Aucun produit de base ne correspond à la recherche." onReset={() => setSearch('')} />
          : <EmptyState icon={Layers} title="Aucun produit de base"
              text="Les recettes marquées « préparation de base » dans les fiches techniques apparaissent ici, avec leur stock au frigo et leurs lots." />
      ) : (
        <DataPanel label="Produits de base" footer={<TableFooter note={`${filtered.length} sur ${baseRecipes.length} produit(s) de base`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <SortHeader label="Nom" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Rendement" sortKey="yield" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label={`Coût (${currencySymbol()})`} sortKey="total_cost" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Stock au frigo" sortKey="stock" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <th className="ds-num">Réservé</th>
                <SortHeader label="Lots" sortKey="lots" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Prochaine expiration" sortKey="expiry" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
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
        </DataPanel>
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
  const navigate = useNavigate();
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
      <tr onClick={onToggle} style={{ cursor: 'pointer' }} aria-expanded={isExpanded}>
        <td>
          <span className="ds-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isExpanded
              ? <ChevronDown size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
              : <ChevronRight size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
            {recipe.name}
            {recipe.product_name && recipe.product_name !== recipe.name && (
              <span style={{ color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 }}>· {recipe.product_name}</span>
            )}
          </span>
        </td>
        {/* Rendement, stock et réservé gardent l'unité de la fiche (elle varie d'une ligne à l'autre). */}
        <td className="ds-num">
          {yieldQty}
          <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 3 }}>{recipe.yield_unit}</span>
        </td>
        <td className="ds-num">{cost != null ? <span className="ds-strong">{cost.toFixed(2)}</span> : '—'}</td>
        <td className="ds-num">
          {stockQty > 0 ? (
            <>
              <span className="ds-strong">{stockQty.toFixed(2)}</span>
              <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 3 }}>{recipe.yield_unit}</span>
            </>
          ) : '—'}
        </td>
        <td className="ds-num">
          {reservedQty > 0 ? (
            <span style={{ color: 'var(--ds-warning)', fontWeight: 600 }} title="Réservé par les plans de production en cours">
              {reservedQty.toFixed(2)} {recipe.yield_unit}
            </span>
          ) : '—'}
        </td>
        <td className="ds-num">{nbLots > 0 ? nbLots : '—'}</td>
        <td className="ds-num">
          {earliestExpiry ? (
            isExpiring ? (
              <StatusTag tone="late" label={format(earliestExpiry, 'd MMM', { locale: fr })} title="DLC dépassée ou sous 24 h" />
            ) : format(earliestExpiry, 'd MMM', { locale: fr })
          ) : '—'}
        </td>
      </tr>

      {/* Expanded panel */}
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--ds-bg)', padding: '16px 20px' }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Composition */}
              <div>
                <div style={secHeader}>Composition</div>
                {!fullRecipe ? (
                  <p style={emptyTxt}>Chargement…</p>
                ) : (((fullRecipe as Record<string, any>).ingredients as Record<string, any>[] ?? []).length === 0 &&
                     ((fullRecipe as Record<string, any>).sub_recipes as Record<string, any>[] ?? []).length === 0) ? (
                  <p style={emptyTxt}>Aucun ingrédient défini</p>
                ) : (
                  <DataPanel><table className="odoo-table ds-dense">
                    <tbody>
                      {((fullRecipe as Record<string, any>).ingredients as Record<string, any>[] ?? []).map((ing, i) => (
                        <tr key={`ing-${i}`}>
                          <td>{ing.ingredient_name as string}</td>
                          <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{ing.quantity as string} {ing.unit as string}</td>
                        </tr>
                      ))}
                      {((fullRecipe as Record<string, any>).sub_recipes as Record<string, any>[] ?? []).map((sr, i) => (
                        <tr key={`sr-${i}`}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Layers size={11} style={{ color: 'var(--theme-accent)' }} />
                              {sr.sub_recipe_name as string}
                              <span className="odoo-tag odoo-tag-purple">base</span>
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{sr.quantity as string} {sr.sub_yield_unit as string}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></DataPanel>
                )}
                {recipe.instructions && (
                  <div style={{ marginTop: 12 }}>
                    <div style={secHeader}>Instructions</div>
                    <div style={{ ...tileBox, whiteSpace: 'pre-wrap', color: 'var(--theme-text)' }}>{recipe.instructions}</div>
                  </div>
                )}
              </div>

              {/* Traçabilité : état, réservations, productions, mouvements, lots */}
              <div style={{ display: 'grid', gap: 16 }}>
                {/* État actuel */}
                <div>
                  <div style={secHeader}>État actuel</div>
                  <div style={tileBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--theme-text-muted)' }}>Stock libre</span>
                      <span style={{ fontWeight: 600 }}>{stockQty.toFixed(2)} {recipe.yield_unit}</span>
                    </div>
                    {reservedQty > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--theme-text-muted)' }}>Réservé par plans en cours</span>
                        <span style={{ fontWeight: 600, color: 'var(--ds-warning)' }}>{reservedQty.toFixed(2)} {recipe.yield_unit}</span>
                      </div>
                    )}
                    {lineage?.current?.last_produced_at && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--theme-text-muted)' }}>Dernière production</span>
                        <span style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(lineage.current.last_produced_at), 'dd/MM HH:mm', { locale: fr })}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Réservations actives */}
                <CollapsibleSection title={`Réservations actives (${lineage?.reservations.length ?? 0})`} defaultOpen={false}>
                  {!lineage ? (
                    <p style={emptyTxt}>Chargement…</p>
                  ) : lineage.reservations.length === 0 ? (
                    <p style={emptyTxt}>Aucune réservation en cours</p>
                  ) : (
                    <DataPanel><table className="odoo-table ds-dense">
                      <tbody>
                        {lineage.reservations.map(r => (
                          <tr key={r.id} onClick={() => navigate(`/production/${r.parent_plan_id}`)} style={{ cursor: 'pointer' }} title="Voir la fiche du plan">
                            <td>
                              <div style={{ fontWeight: 600 }}>{r.plan_notes || `Plan du ${format(new Date(r.plan_date), 'dd/MM', { locale: fr })}`}</div>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{format(new Date(r.plan_date), 'dd MMM yyyy', { locale: fr })} · {r.plan_status} · {r.target_role}</div>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 600, color: 'var(--ds-warning)', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.quantity_from_stock).toFixed(2)} {recipe.yield_unit}</span>
                              <ChevronRight size={13} style={{ color: 'var(--theme-text-muted)', marginLeft: 6, verticalAlign: 'middle' }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></DataPanel>
                  )}
                </CollapsibleSection>

                {/* Historique de production */}
                <CollapsibleSection title={`Historique de production (${lineage?.productions.length ?? 0})`} defaultOpen={false}>
                  {!lineage ? null : lineage.productions.length === 0 ? (
                    <p style={emptyTxt}>Aucune production enregistrée</p>
                  ) : (
                    <DataPanel><table className="odoo-table ds-dense">
                      <tbody>
                        {lineage.productions.slice(0, 5).map(p => (
                          <tr key={p.id} onClick={() => navigate(`/production/${p.id}`)} style={{ cursor: 'pointer' }} title="Voir la fiche du plan">
                            <td>
                              <div style={{ fontWeight: 500 }}>{p.notes || `Plan ${format(new Date(p.plan_date), 'dd/MM', { locale: fr })}`}</div>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{format(new Date(p.plan_date), 'dd MMM yyyy', { locale: fr })} · {p.status}{p.completed_at && ` · Terminé ${format(new Date(p.completed_at), 'dd/MM HH:mm', { locale: fr })}`}</div>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{(p.actual_quantity != null ? parseFloat(String(p.actual_quantity)) : parseFloat(String(p.planned_quantity))).toFixed(2)} batch{parseFloat(String(p.actual_quantity ?? p.planned_quantity)) > 1 ? 'es' : ''}</span>
                              <ChevronRight size={13} style={{ color: 'var(--theme-text-muted)', marginLeft: 6, verticalAlign: 'middle' }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></DataPanel>
                  )}
                </CollapsibleSection>

                {/* Derniers mouvements */}
                {lineage && lineage.transactions.length > 0 && (
                  <CollapsibleSection title="Derniers mouvements" defaultOpen={false}>
                    <DataPanel><table className="odoo-table ds-dense">
                      <tbody>
                        {lineage.transactions.slice(0, 6).map((tx, i) => {
                          const qty = parseFloat(tx.quantity_change);
                          const positive = qty >= 0;
                          const typeLabel: Record<string, string> = {
                            production: 'Production', consumption: 'Consommation', reservation: 'Réservation',
                            release: 'Libération', waste: 'Perte', adjustment: 'Ajustement',
                          };
                          return (
                            <tr key={i}>
                              <td>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: 999, background: positive ? 'var(--ds-success)' : 'var(--ds-warning)', flexShrink: 0 }} />
                                  {typeLabel[tx.type] || tx.type}
                                  {tx.plan_notes && <span style={{ color: 'var(--theme-text-muted)' }}>· {tx.plan_notes}</span>}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: positive ? 'var(--ds-success)' : 'var(--ds-warning)' }}>{positive ? '+' : ''}{qty.toFixed(2)}</span>
                                <span style={{ color: 'var(--theme-text-muted)', marginLeft: 8 }}>{format(new Date(tx.created_at), 'dd/MM HH:mm', { locale: fr })}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></DataPanel>
                  </CollapsibleSection>
                )}

                {/* Lots frigo */}
                {lots.length > 0 && (
                  <CollapsibleSection title="Lots frigo" defaultOpen={false}>
                    <DataPanel><table className="odoo-table ds-dense">
                      <tbody>
                        {lots.map(lot => {
                          const expires = lot.expires_at ? new Date(lot.expires_at) : null;
                          const expiring = expires && expires <= new Date(Date.now() + 86400000);
                          return (
                            <tr key={lot.id}>
                              <td>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                  <Snowflake size={12} style={{ color: 'var(--theme-accent)', flexShrink: 0 }} />
                                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{lot.lot_number || 'sans lot'}</span>
                                  {lot.contenant_nom && <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>· {lot.contenant_nom}</span>}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <span style={{ fontWeight: 600 }}>{parseFloat(lot.quantity).toFixed(2)} {recipe.yield_unit}</span>
                                {expires && (expiring ? (
                                  <span style={{ marginLeft: 8 }}>
                                    <StatusTag tone="late" label={format(expires, 'dd/MM/yy', { locale: fr })} title="DLC dépassée ou sous 24 h" />
                                  </span>
                                ) : (
                                  <span style={{ marginLeft: 8, color: 'var(--theme-text-muted)' }}>
                                    <Clock size={10} /> {format(expires, 'dd/MM/yy', { locale: fr })}
                                  </span>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></DataPanel>
                  </CollapsibleSection>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
