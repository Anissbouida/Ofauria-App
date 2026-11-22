import { money, currencySymbol } from '../../utils/money';
import { useState, useMemo } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery } from '@tanstack/react-query';
import { reportsApi, type MenuEngineeringClass } from '../../api/reports.api';
import { productLossesApi } from '../../api/product-losses.api';
import MarginsTab from './MarginsTab';
import ReportBuilder from './ReportBuilder';
import ReportsOverview from './ReportsOverview';
import { format, subDays, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { Alert, DataPanel, KpiCard, KpiGrid, LoadingState, SearchBar, SectionHeader, Toolbar } from '../../components/ds';
import { Navigate, useSearchParams } from 'react-router-dom';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, ListToolbar, FilterChips } from '../sales/ListTemplate';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
type Tab = 'overview' | 'menu' | 'cost' | 'margins' | 'builder';

/**
 * Écrans de la page, répartis dans les modules (rubriques ModuleShell) : Vue d'ensemble
 * = tableau de bord de Ventes, Menu Engineering et Marges = rapports de Ventes
 * (/reports?tab=…), Coûts = rapport de Production (/production/costs).
 */
const tabs: { key: Tab; label: string; subtitle: string }[] = [
  { key: 'overview', label: 'Analyse des ventes', subtitle: "Chiffre d'affaires, ventes et produits phares" },
  { key: 'menu', label: 'Menu Engineering', subtitle: 'Popularité et marge de chaque produit' },
  { key: 'cost', label: 'Coûts', subtitle: "Coût matière, main-d'œuvre et prime cost" },
  { key: 'margins', label: 'Marges', subtitle: 'Marge par produit sur la période' },
  { key: 'builder', label: 'Rapports personnalisés', subtitle: 'Construisez vos propres analyses' },
];

const CLASS_META: Record<MenuEngineeringClass, { label: string; dot: string; advice: string }> = {
  STAR:   { label: 'Étoiles',     dot: 'var(--ds-success)', advice: 'Mettre en avant, ne pas changer le prix' },
  PUZZLE: { label: 'Énigmes',     dot: 'var(--theme-accent)', advice: 'Repositionner : visibilité, photo, suggestion en caisse' },
  HORSE:  { label: 'Chevaux',     dot: 'var(--ds-warning)', advice: 'Réduire le coût matière ou augmenter le prix' },
  DOG:    { label: 'Poids morts', dot: 'var(--ds-muted)', advice: 'Refondre ou retirer de la carte' },
};

function getZone(value: number, opts: { greenMax?: number; greenMin?: number; orangeMax: number }): { tone: 'green' | 'orange' | 'red'; label: string } {
  if (opts.greenMin !== undefined && opts.greenMax !== undefined) {
    if (value >= opts.greenMin && value <= opts.greenMax) return { tone: 'green', label: 'Optimal' };
  } else if (opts.greenMax !== undefined && value <= opts.greenMax) {
    return { tone: 'green', label: 'Optimal' };
  }
  if (value <= opts.orangeMax) return { tone: 'orange', label: 'Acceptable' };
  return { tone: 'red', label: 'Critique' };
}

const presets: { key: DatePreset; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: '7d', label: '7 jours' },
  { key: '30d', label: '30 jours' },
  { key: '90d', label: '90 jours' },
  { key: 'custom', label: 'Personnalisée' },
];

function getPresetDates(preset: DatePreset): { start: string; end: string } {
  const end = format(new Date(), 'yyyy-MM-dd');
  switch (preset) {
    case 'today': return { start: end, end };
    case '7d': return { start: format(subDays(new Date(), 7), 'yyyy-MM-dd'), end };
    case '30d': return { start: format(subDays(new Date(), 30), 'yyyy-MM-dd'), end };
    case '90d': return { start: format(subMonths(new Date(), 3), 'yyyy-MM-dd'), end };
    default: return { start: format(subDays(new Date(), 30), 'yyyy-MM-dd'), end };
  }
}

function formatCurrency(value: number) {
  return money(value);
}

