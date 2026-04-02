import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.api';
import { DollarSign, ShoppingCart, TrendingUp, Package, AlertTriangle } from 'lucide-react';

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

  const d = data || { todayOrders: 0, todayRevenue: 0, avgOrderValue: 0, todayItemsSold: 0, topProducts: [], lowStockCount: 0 };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-bakery-chocolate">Tableau de bord</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Chiffre d'affaires du jour" value={`${d.todayRevenue.toFixed(2)} €`} icon={DollarSign} color="bg-green-500" />
        <KPICard title="Commandes du jour" value={String(d.todayOrders)} icon={ShoppingCart} color="bg-blue-500" />
        <KPICard title="Panier moyen" value={`${d.avgOrderValue.toFixed(2)} €`} icon={TrendingUp} color="bg-primary-500" />
        <KPICard title="Articles vendus" value={String(d.todayItemsSold)} icon={Package} color="bg-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    <span className="text-sm font-medium text-green-600 ml-3">{parseFloat(p.total_revenue).toFixed(2)} €</span>
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
