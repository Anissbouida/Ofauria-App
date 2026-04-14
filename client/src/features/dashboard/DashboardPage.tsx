import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.api';
import { DollarSign, ShoppingCart, TrendingUp, Package, AlertTriangle, ClipboardList, Trash2 } from 'lucide-react';

function KPICard({ title, value, icon: Icon, color }: { title: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: reportsApi.dashboard });

  if (isLoading) return <div className="text-center py-12 text-gray-500">Chargement du tableau de bord...</div>;

  const d = data || { todaySales: 0, todayRevenue: 0, avgSaleValue: 0, todayItemsSold: 0, topProducts: [], pendingOrders: 0, lowStockCount: 0, todayLossCount: 0, todayLossCost: 0, todayLossQuantity: 0, monthlyLossCost: 0, monthlyLossQuantity: 0, topLossProducts: [] };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-bakery-chocolate">Tableau de bord</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard title="Chiffre d'affaires du jour" value={`${d.todayRevenue.toFixed(2)} DH`} icon={DollarSign} color="bg-green-500" />
        <KPICard title="Ventes du jour" value={String(d.todaySales)} icon={ShoppingCart} color="bg-blue-500" />
        <KPICard title="Panier moyen" value={`${d.avgSaleValue.toFixed(2)} DH`} icon={TrendingUp} color="bg-primary-500" />
        <KPICard title="Articles vendus" value={String(d.todayItemsSold)} icon={Package} color="bg-purple-500" />
        <KPICard title="Commandes en attente" value={String(d.pendingOrders)} icon={ClipboardList} color="bg-amber-500" />
        <KPICard title="Pertes du jour" value={`${(d.todayLossCost || 0).toFixed(2)} DH`} icon={Trash2} color="bg-red-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Produits les plus vendus (7 derniers jours)</h2>
          {d.topProducts.length === 0 ? (
            <p className="text-gray-400 text-sm">Aucune vente pour le moment</p>
          ) : (
            <div className="space-y-3">
              {d.topProducts.map((p: { id: string; name: string; total_sold: number; total_revenue: string }, i: number) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-primary-600 w-6">{i + 1}</span>
                    <span className="font-medium">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-gray-500">{p.total_sold} vendus</span>
                    <span className="text-sm font-medium text-green-600 ml-3">{parseFloat(p.total_revenue).toFixed(2)} DH</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Trash2 size={18} className="text-red-500" />
            Pertes
          </h2>
          {/* Résumé du jour et du mois */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-red-700">{(d.todayLossCost || 0).toFixed(2)} DH</div>
              <div className="text-[11px] text-red-500 font-medium">Aujourd'hui ({d.todayLossCount || 0})</div>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-orange-700">{(d.monthlyLossCost || 0).toFixed(2)} DH</div>
              <div className="text-[11px] text-orange-500 font-medium">Ce mois</div>
            </div>
          </div>
          {/* Top produits perdus */}
          {(d.topLossProducts || []).length === 0 ? (
            <p className="text-green-600 text-sm">Aucune perte cette semaine</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top pertes (7 jours)</p>
              {(d.topLossProducts as { id: string; name: string; total_lost: string; total_cost: string; loss_type: string }[]).map((p, i) => (
                <div key={`${p.id}-${p.loss_type}-${i}`} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-red-400 w-4">{i + 1}</span>
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-xs text-gray-500">{parseFloat(p.total_lost)} unites</span>
                    <span className="text-xs font-semibold text-red-600 ml-2">{parseFloat(p.total_cost).toFixed(2)} DH</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Alertes de stock</h2>
          {d.lowStockCount === 0 ? (
            <p className="text-green-600 text-sm">Tous les stocks sont suffisants</p>
          ) : (
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle size={20} />
              <span className="font-medium">{d.lowStockCount} ingredient(s) en stock bas</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
