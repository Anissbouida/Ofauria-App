import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { productionCoutApi } from '../../api/production-cout.api';
import { useAuth } from '../../context/AuthContext';
import {
  TrendingUp, TrendingDown, DollarSign, Scale, Package, Users, Zap,
  AlertTriangle, Calendar, BarChart3, PieChart, Loader2
} from 'lucide-react';
import { format, subDays } from 'date-fns';

export default function ProductionDashboardPage() {
  const { user } = useAuth();
  const storeId = user?.storeId || '';
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const dateFrom = format(subDays(new Date(), period === '7d' ? 7 : period === '30d' ? 30 : 90), 'yyyy-MM-dd');
  const dateTo = format(new Date(), 'yyyy-MM-dd');

  const { data: rendementStats, isLoading: loadingRendement } = useQuery({
    queryKey: ['rendement-stats', storeId, dateFrom, dateTo],
    queryFn: () => productionEtapesApi.rendementStats(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: rendementByProduct = [], isLoading: loadingByProduct } = useQuery({
    queryKey: ['rendement-by-product', storeId, dateFrom, dateTo],
    queryFn: () => productionEtapesApi.rendementByProduct(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: coutStats, isLoading: loadingCout } = useQuery({
    queryKey: ['cout-stats', storeId, dateFrom, dateTo],
    queryFn: () => productionCoutApi.costStats(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: coutByDay = [], isLoading: loadingByDay } = useQuery({
    queryKey: ['cout-by-day', storeId, dateFrom, dateTo],
    queryFn: () => productionCoutApi.costByDay(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const formatDH = (val: unknown) => {
    const n = parseFloat(String(val));
    if (isNaN(n)) return '—';
    return `${n.toFixed(2)} DH`;
  };

  const isLoading = loadingRendement || loadingCout;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard Production</h1>
          <p className="text-sm text-gray-500">Rendement et couts de production</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${period === p ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {p === '7d' ? '7 jours' : p === '30d' ? '30 jours' : '90 jours'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Chargement...
        </div>
      )}

      {!isLoading && (
        <>
          {/* ═══ Summary Cards ═══ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={<Scale size={18} className="text-violet-500" />} label="Rendement moyen"
              value={rendementStats?.avg_rendement ? `${parseFloat(rendementStats.avg_rendement).toFixed(1)}%` : '—'}
              color={parseFloat(rendementStats?.avg_rendement || '0') >= 85 ? 'emerald' : 'amber'}
              sub={`${rendementStats?.total_items || 0} items`} />
            <StatCard icon={<AlertTriangle size={18} className="text-red-500" />} label="Total pertes"
              value={rendementStats?.total_pertes ? parseFloat(rendementStats.total_pertes).toFixed(0) : '0'}
              color="red"
              sub={`Brut: ${parseFloat(rendementStats?.total_brute || '0').toFixed(0)} → Net: ${parseFloat(rendementStats?.total_nette || '0').toFixed(0)}`} />
            <StatCard icon={<DollarSign size={18} className="text-amber-500" />} label="Cout total"
              value={formatDH(coutStats?.total_cout)}
              color="amber"
              sub={`${coutStats?.total_plans || 0} plans`} />
            <StatCard icon={<TrendingUp size={18} className="text-emerald-500" />} label="Ecart moyen"
              value={coutStats?.avg_ecart_pct ? `${parseFloat(coutStats.avg_ecart_pct) > 0 ? '+' : ''}${parseFloat(coutStats.avg_ecart_pct).toFixed(1)}%` : '—'}
              color={parseFloat(coutStats?.avg_ecart_pct || '0') <= 5 ? 'emerald' : 'red'}
              sub="Prevu vs Reel" />
          </div>

          {/* ═══ Cost breakdown cards ═══ */}
          {coutStats && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
                <PieChart size={16} className="text-amber-500" /> Repartition des couts
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <CostBar label="Matieres" icon={<Package size={12} />} value={parseFloat(coutStats.total_matieres || '0')}
                  total={parseFloat(coutStats.total_cout || '1')} color="amber" />
                <CostBar label="Main d'oeuvre" icon={<Users size={12} />} value={parseFloat(coutStats.total_main_oeuvre || '0')}
                  total={parseFloat(coutStats.total_cout || '1')} color="blue" />
                <CostBar label="Energie" icon={<Zap size={12} />} value={parseFloat(coutStats.total_energie || '0')}
                  total={parseFloat(coutStats.total_cout || '1')} color="violet" />
                <CostBar label="Pertes" icon={<AlertTriangle size={12} />} value={parseFloat(coutStats.total_pertes || '0')}
                  total={parseFloat(coutStats.total_cout || '1')} color="red" />
              </div>
            </div>
          )}

          {/* ═══ Rendement by product ═══ */}
          {rendementByProduct.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
                <BarChart3 size={16} className="text-violet-500" />
                <h2 className="font-semibold text-gray-900 text-sm">Rendement par produit</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5">Produit</th>
                      <th className="text-center px-3 py-2.5">Productions</th>
                      <th className="text-center px-3 py-2.5">Rendement moy.</th>
                      <th className="text-center px-3 py-2.5">Pertes</th>
                      <th className="text-center px-3 py-2.5">Vers magasin</th>
                      <th className="text-center px-3 py-2.5">Vers frigo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rendementByProduct.map((r: any, i: number) => {
                      const avgR = parseFloat(r.avg_rendement);
                      return (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="px-5 py-2.5 font-medium text-gray-900">{r.product_name}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{r.nb_productions}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${avgR >= 85 ? 'bg-emerald-50 text-emerald-700' : avgR >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                              {avgR >= 85 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                              {avgR.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-red-600">{parseFloat(r.total_pertes).toFixed(0)}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{parseFloat(r.total_vers_magasin).toFixed(0)}</td>
                          <td className="px-3 py-2.5 text-center text-cyan-600">{parseFloat(r.total_vers_frigo).toFixed(0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ Cost by day ═══ */}
          {coutByDay.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
                <Calendar size={16} className="text-amber-500" />
                <h2 className="font-semibold text-gray-900 text-sm">Couts par jour</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5">Date</th>
                      <th className="text-right px-3 py-2.5">Matieres</th>
                      <th className="text-right px-3 py-2.5">M.O.</th>
                      <th className="text-right px-3 py-2.5">Energie</th>
                      <th className="text-right px-3 py-2.5">Pertes</th>
                      <th className="text-right px-5 py-2.5 font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coutByDay.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-2.5 text-gray-900">{format(new Date(d.plan_date), 'dd/MM/yyyy')}</td>
                        <td className="px-3 py-2.5 text-right text-amber-600">{formatDH(d.matieres)}</td>
                        <td className="px-3 py-2.5 text-right text-blue-600">{formatDH(d.main_oeuvre)}</td>
                        <td className="px-3 py-2.5 text-right text-violet-600">{formatDH(d.energie)}</td>
                        <td className="px-3 py-2.5 text-right text-red-600">{formatDH(d.pertes)}</td>
                        <td className="px-5 py-2.5 text-right font-bold text-gray-900">{formatDH(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color, sub }: {
  icon: React.ReactNode; label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-gray-500 uppercase">{label}</span>
      </div>
      <div className={`text-2xl font-bold text-${color}-600`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function CostBar({ label, icon, value, total, color }: {
  label: string; icon: React.ReactNode; value: number; total: number; color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600 flex items-center gap-1">{icon} {label}</span>
        <span className="text-xs font-bold text-gray-700">{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full bg-${color}-500 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">{value.toFixed(2)} DH</div>
    </div>
  );
}
