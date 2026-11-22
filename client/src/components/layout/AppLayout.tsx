import '../../styles/design-system.css';
import { useState, useRef, useEffect } from 'react';
import MfaSetup from '../../features/auth/MfaSetup';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import './apple-look.css';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import Header from './Header';
import ForcePasswordChange from '../../features/auth/ForcePasswordChange';
import { AlertTriangle } from 'lucide-react';
import { NAV_HOME, navLabel, navGroupTitle, isNavItemVisible, visibleNavGroups } from '../../config/navigation';
import { useLocale } from '../../i18n';
import type { NavItem } from '../../config/navigation';
import { useApprovalsCount } from '../../api/approvals.api';

const CASHIER_ROLES = ['cashier', 'saleswoman'];

function ModuleTile({ item, onSelect, count = 0 }: { item: NavItem; onSelect: () => void; count?: number }) {
  const { sectorLabel } = usePermissions();
  const { locale } = useLocale();
  return (
    <button onClick={onSelect}
      className="flex flex-col items-center gap-2 p-4 rounded-xl hover:bg-gray-50 transition-colors group">
      <div className={`relative w-12 h-12 ${item.color} rounded-xl flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform`}>
        <item.icon size={24} />
        {count > 0 && <CountBadge count={count} />}
      </div>
      <span className="text-xs font-medium text-gray-700 text-center leading-tight">{navLabel(item, sectorLabel, locale)}</span>
    </button>
  );
}

/** Pastille rouge en coin de tuile (pièces à approuver…). */
export function CountBadge({ count }: { count: number }) {
  return (
    <span dir="ltr" className="absolute -top-1.5 -end-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TimeoutWarningModal() {
  const { timeoutWarning, extendSession, logout } = useAuth();
  const { t } = useLocale();
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
        <h2 className="text-xl font-bold text-gray-800 mb-2">{t('session.inactiveTitle')}</h2>
        <p className="text-gray-500 mb-4">
          {t('session.expiresIn')}
        </p>
        <p className="text-4xl font-bold text-orange-600 mb-6" dir="ltr">
          {minutes}:{String(seconds).padStart(2, '0')}
        </p>
        <div className="flex gap-3">
          <button onClick={logout}
            className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            {t('header.logout')}
          </button>
          <button onClick={extendSession}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors">
            {t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { user, isLoading: authLoading, mfaConfigured } = useAuth();
  const { hasModule, isLoading: permsLoading } = usePermissions();
  const { locale, t } = useLocale();
  const isLoading = authLoading || permsLoading;
  const [showApps, setShowApps] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const appsRef = useRef<HTMLDivElement>(null);

  const isCashierRole = user && CASHIER_ROLES.includes(user.role);
  const approvalsCount = useApprovalsCount(!!user && !isCashierRole);

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
          <p className="text-gray-500 text-sm">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // G0-06 : mot de passe antérieur à la politique — rien d'autre n'est accessible
  // tant qu'il n'est pas changé.
  if (user.mustChangePassword) return <ForcePasswordChange />;
  // G6-01 : rôle soumis à la double authentification, pas encore activée.
  if ((user as { mfaSetupRequired?: boolean }).mfaSetupRequired) return <MfaSetup forced onDone={mfaConfigured} />;

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
  const userGroups = visibleNavGroups(hasModule, user?.role);

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
                  {navGroupTitle(group, locale)}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <ModuleTile key={item.href} item={item} count={item.counter === 'approvals' ? approvalsCount : 0}
                      onSelect={() => { navigate(item.href); setShowApps(false); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content — pas de padding sur les pages Stock (style Odoo full-width) */}
      {/* Design Ventes partout (2026-11-18) : chaque page pose sa barre et ses marges (zone .kl-apple) ;
          seule la Caisse garde la marge historique. Remplace l'ancienne liste blanche de routes pleine largeur. */}
      <main className={`flex-1 overflow-auto ${location.pathname === '/pos' ? 'p-6' : 'kl-apple kl-ds'}`}>
        <Outlet />
      </main>

      <TimeoutWarningModal />
    </div>
  );
}