export default function ReportsPage({ fixedTab }: { fixedTab?: Tab } = {}) {
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const activeTab: Tab = fixedTab ?? (tabs.some(t => t.key === requested && t.key !== 'cost') ? requested as Tab : 'overview');
  const [activePreset, setActivePreset] = useState<DatePreset>('30d');
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { start: startDate, end: endDate } = activePreset === 'custom'
    ? { start: customStart, end: customEnd }
    : getPresetDates(activePreset);

  // Dashboard KPIs
  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: reportsApi.dashboard,
  });

  // Sales chart data
  const { data: salesData = [], isLoading: salesLoading } = useQuery({
    queryKey: ['reports-sales', startDate, endDate],
    queryFn: () => reportsApi.sales(startDate, endDate),
  });

  // Product performance
  const { data: productData = [], isLoading: productsLoading } = useQuery({
    queryKey: ['reports-products', startDate, endDate],
    queryFn: () => reportsApi.products(startDate, endDate),
  });

  // Losses stats (current month)
  const now = new Date();
  const { data: lossStats } = useQuery({
    queryKey: ['product-losses-stats', now.getMonth() + 1, now.getFullYear()],
    queryFn: () => productLossesApi.stats(now.getMonth() + 1, now.getFullYear()),
  });

  // Cost summary (Food / Labor / Prime Cost %) - loaded for Menu Engineering and Couts tabs
  const { data: costData, isLoading: costLoading } = useQuery({
    queryKey: ['reports-cost-summary', startDate, endDate],
    queryFn: () => reportsApi.costSummary(startDate, endDate),
    enabled: activeTab === 'menu' || activeTab === 'cost',
  });

  // Menu engineering matrix - only loaded when needed
  const { data: menuData, isLoading: menuLoading } = useQuery({
    queryKey: ['reports-menu-engineering', startDate, endDate],
    queryFn: () => reportsApi.menuEngineering(startDate, endDate),
    enabled: activeTab === 'menu',
  });

  const d = dashData || {
    todaySales: 0, todayRevenue: 0, avgSaleValue: 0, todayItemsSold: 0,
    topProducts: [], pendingOrders: 0, lowStockCount: 0,
  };

  const chartData = useMemo(() => salesData.map((item: { date: string; sales_count: string; revenue: string }) => ({
    date: format(new Date(item.date), 'dd MMM', { locale: fr }),
    commandes: parseInt(item.sales_count) || 0,
    revenue: parseFloat(item.revenue) || 0,
  })), [salesData]);

  // Compute totals for the period
  const periodTotals = useMemo(() => {
    const totalRevenue = chartData.reduce((sum: number, d: { revenue: number }) => sum + d.revenue, 0);
    const totalOrders = chartData.reduce((sum: number, d: { commandes: number }) => sum + d.commandes, 0);
    const avgRevenue = chartData.length > 0 ? totalRevenue / chartData.length : 0;
    return { totalRevenue, totalOrders, avgRevenue };
  }, [chartData]);

  // Top 5 for the medal display
  const topProducts = useMemo(() =>
    [...productData]
      .sort((a: { total_revenue: string }, b: { total_revenue: string }) => parseFloat(b.total_revenue) - parseFloat(a.total_revenue))
      .slice(0, 5),
    [productData]
  );

  const maxRevenue = topProducts.length > 0 ? parseFloat(topProducts[0].total_revenue) : 1;

  const handlePreset = (preset: DatePreset) => {
    setActivePreset(preset);
    if (preset !== 'custom') {
      const dates = getPresetDates(preset);
      setCustomStart(dates.start);
      setCustomEnd(dates.end);
    }
  };

  // Barre de période (style Apple) : partagée par l'analyse, les marges et le Menu Engineering.
  const fmtD = (iso: string) => format(new Date(iso + 'T00:00:00'), 'd MMM yyyy', { locale: fr });
  const periodBar = (
    <div className="kl-rep-period">
      <div className="prj-views" role="tablist" aria-label="Période">
        {presets.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={activePreset === p.key}
            className={activePreset === p.key ? 'active' : ''} onClick={() => handlePreset(p.key)}>{p.label}</button>
        ))}
      </div>
      {activePreset === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="Du" />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="Au" />
        </span>
      )}
      <small>{fmtD(startDate)} – {fmtD(endDate)}{activeTab === 'overview' ? ' · comparé à la période précédente' : ''}</small>
    </div>
  );

  // Ancien lien /reports?tab=cost : les coûts sont désormais un rapport de Production.
  if (!fixedTab && requested === 'cost') return <Navigate to="/production/costs" replace />;
  const current = tabs.find(t => t.key === activeTab)!;

  return (
    <SalesPageShell parent="Ventes" title={current.label} summary={current.subtitle}>
      <div className={activeTab === 'cost' ? undefined : 'prj kl-rep'} style={activeTab === 'cost' ? { display: 'flex', flexDirection: 'column', gap: 'var(--ds-s6)' } : undefined}>

      {activeTab !== 'cost' && activeTab !== 'builder' && periodBar}

      {/* ============ Tab: Vue d'ensemble ============ */}
      {activeTab === 'overview' && (
        <ReportsOverview
          d={d} dashLoading={dashLoading}
          chartData={chartData} salesLoading={salesLoading}
          periodTotals={periodTotals}
          productData={productData} productsLoading={productsLoading}
          topProducts={topProducts} maxRevenue={maxRevenue}
          lossStats={lossStats}
          startDate={startDate} endDate={endDate}
          activePreset={activePreset} presets={presets} onPreset={handlePreset}
          customStart={customStart} customEnd={customEnd} setCustomStart={setCustomStart} setCustomEnd={setCustomEnd}
        />
      )}

      {/* ============ Tab: Menu Engineering ============ */}
      {activeTab === 'menu' && (
        <MenuEngineeringTab
          costData={costData}
          costLoading={costLoading}
          menuData={menuData}
          menuLoading={menuLoading}
        />
      )}

      {/* ============ Tab: Marges (mig 317) ============ */}
      {activeTab === 'margins' && <MarginsTab from={startDate} to={endDate} />}

      {activeTab === 'builder' && <ReportBuilder />}

      {/* ============ Tab: Couts ============ */}
      {activeTab === 'cost' && (
        <CostTab
          costData={costData}
          costLoading={costLoading}
          lossStats={lossStats}
        />
      )}
      </div>
    </SalesPageShell>
  );
}

