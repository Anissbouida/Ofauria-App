import { useState, useRef, useEffect } from 'react';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import Header from './Header';
import { AlertTriangle } from 'lucide-react';
import { NAV_HOME, navLabel, isNavItemVisible, visibleNavGroups } from '../../config/navigation';
import type { NavItem } from '../../config/navigation';

const CASHIER_ROLES = ['cashier', 'saleswoman'];

function ModuleTile({ item, onSelect }: { item: NavItem; onSelect: () => void }) {
  return (
    <button onClick={onSelect}
      className="flex flex-col items-center gap-2 p-4 rounded-xl hover:bg-gray-50 transition-colors group">
      <div className={`w-12 h-12 ${item.color} rounded-xl flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform`}>
        <item.icon size={24} />
      </div>
      <span className="text-xs font-medium text-gray-700 text-center leading-tight">{navLabel(item)}</span>
    </button>
  );
}

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

  const homeItem = isNavItemVisible(NAV_HOME, hasModule) ? NAV_HOME : null;
  const userGroups = visibleNavGroups(hasModule);

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <Header onToggleApps={() => setShowApps(!showApps)} />

      {/* App launcher overlay */}
      {showApps && (
        <div className="fixed inset-0 z-30" style={{ top: 48 }}>
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowApps(false)} />
          <div ref={appsRef}
            className="relative mx-auto mt-2 w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-200 p-6 animate-in fade-in slide-in-from-top-2">
            {homeItem && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 pb-5 mb-1 border-b border-gray-100">
                <ModuleTile item={homeItem} onSelect={() => { navigate(homeItem.href); setShowApps(false); }} />
              </div>
            )}
            {userGroups.map((group) => (
              <div key={group.title} className="pt-4 first:pt-0">
                <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group.title}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <ModuleTile key={item.href} item={item}
                      onSelect={() => { navigate(item.href); setShowApps(false); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content — pas de padding sur les pages Économat (style Odoo full-width) */}
      <main className={`flex-1 overflow-auto ${(location.pathname.startsWith('/inventory') || location.pathname.startsWith('/recipes') || location.pathname.startsWith('/products') || location.pathname.startsWith('/production') || location.pathname.startsWith('/replenishment') || location.pathname.startsWith('/warehouse') || location.pathname.startsWith('/accounting') || location.pathname.startsWith('/sales') || location.pathname.startsWith('/purchasing')) ? '' : 'p-6'}`}>
        <Outlet />
      </main>

      <TimeoutWarningModal />
    </div>
  );
}
