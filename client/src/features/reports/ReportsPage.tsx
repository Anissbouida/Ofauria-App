import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi, type MenuEngineeringClass } from '../../api/reports.api';
import { productLossesApi } from '../../api/product-losses.api';
import { format, subDays, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, ShoppingCart, Banknote, Package, ClipboardList,
  AlertTriangle, Calendar, ArrowUpRight, ArrowDownRight, Crown, BarChart3,
  ChevronRight, LayoutDashboard, Sparkles, Wallet, Search, X,
} from 'lucide-react';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
type Tab = 'overview' | 'menu' | 'cost';

const tabs: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: "Vue d'ensemble", icon: LayoutDashboard },
  { key: 'menu', label: 'Menu Engineering', icon: Sparkles },
  { key: 'cost', label: 'Couts', icon: Wallet },
];

const CLASS_META: Record<MenuEngineeringClass, { label: string; color: string; bg: string; border: string; dot: string; advice: string }> = {
  STAR:   { label: 'Etoiles',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: '#10b981', advice: 'Mettre en avant, ne pas changer le prix' },
  PUZZLE: { label: 'Enigmes',     color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    dot: '#f43f5e', advice: 'Repositionner : visibilite menu, photo, suggestion serveur' },
  HORSE:  { label: 'Chevaux',     color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   dot: '#f59e0b', advice: 'Reduire le cout matiere ou augmenter le prix' },
  DOG:    { label: 'Poids morts', color: 'text-gray-700',    bg: 'bg-gray-50',    border: 'border-gray-200',    dot: '#9ca3af', advice: 'Refondre ou retirer du menu' },
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
  { key: 'custom', label: 'Personnalise' },
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
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
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

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Rapports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Vue d'ensemble, ingenierie de menu et couts</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar size={16} />
          <span>{format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}</span>
        </div>
      </div>

      {/* Tabs bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-1 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ============ Tab: Vue d'ensemble ============ */}
      {activeTab === 'overview' && (
      <>
      {/* KPI Cards - Today */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            title: "CA du jour",
            value: formatCurrency(d.todayRevenue),
            icon: Banknote,
            color: 'from-emerald-500 to-emerald-600',
            bgLight: 'bg-emerald-50',
            textColor: 'text-emerald-600',
          },
          {
            title: 'Ventes',
            value: String(d.todaySales),
            icon: ShoppingCart,
            color: 'from-blue-500 to-blue-600',
            bgLight: 'bg-blue-50',
            textColor: 'text-blue-600',
          },
          {
            title: 'Panier moyen',
            value: formatCurrency(d.avgSaleValue),
            icon: TrendingUp,
            color: 'from-violet-500 to-violet-600',
            bgLight: 'bg-violet-50',
            textColor: 'text-violet-600',
          },
          {
            title: 'Articles vendus',
            value: String(d.todayItemsSold),
            icon: Package,
            color: 'from-amber-500 to-amber-600',
            bgLight: 'bg-amber-50',
            textColor: 'text-amber-600',
          },
          {
            title: 'Commandes',
            value: String(d.pendingOrders),
            icon: ClipboardList,
            color: 'from-rose-500 to-rose-600',
            bgLight: 'bg-rose-50',
            textColor: 'text-rose-600',
            subtitle: 'en attente',
          },
        ].map((kpi) => (
          <div key={kpi.title} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${kpi.color} flex items-center justify-center`}>
                <kpi.icon size={20} className="text-white" />
              </div>
              {kpi.subtitle && (
                <span className="text-xs font-medium text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">{kpi.subtitle}</span>
              )}
            </div>
            <p className="text-2xl font-bold text-gray-800">{dashLoading ? '...' : kpi.value}</p>
            <p className="text-xs text-gray-400 mt-1">{kpi.title}</p>
          </div>
        ))}
      </div>

      {/* Stock alert banner */}
      {d.lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">{d.lowStockCount} ingredient(s) en stock bas</p>
            <p className="text-xs text-amber-600">Verifiez l'inventaire pour eviter les ruptures</p>
          </div>
          <ChevronRight size={18} className="text-amber-400" />
        </div>
      )}

      {/* Date filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex flex-wrap items-center gap-3">
        <BarChart3 size={18} className="text-gray-400" />
        <span className="text-sm font-medium text-gray-600 mr-1">Periode :</span>
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => handlePreset(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activePreset === p.key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {activePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            <span className="text-gray-400 text-xs">a</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue Chart - takes 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Chiffre d'affaires</h2>
              <p className="text-2xl font-bold text-gray-800 mt-1">{formatCurrency(periodTotals.totalRevenue)}</p>
              <p className="text-xs text-gray-400">Moyenne {formatCurrency(periodTotals.avgRevenue)} / jour</p>
            </div>
          </div>
          <div className="mt-4" style={{ height: 280 }}>
            {salesLoading ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">Chargement...</div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">Aucune donnee</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', fontSize: 13 }}
                    formatter={(value: number) => [formatCurrency(value), 'Revenus']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGradient)" dot={false} activeDot={{ r: 5, fill: '#10b981' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Orders Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="mb-1">
            <h2 className="text-sm font-semibold text-gray-700">Commandes</h2>
            <p className="text-2xl font-bold text-gray-800 mt-1">{periodTotals.totalOrders}</p>
            <p className="text-xs text-gray-400">sur la periode</p>
          </div>
          <div className="mt-4" style={{ height: 280 }}>
            {salesLoading ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">Chargement...</div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">Aucune donnee</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', fontSize: 13 }}
                    formatter={(value: number) => [value, 'Commandes']}
                  />
                  <Bar dataKey="commandes" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Top Products + Performance Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Top 5 Products Podium */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-5">
            <Crown size={18} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-700">Top produits</h2>
            <span className="text-xs text-gray-400 ml-auto">7 derniers jours</span>
          </div>
          {d.topProducts.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">Aucune vente</p>
          ) : (
            <div className="space-y-3">
              {d.topProducts.map((p: { id: string; name: string; total_sold: number; total_revenue: string }, i: number) => {
                const medals = ['bg-amber-100 text-amber-700', 'bg-gray-100 text-gray-600', 'bg-orange-50 text-orange-600'];
                const barWidth = (parseFloat(p.total_revenue) / maxRevenue) * 100;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${medals[i] || 'bg-gray-50 text-gray-500'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">{p.total_sold}</span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                      {formatCurrency(parseFloat(p.total_revenue))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Product Performance Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Performance des produits</h2>
            <span className="text-xs text-gray-400">{productData.length} produits</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                  <th className="text-left py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Categorie</th>
                  <th className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Vendus</th>
                  <th className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Revenus</th>
                  <th className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {productsLoading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">Chargement...</td></tr>
                ) : productData.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">Aucune donnee pour cette periode</td></tr>
                ) : (
                  productData.map((p: { id: string; name: string; category: string; total_sold: string; total_revenue: string }, idx: number) => {
                    const share = periodTotals.totalRevenue > 0
                      ? (parseFloat(p.total_revenue) / periodTotals.totalRevenue) * 100
                      : 0;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            {idx < 3 && (
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'
                              }`}>{idx + 1}</span>
                            )}
                            <span className="text-sm font-medium text-gray-800">{p.name}</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.category || '—'}</span>
                        </td>
                        <td className="py-3 text-right">
                          <span className="text-sm font-medium text-gray-700">{p.total_sold}</span>
                        </td>
                        <td className="py-3 text-right">
                          <span className="text-sm font-bold text-gray-800">{formatCurrency(parseFloat(p.total_revenue))}</span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(share, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">{share.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Losses: Top products + Top reasons */}
      {lossStats && (lossStats.topProducts as Record<string, any>[])?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
                <BarChart3 size={14} className="text-white" />
              </div>
              <h2 className="text-sm font-semibold text-gray-700">Top produits les plus perdus</h2>
              <span className="text-xs text-gray-400 ml-auto">Ce mois</span>
            </div>
            <div className="space-y-3">
              {(lossStats.topProducts as Record<string, any>[]).slice(0, 5).map((p: Record<string, any>, i: number) => {
                const cost = parseFloat(p.total_cost as string) || 0;
                const maxCost = parseFloat((lossStats.topProducts as Record<string, any>[])[0]?.total_cost as string) || 1;
                return (
                  <div key={p.id as string} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{p.name as string}</p>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-red-400 to-rose-500 rounded-full" style={{ width: `${(cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-red-600 whitespace-nowrap">{formatCurrency(cost)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <AlertTriangle size={14} className="text-white" />
              </div>
              <h2 className="text-sm font-semibold text-gray-700">Motifs de perte les plus frequents</h2>
              <span className="text-xs text-gray-400 ml-auto">Ce mois</span>
            </div>
            <div className="space-y-2.5">
              {(lossStats.topReasons as Record<string, any>[]).slice(0, 6).map((r: Record<string, any>, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                      {String(r.loss_type)}
                    </span>
                    <span className="text-sm text-gray-700">{String(r.reason)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{r.count as number}x</span>
                    <span className="text-sm font-bold text-gray-700">{formatCurrency(parseFloat(r.total_cost as string) || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
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

      {/* ============ Tab: Couts ============ */}
      {activeTab === 'cost' && (
        <CostTab
          costData={costData}
          costLoading={costLoading}
          lossStats={lossStats}
        />
      )}
    </div>
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

  return (
    <>
      {/* Cost KPIs banner */}
      <CostKpisRow costData={costData} loading={costLoading} />

      {/* Missing cost warning */}
      {missingCostCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {missingCostCount} produit{missingCostCount > 1 ? 's' : ''} sans cout defini
            </p>
            <p className="text-xs text-amber-600">
              Ces produits contribuent 0 au cout matiere. Ajoutez une recette ou un cout d'achat manuel pour fiabiliser le rapport.
            </p>
          </div>
        </div>
      )}

      {/* Matrix legend + counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(['STAR', 'PUZZLE', 'HORSE', 'DOG'] as MenuEngineeringClass[]).map((cls) => {
          const meta = CLASS_META[cls];
          const active = filterClass === cls;
          return (
            <button
              key={cls}
              onClick={() => setFilterClass(active ? 'ALL' : cls)}
              className={`text-left rounded-xl border p-4 transition-all ${meta.bg} ${meta.border} ${active ? 'ring-2 ring-blue-400' : 'hover:shadow-sm'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.dot }} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{counts[cls] || 0}</p>
              <p className="text-[11px] text-gray-500 mt-1 leading-tight">{meta.advice}</p>
            </button>
          );
        })}
      </div>

      {/* Scatter plot matrix */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Matrice produits</h2>
            <p className="text-xs text-gray-400">Quantite vendue (X) x Contribution totale (Y) — seuils = mediane</p>
          </div>
        </div>
        <div className="mt-3" style={{ height: 360 }}>
          {menuLoading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Chargement...</div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Aucune donnee pour cette periode</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" dataKey="x" name="Quantite vendue"
                  tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  label={{ value: 'Quantite vendue', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: '#9ca3af' } }} />
                <YAxis type="number" dataKey="y" name="Contribution"
                  tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  label={{ value: 'Contribution (DH)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                <ZAxis range={[80, 80]} />
                <ReferenceLine x={median.medianQty} stroke="#cbd5e1" strokeDasharray="4 4" />
                <ReferenceLine y={median.medianContribution} stroke="#cbd5e1" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', fontSize: 12 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="bg-white rounded-lg shadow-lg px-3 py-2 border border-gray-100">
                        <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                        <p className="text-xs text-gray-500">Qte: {p.qty}</p>
                        <p className="text-xs text-gray-500">Contribution: {formatCurrency(p.contribution)}</p>
                      </div>
                    );
                  }}
                />
                {(['STAR', 'PUZZLE', 'HORSE', 'DOG'] as MenuEngineeringClass[]).map((cls) => (
                  <Scatter key={cls} name={CLASS_META[cls].label} data={scatterByClass[cls]} fill={CLASS_META[cls].dot} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Classified table */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mr-1">Detail par produit</h2>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Rechercher produit..." value={menuSearch} onChange={e => setMenuSearch(e.target.value)}
              className="w-full pl-7 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {menuSearch && (
              <button onClick={() => setMenuSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>
            )}
          </div>
          {filterClass !== 'ALL' && (
            <button onClick={() => setFilterClass('ALL')} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
              {CLASS_META[filterClass].label} ×
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">{filteredItems.length} produit(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th onClick={() => toggleMenuSort('name')} className="text-left py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Produit<MenuSortIcon col="name" /></th>
                <th onClick={() => toggleMenuSort('class')} className="text-left py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Classification<MenuSortIcon col="class" /></th>
                <th onClick={() => toggleMenuSort('qty')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Vendus<MenuSortIcon col="qty" /></th>
                <th onClick={() => toggleMenuSort('revenue')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Revenus<MenuSortIcon col="revenue" /></th>
                <th onClick={() => toggleMenuSort('cost')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Cout matiere<MenuSortIcon col="cost" /></th>
                <th onClick={() => toggleMenuSort('pct')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">% matiere<MenuSortIcon col="pct" /></th>
                <th onClick={() => toggleMenuSort('contribution')} className="text-right py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none">Contribution<MenuSortIcon col="contribution" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {menuLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Chargement...</td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Aucune donnee</td></tr>
              ) : (
                filteredItems.map((it) => {
                  const meta = CLASS_META[it.classification];
                  const foodPct = parseFloat(it.food_cost_pct) || 0;
                  return (
                    <tr key={it.product_id} className={`hover:bg-gray-50/50 transition-colors ${!it.has_cost_data ? 'bg-amber-50/30' : ''}`}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {!it.has_cost_data && (
                            <span title="Aucun cout defini (ni recette ni cout d'achat manuel)">
                              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                            </span>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-800">{it.name}</p>
                            {it.category && <p className="text-xs text-gray-400">{it.category}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.bg} ${meta.color}`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-3 text-right text-sm text-gray-700">{parseFloat(it.qty_sold).toFixed(0)}</td>
                      <td className="py-3 text-right text-sm font-medium text-gray-800">{formatCurrency(parseFloat(it.revenue) || 0)}</td>
                      <td className="py-3 text-right">
                        <span className="text-sm text-gray-600">{formatCurrency(parseFloat(it.total_food_cost) || 0)}</span>
                        {it.has_cost_data && (
                          <span className="block text-[10px] text-gray-400">
                            {it.cost_from_production
                              ? 'production reelle'
                              : it.cost_from_recipe
                                ? 'recette theorique'
                                : 'cout manuel'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {it.has_cost_data ? (
                          <span className={`text-xs font-semibold ${foodPct > 35 ? 'text-rose-600' : foodPct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {foodPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right text-sm font-bold text-gray-800">{formatCurrency(parseFloat(it.total_contribution) || 0)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
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
            {(costData.energyCost > 0 || costData.lossesCost > 0) && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Composantes supplementaires (cout de revient complet)</p>
                <CostBar label="Cout energie" value={costData.energyCost} pct={costData.energyCostPct} sales={costData.netSales} color="bg-purple-500" />
                <CostBar label="Cout pertes" value={costData.lossesCost} pct={costData.lossesCostPct} sales={costData.netSales} color="bg-orange-500" />
                <CostBar label="Cout total (Matiere + Main d'oeuvre + Energie + Pertes)" value={costData.totalCost} pct={costData.totalCostPct} sales={costData.netSales} color="bg-gray-700" bold />
              </div>
            )}
            <div className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg p-3">
              <p><span className="font-semibold">Source des couts :</span> production_cout_reel — agregation des 4 composantes (matieres, main d'oeuvre, energie, pertes) calculees par plan de production sur la periode.</p>
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
              <select value={cbSource} onChange={e => setCbSource(e.target.value as any)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white text-gray-700">
                <option value="all">Toutes sources</option>
                <option value="production">Production reelle</option>
                <option value="recipe">Recette theorique</option>
                <option value="manual">Cout manuel</option>
                <option value="none">Sans cout</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
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
