import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.api';
import { productLossesApi } from '../../api/product-losses.api';
import { format, subDays, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
} from 'recharts';
import {
  TrendingUp, TrendingDown, ShoppingCart, Banknote, Package, ClipboardList,
  AlertTriangle, Calendar, ArrowUpRight, ArrowDownRight, Crown, BarChart3,
  ChevronRight,
} from 'lucide-react';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

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

  const d = dashData || {
    todaySales: 0, todayRevenue: 0, avgSaleValue: 0, todayItemsSold: 0,
    topProducts: [], pendingOrders: 0, lowStockCount: 0,
  };

  const chartData = useMemo(() => salesData.map((item: { date: string; orders: string; revenue: string }) => ({
    date: format(new Date(item.date), 'dd MMM', { locale: fr }),
    commandes: parseInt(item.orders),
    revenue: parseFloat(item.revenue),
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
          <h1 className="text-2xl font-bold text-gray-800">Tableau de bord</h1>
          <p className="text-sm text-gray-500 mt-0.5">Vue d'ensemble de votre activite</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar size={16} />
          <span>{format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}</span>
        </div>
      </div>

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
      {lossStats && (lossStats.topProducts as Record<string, unknown>[])?.length > 0 && (
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
              {(lossStats.topProducts as Record<string, unknown>[]).slice(0, 5).map((p: Record<string, unknown>, i: number) => {
                const cost = parseFloat(p.total_cost as string) || 0;
                const maxCost = parseFloat((lossStats.topProducts as Record<string, unknown>[])[0]?.total_cost as string) || 1;
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
              {(lossStats.topReasons as Record<string, unknown>[]).slice(0, 6).map((r: Record<string, unknown>, i: number) => (
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
    </div>
  );
}
