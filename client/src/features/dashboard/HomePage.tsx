import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { reportsApi } from '../../api/reports.api';
import { productionApi } from '../../api/production.api';
import { inventoryApi } from '../../api/inventory.api';
import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag, Truck,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings, Calculator, Package,
  DollarSign, ShoppingCart, AlertTriangle, TrendingUp, Boxes, Clock,
  Plus, Zap,
} from 'lucide-react';
import type { AppModule } from '@ofauria/shared';

const modules: { name: string; description: string; href: string; icon: typeof LayoutDashboard; color: string; module: AppModule }[] = [
  { name: 'Tableau de bord', description: 'Vue d\'ensemble de l\'activite', href: '/reports', icon: LayoutDashboard, color: 'bg-blue-500', module: 'dashboard' },
  { name: 'Point de vente', description: 'Caisse et ventes directes', href: '/pos', icon: Monitor, color: 'bg-green-600', module: 'pos' },
  { name: 'Ventes', description: 'Historique des ventes', href: '/sales', icon: Receipt, color: 'bg-emerald-500', module: 'sales' },
  { name: 'Commandes', description: 'Commandes clients a produire', href: '/orders', icon: ClipboardList, color: 'bg-orange-500', module: 'orders' },
  { name: 'Produits', description: 'Catalogue et tarifs', href: '/products', icon: ShoppingBag, color: 'bg-purple-500', module: 'products' },
  { name: 'Clients', description: 'Fichier clients et fidelite', href: '/customers', icon: Users, color: 'bg-cyan-600', module: 'customers' },
  { name: 'Inventaire', description: 'Stock matieres premieres', href: '/inventory', icon: Warehouse, color: 'bg-amber-600', module: 'inventory' },
  { name: 'Recettes', description: 'Fiches techniques de fabrication', href: '/recipes', icon: ChefHat, color: 'bg-pink-500', module: 'recipes' },
  { name: 'Production', description: 'Planification de la fabrication', href: '/production', icon: Factory, color: 'bg-indigo-500', module: 'production' },
  { name: 'Approvisionnement', description: 'Demandes et transferts de stock', href: '/replenishment', icon: Package, color: 'bg-rose-500', module: 'replenishment' },
  { name: 'RH', description: 'Gestion des ressources humaines', href: '/employees', icon: UserCog, color: 'bg-teal-600', module: 'employees' },
  { name: 'Comptabilite', description: 'Caisse, charges et tresorerie', href: '/accounting', icon: Calculator, color: 'bg-yellow-600', module: 'accounting' },
  { name: 'Achats', description: 'Fournisseurs, commandes et factures', href: '/purchasing', icon: Truck, color: 'bg-blue-700', module: 'purchasing' },
  { name: 'Utilisateurs', description: 'Comptes et droits d\'acces', href: '/users', icon: Lock, color: 'bg-gray-600', module: 'users' },
  { name: 'Rapports', description: 'Statistiques et analyses', href: '/reports', icon: BarChart3, color: 'bg-red-500', module: 'reports' },
  { name: 'Parametres', description: 'Personnalisation de l\'application', href: '/settings', icon: Settings, color: 'bg-slate-600', module: 'settings' },
];

