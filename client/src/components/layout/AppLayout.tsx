import { useState, useRef, useEffect } from 'react';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import Header from './Header';
import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings, Calculator,
  AlertTriangle, Package,
} from 'lucide-react';
import type { AppModule } from '@ofauria/shared';

const CASHIER_ROLES = ['cashier', 'saleswoman'];

const modules: { name: string; href: string; icon: typeof LayoutDashboard; color: string; module: AppModule }[] = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, color: 'bg-blue-500', module: 'dashboard' },
  { name: 'Point de vente', href: '/pos', icon: Monitor, color: 'bg-green-600', module: 'pos' },
  { name: 'Ventes', href: '/sales', icon: Receipt, color: 'bg-emerald-500', module: 'sales' },
  { name: 'Commandes', href: '/orders', icon: ClipboardList, color: 'bg-orange-500', module: 'orders' },
  { name: 'Produits', href: '/products', icon: ShoppingBag, color: 'bg-purple-500', module: 'products' },
  { name: 'Clients', href: '/customers', icon: Users, color: 'bg-cyan-600', module: 'customers' },
  { name: 'Inventaire', href: '/inventory', icon: Warehouse, color: 'bg-amber-600', module: 'inventory' },
  { name: 'Recettes', href: '/recipes', icon: ChefHat, color: 'bg-pink-500', module: 'recipes' },
  { name: 'Production', href: '/production', icon: Factory, color: 'bg-indigo-500', module: 'production' },
  { name: 'Approvisionnement', href: '/replenishment', icon: Package, color: 'bg-rose-500', module: 'replenishment' },
  { name: 'RH', href: '/employees', icon: UserCog, color: 'bg-teal-600', module: 'employees' },
  { name: 'Comptabilite', href: '/accounting', icon: Calculator, color: 'bg-yellow-600', module: 'accounting' },
  { name: 'Achats', href: '/purchasing', icon: ShoppingBag, color: 'bg-blue-700', module: 'purchasing' },
  { name: 'Utilisateurs', href: '/users', icon: Lock, color: 'bg-gray-600', module: 'users' },
  { name: 'Rapports', href: '/reports', icon: BarChart3, color: 'bg-red-500', module: 'reports' },
  { name: 'Parametres', href: '/settings', icon: Settings, color: 'bg-slate-600', module: 'settings' },
];

function TimeoutWarningModal() {
  const { timeoutWarning, extendSession, logout } = useAuth();
  const [countdown, setCountdown] = useState(120); // 2 minutes countdown

  useEffect(() => {
    if (!timeoutWarning) { setCountdown(120); return; }
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutWarning]);

  if (!timeoutWarning) return null;

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={32} className="text-orange-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Session inactive</h2>
        <p className="text-gray-500 mb-4">
          Votre session va expirer dans
        </p>
        <p className="text-4xl font-bold text-orange-600 mb-6">
          {minutes}:{String(seconds).padStart(2, '0')}
        </p>
        <div className="flex gap-3">
          <button onClick={logout}
            className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            Deconnexion
          </button>
          <button onClick={extendSession}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors">
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { user, isLoading: authLoading } = useAuth();
  const { hasModule, isLoading: permsLoading } = usePermissions();
  const isLoading = authLoading || permsLoading;
  const [showApps, setShowApps] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const appsRef = useRef<HTMLDivElement>(null);

  const isCashierRole = user && CASHIER_ROLES.includes(user.role);

  // Redirect cashier/saleswoman to /pos if they land on dashboard
  useEffect(() => {
    if (isCashierRole && location.pathname === '/') {
      navigate('/pos', { replace: true });
    }
  }, [isCashierRole, location.pathname, navigate]);

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

  // Cashier/saleswoman: full-screen POS without header/menu
  if (isCashierRole) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-100">
        <Outlet />
        <TimeoutWarningModal />
      </div>
    );
  }

  const userModules = modules.filter(m => hasModule(m.module));

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

      <TimeoutWarningModal />
    </div>
  );
}