// ============================================================================
// Menu Engineering Tab
// ============================================================================
function MenuEngineeringTab({ costData, costLoading, menuData, menuLoading }: {
  costData: Awaited<ReturnType<typeof reportsApi.costSummary>> | undefined;
  costLoading: boolean;
  menuData: Awaited<ReturnType<typeof reportsApi.menuEngineering>> | undefined;
  menuLoading: boolean;
}) {
  const [filterClass, setFilterClass] = useState<MenuEngineeringClass | 'ALL'>('ALL');
  const [menuSearch, setMenuSearch] = useState('');
  const [menuSortCol, setMenuSortCol] = useState<string>('contribution');
  const [menuSortDir, setMenuSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleMenuSort = (col: string) => { if (menuSortCol === col) setMenuSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setMenuSortCol(col); setMenuSortDir('desc'); } };
  const MenuSortIcon = ({ col }: { col: string }) => menuSortCol === col ? <span style={{ marginLeft: 3, opacity: 0.7, fontSize: '0.625rem' }}>{menuSortDir === 'asc' ? '▲' : '▼'}</span> : <span style={{ marginLeft: 3, opacity: 0.2, fontSize: '0.625rem' }}>▼</span>;

  const items = menuData?.items ?? [];
  const counts = menuData?.counts ?? { STAR: 0, PUZZLE: 0, HORSE: 0, DOG: 0 };
  const median = menuData?.thresholds ?? { medianQty: 0, medianContribution: 0 };
  const missingCostCount = menuData?.missingCostCount ?? 0;

  const scatterByClass = useMemo(() => {
    const groups: Record<MenuEngineeringClass, Array<{ x: number; y: number; name: string; qty: number; contribution: number }>> = {
      STAR: [], PUZZLE: [], HORSE: [], DOG: [],
    };
    for (const it of items) {
      const qty = parseFloat(it.qty_sold) || 0;
      const contribution = parseFloat(it.total_contribution) || 0;
      groups[it.classification].push({ x: qty, y: contribution, name: it.name, qty, contribution });
    }
    return groups;
  }, [items]);

  const filteredItems = useMemo(() => {
    let list = filterClass === 'ALL' ? items : items.filter(it => it.classification === filterClass);
    if (menuSearch) { const s = menuSearch.toLowerCase(); list = list.filter(it => it.name.toLowerCase().includes(s) || (it.category || '').toLowerCase().includes(s)); }
    return [...list].sort((a, b) => {
      let va: any = '', vb: any = '';
      if (menuSortCol === 'name') { va = a.name; vb = b.name; }
      else if (menuSortCol === 'class') { va = a.classification; vb = b.classification; }
      else if (menuSortCol === 'qty') { va = parseFloat(a.qty_sold) || 0; vb = parseFloat(b.qty_sold) || 0; }
      else if (menuSortCol === 'revenue') { va = parseFloat(a.revenue) || 0; vb = parseFloat(b.revenue) || 0; }
      else if (menuSortCol === 'cost') { va = parseFloat(a.total_food_cost) || 0; vb = parseFloat(b.total_food_cost) || 0; }
      else if (menuSortCol === 'pct') { va = parseFloat(a.food_cost_pct) || 0; vb = parseFloat(b.food_cost_pct) || 0; }
      else if (menuSortCol === 'contribution') { va = parseFloat(a.total_contribution) || 0; vb = parseFloat(b.total_contribution) || 0; }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return menuSortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, filterClass, menuSearch, menuSortCol, menuSortDir]);

  const zone = (v: number, o: { greenMin?: number; greenMax: number; orangeMax: number }) => {
    if ((o.greenMin === undefined || v >= o.greenMin) && v <= o.greenMax) return { tone: 'green' as const, label: 'Optimal' };
    if (v <= o.orangeMax) return { tone: 'orange' as const, label: 'Acceptable' };
    return { tone: 'red' as const, label: 'Critique' };
  };
  const food = costData?.foodCostPct ?? 0, labor = costData?.laborCostPct ?? 0, prime = costData?.primeCostPct ?? 0;
  const zFood = zone(food, { greenMin: 25, greenMax: 30, orangeMax: 35 });
  const zLabor = zone(labor, { greenMax: 30, orangeMax: 35 });
  const zPrime = zone(prime, { greenMax: 60, orangeMax: 65 });
  const pctTxt = (v: number) => costLoading ? '…' : `${v.toFixed(1)} %`;
  const classes = ['STAR', 'PUZZLE', 'HORSE', 'DOG'] as MenuEngineeringClass[];

  return (
    <>
      {/* Coûts de la période */}
      <section className="prj-kpis" aria-label="Coûts">
        <ListKpi label="Coût matière" value={pctTxt(food)} sub={`${zFood.label} · cible 25–30 %`} tone={costLoading ? undefined : zFood.tone} />
        <ListKpi label="Coût main-d'œuvre" value={pctTxt(labor)} sub={`${zLabor.label} · cible < 30 %`} tone={costLoading ? undefined : zLabor.tone} />
        <ListKpi label="Coût primaire" value={pctTxt(prime)} sub={`${zPrime.label} · cible < 60 %`} tone={costLoading ? undefined : zPrime.tone} />
      </section>

      {missingCostCount > 0 && (
        <section className="kl-ar-rec">
          <span className="kl-ic o"><AlertTriangle size={16} /></span>
          <span className="tx">
            <b>{missingCostCount} produit{missingCostCount > 1 ? 's' : ''} sans coût défini</b>
            <small>Ces produits comptent pour 0 dans le coût matière. Ajoutez une recette ou un coût d'achat pour fiabiliser le rapport.</small>
          </span>
        </section>
      )}

      {/* Matrice : légende cliquable + nuage de points */}
      <section>
        <div className="kl-sec"><h2>Matrice produits</h2><small>Quantité vendue × contribution totale · seuils = médianes</small></div>
        <div className="kl-widget">
          <div className="kl-legend" style={{ marginBottom: 8 }}>
            {classes.map(cls => {
              const meta = CLASS_META[cls];
              const active = filterClass === cls;
              return (
                <button key={cls} type="button" aria-pressed={active} onClick={() => setFilterClass(active ? 'ALL' : cls)}
                  style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', ...(active ? { background: 'var(--theme-accent-light)' } : {}) }}>
                  <span className="l"><i style={{ background: meta.dot }} />{meta.label}</span>
                  <b style={{ display: 'block', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', marginTop: 2 }}>{counts[cls] || 0}</b>
                  <small style={{ fontSize: 12, color: 'var(--theme-text-muted)', lineHeight: 1.35, display: 'block' }}>{meta.advice}</small>
                </button>
              );
            })}
          </div>
          <div style={{ height: 340 }}>
            {menuLoading ? (
              <div className="kl-viz-empty">Chargement…</div>
            ) : items.length === 0 ? (
              <div className="kl-viz-empty">Aucune donnée pour cette période</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-bg-separator)" />
                  <XAxis type="number" dataKey="x" name="Quantité vendue"
                    tick={{ fontSize: 12, fill: 'var(--theme-text-muted)' }} axisLine={false} tickLine={false}
                    label={{ value: 'Quantité vendue', position: 'insideBottom', offset: -12, style: { fontSize: 12, fill: 'var(--theme-text-muted)' } }} />
                  <YAxis type="number" dataKey="y" name="Contribution" width={56}
                    tick={{ fontSize: 12, fill: 'var(--theme-text-muted)' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                    label={{ value: `Contribution (${currencySymbol()})`, angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: 'var(--theme-text-muted)' } }} />
                  <ZAxis range={[90, 90]} />
                  <ReferenceLine x={median.medianQty} stroke="var(--theme-text-muted)" strokeOpacity={0.4} strokeDasharray="4 4" />
                  <ReferenceLine y={median.medianContribution} stroke="var(--theme-text-muted)" strokeOpacity={0.4} strokeDasharray="4 4" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const p = payload[0].payload;
                      return (
                        <div style={{ background: 'var(--theme-bg-card)', borderRadius: 12, padding: '8px 12px', boxShadow: '0 8px 24px rgba(15,23,42,.12)', fontSize: 13 }}>
                          <b style={{ display: 'block' }}>{p.name}</b>
                          <span style={{ color: 'var(--theme-text-muted)' }}>{p.qty} vendus · {formatCurrency(p.contribution)}</span>
                        </div>
                      );
                    }}
                  />
                  {classes.map((cls) => (
                    <Scatter key={cls} name={CLASS_META[cls].label} data={filterClass === 'ALL' || filterClass === cls ? scatterByClass[cls] : []} fill={CLASS_META[cls].dot} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Détail par produit */}
      <section>
        <div className="kl-sec"><h2>Détail par produit</h2><small>{filteredItems.length} produit{filteredItems.length > 1 ? 's' : ''}</small></div>
        <div style={{ display: 'grid', gap: 12 }}>
          <ListToolbar search={menuSearch} onSearch={setMenuSearch} placeholder="Rechercher un produit ou une famille…" />
          <FilterChips label="Classification" value={filterClass} onChange={k => setFilterClass(k as MenuEngineeringClass | 'ALL')} chips={[
            { key: 'ALL', label: 'Tous', count: items.length },
            ...classes.map(c => ({ key: c, label: CLASS_META[c].label, count: counts[c] || 0 })),
          ]} />
          <DataPanel label="Détail par produit">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th onClick={() => toggleMenuSort('name')} style={{ cursor: 'pointer' }}>Produit<MenuSortIcon col="name" /></th>
                  <th onClick={() => toggleMenuSort('class')} style={{ cursor: 'pointer' }}>Classification<MenuSortIcon col="class" /></th>
                  <th className="ds-num" onClick={() => toggleMenuSort('qty')} style={{ cursor: 'pointer' }}>Vendus<MenuSortIcon col="qty" /></th>
                  <th className="ds-num" onClick={() => toggleMenuSort('revenue')} style={{ cursor: 'pointer' }}>CA ({currencySymbol()})<MenuSortIcon col="revenue" /></th>
                  <th className="ds-num" onClick={() => toggleMenuSort('cost')} style={{ cursor: 'pointer' }}>Coût matière ({currencySymbol()})<MenuSortIcon col="cost" /></th>
                  <th className="ds-num" onClick={() => toggleMenuSort('pct')} style={{ cursor: 'pointer' }}>% matière<MenuSortIcon col="pct" /></th>
                  <th className="ds-num" onClick={() => toggleMenuSort('contribution')} style={{ cursor: 'pointer' }}>Contribution ({currencySymbol()})<MenuSortIcon col="contribution" /></th>
                </tr>
              </thead>
              <tbody>
                {menuLoading ? (
                  <tr><td colSpan={7} className="kl-viz-empty">Chargement…</td></tr>
                ) : filteredItems.length === 0 ? (
                  <tr><td colSpan={7} className="kl-viz-empty">Aucune donnée</td></tr>
                ) : filteredItems.map((it) => {
                  const meta = CLASS_META[it.classification];
                  const foodPct = parseFloat(it.food_cost_pct) || 0;
                  return (
                    <tr key={it.product_id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {!it.has_cost_data && <span title="Aucun coût défini (ni recette ni coût d'achat)"><AlertTriangle size={14} style={{ color: 'var(--prj-orange)' }} /></span>}
                          <span>
                            <span className="ds-strong" style={{ display: 'block' }}>{it.name}</span>
                            {it.category && <small style={{ color: 'var(--theme-text-muted)' }}>{it.category}</small>}
                          </span>
                        </span>
                      </td>
                      <td><span className="kl-pill x" style={{ gap: 6 }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />{meta.label}</span></td>
                      <td className="ds-num">{parseFloat(it.qty_sold).toFixed(0)}</td>
                      <td className="ds-num">{amount(parseFloat(it.revenue) || 0)}</td>
                      <td className="ds-num">
                        {amount(parseFloat(it.total_food_cost) || 0)}
                        {it.has_cost_data && <small style={{ display: 'block', color: 'var(--theme-text-muted)' }}>{it.cost_from_production ? 'production réelle' : it.cost_from_recipe ? 'recette théorique' : 'coût manuel'}</small>}
                      </td>
                      <td className="ds-num">
                        {it.has_cost_data
                          ? <span className={foodPct > 35 ? 'kl-rep-tone-r' : foodPct > 30 ? 'kl-rep-tone-o' : 'kl-rep-tone-g'} style={{ fontWeight: 600 }}>{foodPct.toFixed(1)} %</span>
                          : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num ds-strong">{amount(parseFloat(it.total_contribution) || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
        </div>
      </section>
    </>
  );
}

// ============================================================================
// Couts Tab
// ============================================================================
/** Montant sans devise (la devise est dans l'en-tête de colonne). */
const amount = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTone = (pct: number) => pct > 35 ? 'var(--ds-danger)' : pct > 30 ? 'var(--ds-warning)' : 'var(--ds-success)';

function CostTab({ costData, costLoading, lossStats }: {
  costData: Awaited<ReturnType<typeof reportsApi.costSummary>> | undefined;
  costLoading: boolean;
  lossStats: any;
}) {
  const noCostPlans = costData
    ? costData.coverage.plansCompleted - costData.coverage.plansWithCost
    : 0;

  const [cbSearch, setCbSearch] = useState('');
  const [cbSource, setCbSource] = useState<'all' | 'production' | 'recipe' | 'manual' | 'none'>('all');
  const [cbSort, setCbSort] = useState<string>('revenue');
  const [cbSortDir, setCbSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleCbSort = (col: string) => { if (cbSort === col) setCbSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCbSort(col); setCbSortDir('desc'); } };
  const CbSortIcon = ({ col }: { col: string }) => cbSort === col ? <span style={{ marginLeft: 3, opacity: 0.7, fontSize: '0.625rem' }}>{cbSortDir === 'asc' ? '▲' : '▼'}</span> : <span style={{ marginLeft: 3, opacity: 0.2, fontSize: '0.625rem' }}>▼</span>;

  const displayedBreakdown = useMemo(() => {
    if (!costData) return [];
    let list = costData.breakdown;
    if (cbSearch) { const s = cbSearch.toLowerCase(); list = list.filter(it => it.name.toLowerCase().includes(s) || (it.category || '').toLowerCase().includes(s)); }
    if (cbSource === 'production') list = list.filter(it => it.cost_from_production);
    else if (cbSource === 'recipe') list = list.filter(it => !it.cost_from_production && it.cost_from_recipe);
    else if (cbSource === 'manual') list = list.filter(it => it.has_cost_data && !it.cost_from_production && !it.cost_from_recipe);
    else if (cbSource === 'none') list = list.filter(it => !it.has_cost_data);
    return [...list].sort((a, b) => {
      const ra = parseFloat(a.revenue) || 0, rb = parseFloat(b.revenue) || 0;
      const fca = parseFloat(a.food_cost) || 0, fcb = parseFloat(b.food_cost) || 0;
      let va: any = '', vb: any = '';
      if (cbSort === 'name') { va = a.name; vb = b.name; }
      else if (cbSort === 'qty') { va = parseFloat(a.qty_sold) || 0; vb = parseFloat(b.qty_sold) || 0; }
      else if (cbSort === 'revenue') { va = ra; vb = rb; }
      else if (cbSort === 'unit_cost') { va = parseFloat(a.unit_food_cost) || 0; vb = parseFloat(b.unit_food_cost) || 0; }
      else if (cbSort === 'food_cost') { va = fca; vb = fcb; }
      else if (cbSort === 'pct') { va = ra > 0 ? fca / ra : 0; vb = rb > 0 ? fcb / rb : 0; }
      else if (cbSort === 'margin') { va = ra - fca; vb = rb - fcb; }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return cbSortDir === 'asc' ? cmp : -cmp;
    });
  }, [costData, cbSearch, cbSource, cbSort, cbSortDir]);

  const cur = currencySymbol();
  const totRev = displayedBreakdown.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
  const totFc = displayedBreakdown.reduce((s, r) => s + (parseFloat(r.food_cost) || 0), 0);
  const totPct = totRev > 0 ? totFc / totRev * 100 : 0;
  const sortTh = (col: string, label: string, num = true) => (
    <th className={num ? 'ds-num' : undefined} onClick={() => toggleCbSort(col)} style={{ cursor: 'pointer', userSelect: 'none' }}
      aria-sort={cbSort === col ? (cbSortDir === 'asc' ? 'ascending' : 'descending') : undefined}>{label}<CbSortIcon col={col} /></th>
  );

  return (
    <>
      <CostKpisRow costData={costData} loading={costLoading} detailed />

      {/* Couverture plans : signaler les plans completes sans cout calcule */}
      {costData && costData.coverage.plansCompleted === 0 && (
        <Alert tone="info" icon={AlertTriangle}>
          <strong>Aucun plan de production terminé sur la période.</strong>{' '}
          Les coûts proviennent de production_cout_reel (plans complétés). Sans plan complété sur la période, les coûts sont à 0.
        </Alert>
      )}
      {costData && noCostPlans > 0 && (
        <Alert tone="warning" icon={AlertTriangle}>
          <strong>{noCostPlans} plan(s) sans coût réel calculé.</strong>{' '}
          {costData.coverage.plansWithCost}/{costData.coverage.plansCompleted} plans complétés ont leur coût enregistré. Lancer « Calculer coût réel » sur les autres pour fiabiliser le rapport.
        </Alert>
      )}

      {/* Décomposition */}
      <section>
        <SectionHeader title="Décomposition du coût primaire" note={`Montants en ${cur} · % des ventes nettes`} />
        <DataPanel>
          {costLoading || !costData ? (
            <LoadingState bare />
          ) : (
            <div style={{ padding: 'var(--ds-s5)', display: 'flex', flexDirection: 'column', gap: 'var(--ds-s4)' }}>
              <CostBar label="Coût matière" value={costData.foodCost} pct={costData.foodCostPct} sales={costData.netSales} color="var(--ds-info)" />
              <CostBar label="Coût main-d'œuvre" value={costData.laborCost} pct={costData.laborCostPct} sales={costData.netSales} color="var(--ds-accent)" />
              <div style={{ borderTop: '1px solid var(--ds-hair)', paddingTop: 'var(--ds-s4)' }}>
                <CostBar label="Coût primaire (matière + main-d'œuvre)" value={costData.primeCost} pct={costData.primeCostPct} sales={costData.netSales} color="var(--ds-success)" bold />
              </div>
              {(costData.energyCost > 0 || costData.packagingCost > 0 || costData.chargesCost > 0 || costData.subcontractingCost > 0 || costData.lossesCost > 0) && (
                <div style={{ borderTop: '1px solid var(--ds-hair)', paddingTop: 'var(--ds-s4)', display: 'flex', flexDirection: 'column', gap: 'var(--ds-s3)' }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)' }}>Composantes supplémentaires (coût de revient complet)</p>
                  <CostBar label="Coût énergie" value={costData.energyCost} pct={costData.energyCostPct} sales={costData.netSales} color="var(--ds-info)" />
                  {costData.packagingCost > 0 && <CostBar label="Coût emballages" value={costData.packagingCost} pct={costData.packagingCostPct} sales={costData.netSales} color="var(--ds-warning)" />}
                  {costData.chargesCost > 0 && <CostBar label="Charges indirectes" value={costData.chargesCost} pct={costData.chargesCostPct} sales={costData.netSales} color="var(--ds-muted)" />}
                  {costData.subcontractingCost > 0 && <CostBar label="Sous-traitance (façon)" value={costData.subcontractingCost} pct={costData.subcontractingCostPct} sales={costData.netSales} color="var(--ds-info)" />}
                  <CostBar label="Coût total (coût de revient : matière + emballages + main-d'œuvre + énergie + charges + façon)" value={costData.totalCost} pct={costData.totalCostPct} sales={costData.netSales} color="var(--ds-ink)" bold />
                  {costData.lossesCost > 0 && <CostBar label="dont pertes (déjà comptées dans la matière)" value={costData.lossesCost} pct={costData.lossesCostPct} sales={costData.netSales} color="var(--ds-danger)" />}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--ds-muted)', lineHeight: 1.6, background: 'var(--ds-bg)', borderRadius: 'var(--ds-r-field)', padding: 'var(--ds-s3)' }}>
                <p style={{ margin: 0 }}><strong>Source des coûts :</strong> coût de revient unifié des plans de production de la période (le même que la fiche du plan). Le coût matière par produit suit la répartition du plan entre ses articles.</p>
                <p style={{ margin: '4px 0 0' }}><strong>Formules :</strong> % = composante / ventes nettes. Coût primaire = matière + main-d'œuvre.</p>
                <p style={{ margin: '4px 0 0' }}><strong>Cibles :</strong> matière 25-30 %, main-d'œuvre &lt; 30 %, primaire &lt; 60 %.</p>
                <p style={{ margin: '4px 0 0' }}>
                  <strong>Couverture :</strong>{' '}
                  {costData.coverage.plansWithCost}/{costData.coverage.plansCompleted} plan(s) complété(s) ont leur coût réel calculé sur la période.
                </p>
              </div>
            </div>
          )}
        </DataPanel>
      </section>

      {/* Coût matière par produit vendu */}
      {costData && costData.breakdown.length > 0 && (
        <section>
          <SectionHeader title="Coût matière par produit vendu"
            note={`${displayedBreakdown.length !== costData.breakdown.length ? `${displayedBreakdown.length} / ${costData.breakdown.length}` : `${costData.breakdown.length}`} produit(s) · quantité vendue × coût unitaire`} />
          <Toolbar>
            <SearchBar value={cbSearch} onChange={setCbSearch} placeholder="Rechercher un produit…" />
            <SearchSelect
              options={[
                { id: 'production', label: 'Production réelle' },
                { id: 'recipe', label: 'Recette théorique' },
                { id: 'manual', label: 'Coût manuel' },
                { id: 'none', label: 'Sans coût' },
              ]}
              value={cbSource === 'all' ? '' : cbSource}
              onChange={id => setCbSource((id || 'all') as any)}
              placeholder="Toutes sources"
              width={190}
            />
          </Toolbar>
          <DataPanel label="Coût matière par produit">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  {sortTh('name', 'Produit', false)}
                  {sortTh('qty', 'Vendus')}
                  {sortTh('revenue', `Revenus (${cur})`)}
                  {sortTh('unit_cost', `Coût unitaire (${cur})`)}
                  {sortTh('food_cost', `Coût matière (${cur})`)}
                  {sortTh('pct', '% matière')}
                  {sortTh('margin', `Marge (${cur})`)}
                </tr>
              </thead>
              <tbody>
                {displayedBreakdown.map((it) => {
                  const revenue = parseFloat(it.revenue) || 0;
                  const foodCost = parseFloat(it.food_cost) || 0;
                  const unitCost = parseFloat(it.unit_food_cost) || 0;
                  const pct = revenue > 0 ? (foodCost / revenue) * 100 : 0;
                  const margin = revenue - foodCost;
                  return (
                    <tr key={it.product_id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {!it.has_cost_data && <span title="Aucun coût défini"><AlertTriangle size={14} style={{ color: 'var(--ds-warning)', flex: 'none' }} aria-label="Sans coût" /></span>}
                          <span>
                            <span className="ds-strong" style={{ display: 'block' }}>{it.name}</span>
                            {it.category && <small style={{ color: 'var(--ds-muted)' }}>{it.category}</small>}
                          </span>
                        </span>
                      </td>
                      <td className="ds-num">{parseFloat(it.qty_sold).toFixed(0)}</td>
                      <td className="ds-num">{amount(revenue)}</td>
                      <td className="ds-num">
                        {amount(unitCost)}
                        {it.has_cost_data && (
                          <small style={{ display: 'block', color: 'var(--ds-muted)' }}>
                            {it.cost_from_production ? 'production réelle' : it.cost_from_recipe ? 'recette théorique' : 'coût manuel'}
                          </small>
                        )}
                      </td>
                      <td className="ds-num">{amount(foodCost)}</td>
                      <td className="ds-num">
                        {it.has_cost_data
                          ? <span style={{ fontWeight: 600, color: pctTone(pct) }}>{pct.toFixed(1)} %</span>
                          : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num ds-strong">{amount(margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ds-strong">
                    Total{displayedBreakdown.length !== costData.breakdown.length ? ` (${displayedBreakdown.length}/${costData.breakdown.length})` : ''}
                  </td>
                  <td className="ds-num">{displayedBreakdown.reduce((s, r) => s + (parseFloat(r.qty_sold) || 0), 0).toFixed(0)}</td>
                  <td className="ds-num ds-strong">{amount(totRev)}</td>
                  <td />
                  <td className="ds-num ds-strong">{amount(totFc)}</td>
                  <td className="ds-num"><span style={{ fontWeight: 700, color: pctTone(totPct) }}>{totPct.toFixed(1)} %</span></td>
                  <td className="ds-num ds-strong">{amount(totRev - totFc)}</td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>
        </section>
      )}

      {/* Pertes du mois (lecture seule) */}
      {lossStats && (lossStats.topProducts as Record<string, any>[])?.length > 0 && (
        <section>
          <SectionHeader title="Pertes du mois" note="Impact sur le coût matière réel" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--ds-s4)' }}>
            <DataPanel label="Top produits perdus">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Top produits perdus</th><th className="ds-num">Coût ({cur})</th></tr></thead>
                <tbody>
                  {(lossStats.topProducts as Record<string, any>[]).slice(0, 5).map((p: Record<string, any>, i: number) => (
                    <tr key={p.id as string}>
                      <td><span style={{ color: 'var(--ds-muted)', marginRight: 8 }}>{i + 1}.</span>{p.name as string}</td>
                      <td className="ds-num ds-strong" style={{ color: 'var(--ds-danger)' }}>{amount(parseFloat(p.total_cost as string) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
            <DataPanel label="Motifs fréquents">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Motifs fréquents</th><th className="ds-num">Occurrences</th></tr></thead>
                <tbody>
                  {(lossStats.topReasons as Record<string, any>[]).slice(0, 5).map((r: Record<string, any>, i: number) => (
                    <tr key={i}>
                      <td>{String(r.reason)}</td>
                      <td className="ds-num">{r.count as number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </div>
        </section>
      )}
    </>
  );
}

// ============================================================================
// Shared: cost KPIs row (3 cards Food / Labor / Prime)
// ============================================================================
function CostKpisRow({ costData, loading, detailed = false }: {
  costData: Awaited<ReturnType<typeof reportsApi.costSummary>> | undefined;
  loading: boolean;
  detailed?: boolean;
}) {
  const food = costData?.foodCostPct ?? 0;
  const labor = costData?.laborCostPct ?? 0;
  const prime = costData?.primeCostPct ?? 0;

  const foodZone = getZone(food, { greenMin: 25, greenMax: 30, orangeMax: 35 });
  const laborZone = getZone(labor, { greenMax: 30, orangeMax: 35 });
  const primeZone = getZone(prime, { greenMax: 60, orangeMax: 65 });

  const cards = [
    { title: 'Coût matière', pct: food, value: costData?.foodCost ?? 0, zone: foodZone, target: 'cible 25-30 %', formula: 'Consommation / ventes' },
    { title: "Coût main-d'œuvre", pct: labor, value: costData?.laborCost ?? 0, zone: laborZone, target: 'cible < 30 %', formula: "Main-d'œuvre / ventes" },
    { title: 'Coût primaire', pct: prime, value: costData?.primeCost ?? 0, zone: primeZone, target: 'cible < 60 %', formula: "Matière + main-d'œuvre" },
  ];

  return (
    <KpiGrid label="Coûts">
      {cards.map((c) => (
        <KpiCard key={c.title} label={c.title} value={loading ? '…' : `${c.pct.toFixed(1)} %`}
          sub={`${c.zone.label} · ${c.target}`} tone={loading ? undefined : c.zone.tone}>
          {detailed && (
            <span style={{ display: 'block', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ds-hair)', fontSize: 12, color: 'var(--ds-muted)' }}>
              {c.formula} · <strong style={{ color: 'var(--ds-ink)' }}>{formatCurrency(c.value)}</strong>
            </span>
          )}
        </KpiCard>
      ))}
    </KpiGrid>
  );
}

function CostBar({ label, value, pct, sales, color, bold = false }: {
  label: string; value: number; pct: number; sales: number; color: string; bold?: boolean;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4, fontSize: 14 }}>
        <span style={{ fontWeight: bold ? 700 : 500, color: 'var(--ds-ink)' }}>{label}</span>
        <span style={{ color: 'var(--ds-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {amount(value)} / {amount(sales)}
          <span style={{ marginLeft: 12, fontWeight: bold ? 700 : 600, color: 'var(--ds-ink)' }}>{pct.toFixed(1)} %</span>
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--ds-hair)', borderRadius: 999, overflow: 'hidden' }}
        role="progressbar" aria-label={label} aria-valuenow={Math.round(Math.min(pct, 100))} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 999, transition: 'width .2s' }} />
      </div>
    </div>
  );
}
