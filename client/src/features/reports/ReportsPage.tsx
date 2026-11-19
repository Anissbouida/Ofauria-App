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
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { TrendingUp, ShoppingCart, Banknote, Package, ClipboardList, AlertTriangle, ArrowUpRight, ArrowDownRight, Crown, BarChart3, ChevronRight, Search, X } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, ListToolbar, ListPanel, FilterChips } from '../sales/ListTemplate';

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

const CLASS_META: Record<MenuEngineeringClass, { label: string; color: string; bg: string; border: string; dot: string; advice: string }> = {
  STAR:   { label: 'Étoiles',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: '#15803D', advice: 'Mettre en avant, ne pas changer le prix' },
  PUZZLE: { label: 'Énigmes',     color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    dot: 'var(--theme-accent)', advice: 'Repositionner : visibilité, photo, suggestion en caisse' },
  HORSE:  { label: 'Chevaux',     color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   dot: '#B45309', advice: 'Réduire le coût matière ou augmenter le prix' },
  DOG:    { label: 'Poids morts', color: 'text-gray-700',    bg: 'bg-gray-50',    border: 'border-gray-200',    dot: '#94A3B8', advice: 'Refondre ou retirer de la carte' },
};

function getZoneColor(value: number, opts: { greenMax?: number; greenMin?: number; orangeMax: number }): { text: string; bg: string; ring: string; label: string } {
  if (opts.greenMin !== undefined && opts.greenMax !== undefined) {
    if (value >= opts.greenMin && value <= opts.greenMax) return { text: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-200', label: 'Optimal' };
  } else if (opts.greenMax !== undefined && value <= opts.greenMax) {
    return { text: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-200', label: 'Optimal' };
  }
  if (value <= opts.orangeMax) return { text: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-200', label: 'Acceptable' };
  return { text: 'text-rose-600', bg: 'bg-rose-50', ring: 'ring-rose-200', label: 'Critique' };
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

function ChangeIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return null;
  const isPositive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
      {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
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
      <div className={activeTab === 'cost' ? 'space-y-6 max-w-7xl mx-auto' : 'prj kl-rep'}>

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
          <ListPanel>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th onClick={() => toggleMenuSort('name')} style={{ cursor: 'pointer' }}>Produit<MenuSortIcon col="name" /></th>
                  <th onClick={() => toggleMenuSort('class')} style={{ cursor: 'pointer' }}>Classification<MenuSortIcon col="class" /></th>
                  <th onClick={() => toggleMenuSort('qty')} style={{ cursor: 'pointer', textAlign: 'right' }}>Vendus<MenuSortIcon col="qty" /></th>
                  <th onClick={() => toggleMenuSort('revenue')} style={{ cursor: 'pointer', textAlign: 'right' }}>CA<MenuSortIcon col="revenue" /></th>
                  <th onClick={() => toggleMenuSort('cost')} style={{ cursor: 'pointer', textAlign: 'right' }}>Coût matière<MenuSortIcon col="cost" /></th>
                  <th onClick={() => toggleMenuSort('pct')} style={{ cursor: 'pointer', textAlign: 'right' }}>% matière<MenuSortIcon col="pct" /></th>
                  <th onClick={() => toggleMenuSort('contribution')} style={{ cursor: 'pointer', textAlign: 'right' }}>Contribution<MenuSortIcon col="contribution" /></th>
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
                            <b style={{ fontWeight: 500, display: 'block' }}>{it.name}</b>
                            {it.category && <small style={{ color: 'var(--theme-text-muted)' }}>{it.category}</small>}
                          </span>
                        </span>
                      </td>
                      <td><span className="kl-pill x" style={{ gap: 6 }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: meta.dot, display: 'inline-block' }} />{meta.label}</span></td>
                      <td style={{ textAlign: 'right' }}>{parseFloat(it.qty_sold).toFixed(0)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(parseFloat(it.revenue) || 0)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCurrency(parseFloat(it.total_food_cost) || 0)}
                        {it.has_cost_data && <small style={{ display: 'block', color: 'var(--theme-text-muted)' }}>{it.cost_from_production ? 'production réelle' : it.cost_from_recipe ? 'recette théorique' : 'coût manuel'}</small>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {it.has_cost_data
                          ? <span className={foodPct > 35 ? 'kl-rep-tone-r' : foodPct > 30 ? 'kl-rep-tone-o' : 'kl-rep-tone-g'} style={{ fontWeight: 600 }}>{foodPct.toFixed(1)} %</span>
                          : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(it.total_contribution) || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ListPanel>
        </div>
      </section>
    </>
  );
}

// ============================================================================
// Couts Tab
// ============================================================================
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

  return (
    <>
      <CostKpisRow costData={costData} loading={costLoading} detailed />

      {/* Couverture plans : signaler les plans completes sans cout calcule */}
      {costData && costData.coverage.plansCompleted === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800">Aucun plan de production termine sur la periode</p>
            <p className="text-xs text-blue-600">
              Les couts proviennent de production_cout_reel (plans completes). Sans plan complete sur la periode, les couts sont a 0.
            </p>
          </div>
        </div>
      )}
      {costData && noCostPlans > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {noCostPlans} plan(s) sans cout reel calcule
            </p>
            <p className="text-xs text-amber-600">
              {costData.coverage.plansWithCost}/{costData.coverage.plansCompleted} plans completes ont leur cout enregistre. Lancer "Calculer cout reel" sur les autres pour fiabiliser le rapport.
            </p>
          </div>
        </div>
      )}

      {/* Breakdown card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Decomposition du Cout primaire</h2>
        {costLoading || !costData ? (
          <p className="text-sm text-gray-400">Chargement...</p>
        ) : (
          <div className="space-y-4">
            <CostBar label="Cout matiere" value={costData.foodCost} pct={costData.foodCostPct} sales={costData.netSales} color="bg-blue-500" />
            <CostBar label="Cout main d'oeuvre" value={costData.laborCost} pct={costData.laborCostPct} sales={costData.netSales} color="bg-rose-500" />
            <div className="border-t border-gray-100 pt-4">
              <CostBar label="Cout primaire (Matiere + Main d'oeuvre)" value={costData.primeCost} pct={costData.primeCostPct} sales={costData.netSales} color="bg-emerald-500" bold />
            </div>
            {(costData.energyCost > 0 || costData.packagingCost > 0 || costData.chargesCost > 0 || costData.subcontractingCost > 0 || costData.lossesCost > 0) && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Composantes supplementaires (cout de revient complet)</p>
                <CostBar label="Cout energie" value={costData.energyCost} pct={costData.energyCostPct} sales={costData.netSales} color="bg-purple-500" />
                {costData.packagingCost > 0 && <CostBar label="Cout emballages" value={costData.packagingCost} pct={costData.packagingCostPct} sales={costData.netSales} color="bg-amber-500" />}
                {costData.chargesCost > 0 && <CostBar label="Charges indirectes" value={costData.chargesCost} pct={costData.chargesCostPct} sales={costData.netSales} color="bg-slate-500" />}
                {costData.subcontractingCost > 0 && <CostBar label="Sous-traitance (facon)" value={costData.subcontractingCost} pct={costData.subcontractingCostPct} sales={costData.netSales} color="bg-cyan-600" />}
                <CostBar label="Cout total (cout de revient : matiere + emballages + main d'oeuvre + energie + charges + facon)" value={costData.totalCost} pct={costData.totalCostPct} sales={costData.netSales} color="bg-gray-700" bold />
                {costData.lossesCost > 0 && <CostBar label="dont pertes (deja comptees dans la matiere)" value={costData.lossesCost} pct={costData.lossesCostPct} sales={costData.netSales} color="bg-orange-500" />}
              </div>
            )}
            <div className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg p-3">
              <p><span className="font-semibold">Source des couts :</span> cout de revient unifie des plans de production de la periode (le meme que la fiche du plan). Le cout matiere par produit suit la repartition du plan entre ses articles.</p>
              <p className="mt-1"><span className="font-semibold">Formules :</span> % = composante / Ventes nettes. Cout primaire = Matiere + Main d'oeuvre.</p>
              <p className="mt-1"><span className="font-semibold">Cibles :</span> Matiere 25-30%, Main d'oeuvre &lt;30%, Primaire &lt;60%.</p>
              <p className="mt-1">
                <span className="font-semibold">Couverture :</span>{' '}
                {costData.coverage.plansWithCost}/{costData.coverage.plansCompleted} plan(s) complete(s) ont leur cout reel calcule sur la periode.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Per-product breakdown — cost matched to actual sales */}
      {costData && costData.breakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Cout matiere par produit vendu</h2>
                <p className="text-xs text-gray-400">Chaque ligne : qty_vendue x cout_unitaire (source production reelle si dispo)</p>
              </div>
              <span className="text-xs text-gray-400 ml-4 whitespace-nowrap">
                {displayedBreakdown.length !== costData.breakdown.length ? `${displayedBreakdown.length} / ${costData.breakdown.length}` : `${costData.breakdown.length}`} produit(s)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Rechercher produit..." value={cbSearch} onChange={e => setCbSearch(e.target.value)}
                  className="w-full pl-7 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200" />
                {cbSearch && (
                  <button onClick={() => setCbSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>
                )}
              </div>
              <SearchSelect
                options={[
                  { id: 'production', label: 'Production reelle' },
                  { id: 'recipe', label: 'Recette theorique' },
                  { id: 'manual', label: 'Cout manuel' },
                  { id: 'none', label: 'Sans cout' },
                ]}
                value={cbSource === 'all' ? '' : cbSource}
                onChange={id => setCbSource((id || 'all') as any)}
                placeholder="Toutes sources"
                width={190}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="odoo-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <th onClick={() => toggleCbSort('name')} className="text-left py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Produit<CbSortIcon col="name" /></th>
                  <th onClick={() => toggleCbSort('qty')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Vendus<CbSortIcon col="qty" /></th>
                  <th onClick={() => toggleCbSort('revenue')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Revenus<CbSortIcon col="revenue" /></th>
                  <th onClick={() => toggleCbSort('unit_cost')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Cout unitaire<CbSortIcon col="unit_cost" /></th>
                  <th onClick={() => toggleCbSort('food_cost')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Cout matiere<CbSortIcon col="food_cost" /></th>
                  <th onClick={() => toggleCbSort('pct')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">% matiere<CbSortIcon col="pct" /></th>
                  <th onClick={() => toggleCbSort('margin')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Marge<CbSortIcon col="margin" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayedBreakdown.map((it) => {
                  const revenue = parseFloat(it.revenue) || 0;
                  const foodCost = parseFloat(it.food_cost) || 0;
                  const unitCost = parseFloat(it.unit_food_cost) || 0;
                  const pct = revenue > 0 ? (foodCost / revenue) * 100 : 0;
                  const margin = revenue - foodCost;
                  return (
                    <tr key={it.product_id} className={`hover:bg-gray-50/50 ${!it.has_cost_data ? 'bg-amber-50/30' : ''}`}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {!it.has_cost_data && <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />}
                          <div>
                            <p className="text-sm font-medium text-gray-800">{it.name}</p>
                            {it.category && <p className="text-xs text-gray-400">{it.category}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right text-sm text-gray-700">{parseFloat(it.qty_sold).toFixed(0)}</td>
                      <td className="py-3 text-right text-sm font-medium text-gray-800">{formatCurrency(revenue)}</td>
                      <td className="py-3 text-right">
                        <span className="text-sm text-gray-700">{formatCurrency(unitCost)}</span>
                        {it.has_cost_data && (
                          <span className="block text-[10px] text-gray-400">
                            {it.cost_from_production ? 'production reelle' : it.cost_from_recipe ? 'recette theorique' : 'cout manuel'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right text-sm text-gray-600">{formatCurrency(foodCost)}</td>
                      <td className="py-3 text-right">
                        {it.has_cost_data ? (
                          <span className={`text-xs font-semibold ${pct > 35 ? 'text-rose-600' : pct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {pct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right text-sm font-bold text-gray-800">{formatCurrency(margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-bold">
                  <td className="py-3 text-sm text-gray-800">
                    Total{displayedBreakdown.length !== costData.breakdown.length ? ` (${displayedBreakdown.length}/${costData.breakdown.length})` : ''}
                  </td>
                  <td className="py-3 text-right text-sm text-gray-700">
                    {displayedBreakdown.reduce((s, r) => s + (parseFloat(r.qty_sold) || 0), 0).toFixed(0)}
                  </td>
                  <td className="py-3 text-right text-sm text-gray-800">
                    {formatCurrency(displayedBreakdown.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0))}
                  </td>
                  <td className="py-3"></td>
                  <td className="py-3 text-right text-sm text-gray-700">
                    {formatCurrency(displayedBreakdown.reduce((s, r) => s + (parseFloat(r.food_cost) || 0), 0))}
                  </td>
                  <td className="py-3 text-right">
                    {(() => {
                      const rev = displayedBreakdown.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
                      const fc = displayedBreakdown.reduce((s, r) => s + (parseFloat(r.food_cost) || 0), 0);
                      const pct = rev > 0 ? fc / rev * 100 : 0;
                      return <span className={`text-xs font-bold ${pct > 35 ? 'text-rose-600' : pct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>{pct.toFixed(1)}%</span>;
                    })()}
                  </td>
                  <td className="py-3 text-right text-sm text-gray-800">
                    {formatCurrency(displayedBreakdown.reduce((s, r) => s + ((parseFloat(r.revenue) || 0) - (parseFloat(r.food_cost) || 0)), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Losses surface in Couts tab too (read-only summary from monthly stats) */}
      {lossStats && (lossStats.topProducts as Record<string, any>[])?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <AlertTriangle size={14} className="text-white" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700">Pertes du mois</h2>
            <span className="text-xs text-gray-400 ml-auto">Impact sur food cost reel</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Top produits perdus</p>
              <div className="space-y-2">
                {(lossStats.topProducts as Record<string, any>[]).slice(0, 5).map((p: Record<string, any>, i: number) => (
                  <div key={p.id as string} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate"><span className="text-gray-400 mr-2">{i + 1}.</span>{p.name as string}</span>
                    <span className="font-bold text-red-600 ml-2">{formatCurrency(parseFloat(p.total_cost as string) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Motifs frequents</p>
              <div className="space-y-2">
                {(lossStats.topReasons as Record<string, any>[]).slice(0, 5).map((r: Record<string, any>, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate">{String(r.reason)}</span>
                    <span className="text-gray-500 ml-2">{r.count as number}x</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
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

  const foodZone = getZoneColor(food, { greenMin: 25, greenMax: 30, orangeMax: 35 });
  const laborZone = getZoneColor(labor, { greenMax: 30, orangeMax: 35 });
  const primeZone = getZoneColor(prime, { greenMax: 60, orangeMax: 65 });

  const cards = [
    { title: 'Cout matiere', pct: food, value: costData?.foodCost ?? 0, zone: foodZone, target: 'Cible 25-30%', formula: 'Consommation / Ventes' },
    { title: "Cout main d'oeuvre", pct: labor, value: costData?.laborCost ?? 0, zone: laborZone, target: 'Cible <30%', formula: "Main d'oeuvre / Ventes" },
    { title: 'Cout primaire', pct: prime, value: costData?.primeCost ?? 0, zone: primeZone, target: 'Cible <60%', formula: "Matiere + Main d'oeuvre" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.title} className={`bg-white rounded-xl border border-gray-100 p-5 ring-1 ${c.zone.ring}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{c.title}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.zone.bg} ${c.zone.text}`}>{c.zone.label}</span>
          </div>
          <p className={`text-3xl font-bold mt-2 ${c.zone.text}`}>{loading ? '…' : c.pct.toFixed(1) + '%'}</p>
          <p className="text-xs text-gray-400 mt-1">{c.target}</p>
          {detailed && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">{c.formula}</p>
              <p className="text-sm font-semibold text-gray-700 mt-0.5">{formatCurrency(c.value)}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CostBar({ label, value, pct, sales, color, bold = false }: {
  label: string; value: number; pct: number; sales: number; color: string; bold?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm ${bold ? 'font-bold text-gray-800' : 'font-medium text-gray-700'}`}>{label}</span>
        <span className="text-sm text-gray-500">
          {formatCurrency(value)} <span className="text-gray-400">/ {formatCurrency(sales)}</span>
          <span className={`ml-3 ${bold ? 'font-bold text-gray-800' : 'font-semibold text-gray-700'}`}>{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
