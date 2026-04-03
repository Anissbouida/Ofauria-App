import { useState, useRef, useEffect } from 'react';
import { Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Header from './Header';
import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings,
} from 'lucide-react';

const ADMIN_MANAGER = ['admin', 'manager'];
const PRODUCTION_ROLES = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie'];

const modules = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, color: 'bg-blue-500', roles: ADMIN_MANAGER },
  { name: 'Point de vente', href: '/pos', icon: Monitor, color: 'bg-green-600', roles: ['admin', 'manager', 'cashier', 'saleswoman'] },
  { name: 'Ventes', href: '/sales', icon: Receipt, color: 'bg-emerald-500', roles: ADMIN_MANAGER },
  { name: 'Pre-commandes', href: '/orders', icon: ClipboardList, color: 'bg-orange-500', roles: ['admin', 'manager', 'cashier', 'saleswoman'] },
  { name: 'Produits', href: '/products', icon: ShoppingBag, color: 'bg-purple-500', roles: ADMIN_MANAGER },
  { name: 'Clients', href: '/customers', icon: Users, color: 'bg-cyan-600', roles: ['admin', 'manager', 'cashier', 'saleswoman'] },
  { name: 'Inventaire', href: '/inventory', icon: Warehouse, color: 'bg-amber-600', roles: PRODUCTION_ROLES },
  { name: 'Recettes', href: '/recipes', icon: ChefHat, color: 'bg-pink-500', roles: PRODUCTION_ROLES },
  { name: 'Production', href: '/production', icon: Factory, color: 'bg-indigo-500', roles: [...PRODUCTION_ROLES, 'cashier', 'saleswoman'] },
  { name: 'Employes', href: '/employees', icon: UserCog, color: 'bg-teal-600', roles: ADMIN_MANAGER },
  { name: 'Utilisateurs', href: '/users', icon: Lock, color: 'bg-gray-600', roles: ['admin'] },
  { name: 'Rapports', href: '/reports', icon: BarChart3, color: 'bg-red-500', roles: ADMIN_MANAGER },
  { name: 'Parametres', href: '/settings', icon: Settings, color: 'bg-slate-600', roles: ['admin'] },
];

export default function AppLayout() {
  const { user, isLoading } = useAuth();
  const [showApps, setShowApps] = useState(false);
  const navigate = useNavigate();
  const appsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (appsRef.current && !appsRef.current.contains(e.target as Node)) setShowApps(false);
    };
    if (showApps) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showApps]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
          <p className="text-gray-500 text-sm">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const userModules = modules.filter(m => m.roles.includes(user.role));

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <Header onToggleApps={() => setShowApps(!showApps)} />

      {/* App launcher overlay */}
      {showApps && (
        <div className="fixed inset-0 z-30" style={{ top: 48 }}>
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowApps(false)} />
          <div ref={appsRef}
            className="relative mx-auto mt-2 w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-200 p-6 animate-in fade-in slide-in-from-top-2">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
              {userModules.map((mod) => (
                <button key={mod.href}
                  onClick={() => { navigate(mod.href); setShowApps(false); }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl hover:bg-gray-50 transition-colors group">
                  <div className={`w-12 h-12 ${mod.color} rounded-xl flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform`}>
                    <mod.icon size={24} />
                  </div>
                  <span className="text-xs font-medium text-gray-700 text-center leading-tight">{mod.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