export default function HomePage() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const navigate = useNavigate();
  const [fabOpen, setFabOpen] = useState(false);

  const canSeeDashboard = hasModule('dashboard') || hasModule('reports');

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard'],
    queryFn: reportsApi.dashboard,
    enabled: canSeeDashboard,
    refetchInterval: 60000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const { data: productionPlans } = useQuery({
    queryKey: ['production-today', today],
    queryFn: () => productionApi.list({ dateFrom: today, dateTo: today }),
    enabled: hasModule('production'),
  });

  const { data: stockAlerts } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: inventoryApi.alerts,
    enabled: hasModule('inventory'),
  });

  const userModules = modules.filter(m => hasModule(m.module));

  // Production stats
  const plans = (productionPlans?.data || []) as { status: string; items?: { status: string }[] }[];
  const prodTotal = plans.length;
  const prodCompleted = plans.filter(p => p.status === 'completed').length;
  const prodInProgress = plans.filter(p => p.status === 'in_progress').length;
  const prodPct = prodTotal > 0 ? Math.round((prodCompleted / prodTotal) * 100) : 0;

  // Stock alerts
  const alertCount = (stockAlerts as unknown[] || []).length;

  // Dashboard data
  const d = dashboard || { todayRevenue: 0, todaySales: 0, avgSaleValue: 0, pendingOrders: 0, lowStockCount: 0 };

  // Quick actions
  const quickActions = [
    { label: 'Nouvelle vente', icon: ShoppingCart, href: '/pos', color: 'bg-green-500 hover:bg-green-600', module: 'pos' as AppModule },
    { label: 'Production', icon: Factory, href: '/production', color: 'bg-indigo-500 hover:bg-indigo-600', module: 'production' as AppModule },
    { label: 'Inventaire', icon: Warehouse, href: '/inventory', color: 'bg-amber-500 hover:bg-amber-600', module: 'inventory' as AppModule },
  ].filter(a => hasModule(a.module));

  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* ══════ HEADER ══════ */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Bienvenue, {user?.firstName}</h1>
        <p className="text-gray-500 mt-1">Que souhaitez-vous faire aujourd'hui ?</p>
      </div>

      {/* ══════ DASHBOARD KPIs ══════ */}
      {canSeeDashboard && dashboard && (
        <div className="mb-8 space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* CA du jour */}
            <div onClick={() => navigate('/sales')}
              className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                  <DollarSign size={18} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">CA du jour</p>
                  <p className="text-lg font-bold text-gray-900 truncate">{d.todayRevenue.toFixed(0)} <span className="text-xs font-normal text-gray-400">DH</span></p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                <TrendingUp size={10} /> {d.todaySales} vente{d.todaySales > 1 ? 's' : ''} — moy. {d.avgSaleValue.toFixed(0)} DH
              </div>
            </div>

            {/* Production du jour */}
            {hasModule('production') && (
              <div onClick={() => navigate('/production')}
                className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <Factory size={18} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Production</p>
                    <p className="text-lg font-bold text-gray-900">{prodCompleted}/{prodTotal}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${prodPct === 100 ? 'bg-emerald-500' : prodPct > 0 ? 'bg-indigo-500' : 'bg-gray-200'}`}
                        style={{ width: `${prodPct}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400">{prodPct}%</span>
                  </div>
                  {prodInProgress > 0 && <p className="text-[10px] text-indigo-500 mt-0.5">{prodInProgress} en cours</p>}
                </div>
              </div>
            )}

            {/* Alertes stock */}
            {hasModule('inventory') && (
              <div onClick={() => navigate('/inventory')}
                className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform ${
                    alertCount > 0 ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  }`}>
                    {alertCount > 0 ? <AlertTriangle size={18} className="text-white" /> : <Boxes size={18} className="text-white" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Stock</p>
                    <p className={`text-lg font-bold ${alertCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {alertCount > 0 ? `${alertCount} alerte${alertCount > 1 ? 's' : ''}` : 'OK'}
                    </p>
                  </div>
                </div>
                {alertCount > 0 && (
                  <p className="text-[10px] text-red-500 mt-2 flex items-center gap-1">
                    <AlertTriangle size={8} /> {alertCount} ingredient{alertCount > 1 ? 's' : ''} sous le seuil
                  </p>
                )}
              </div>
            )}

            {/* Commandes en attente */}
            <div onClick={() => navigate('/orders')}
              className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform ${
                  d.pendingOrders > 0 ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'
                }`}>
                  <ClipboardList size={18} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Commandes</p>
                  <p className={`text-lg font-bold ${d.pendingOrders > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {d.pendingOrders > 0 ? d.pendingOrders : '0'}
                  </p>
                </div>
              </div>
              {d.pendingOrders > 0 && (
                <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                  <Clock size={8} /> En attente de preparation
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════ MODULE NAVIGATION ══════ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {userModules.map((mod) => (
          <button key={mod.href + mod.name}
            onClick={() => navigate(mod.href)}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg hover:border-gray-300 transition-all group text-left">
            <div className={`w-12 h-12 ${mod.color} rounded-xl flex items-center justify-center text-white shadow-sm mb-4 group-hover:scale-110 transition-transform`}>
              <mod.icon size={24} />
            </div>
            <h3 className="font-semibold text-gray-800 text-sm">{mod.name}</h3>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{mod.description}</p>
          </button>
        ))}
      </div>

      {/* ══════ FLOATING ACTION BUTTONS ══════ */}
      {quickActions.length > 0 && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col-reverse items-end gap-2">
          {/* Quick action items */}
          {fabOpen && quickActions.map((action, i) => (
            <button key={action.href}
              onClick={() => { navigate(action.href); setFabOpen(false); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium shadow-lg ${action.color} transition-all animate-in fade-in slide-in-from-bottom-2`}
              style={{ animationDelay: `${i * 50}ms` }}>
              <action.icon size={16} />
              {action.label}
            </button>
          ))}
          {/* Main FAB toggle */}
          <button onClick={() => setFabOpen(!fabOpen)}
            className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all ${
              fabOpen ? 'bg-gray-700 hover:bg-gray-800 rotate-45' : 'bg-violet-600 hover:bg-violet-700'
            }`}>
            {fabOpen ? <Plus size={24} className="text-white" /> : <Zap size={22} className="text-white" />}
          </button>
        </div>
      )}
    </div>
  );
}
