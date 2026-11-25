import { usePermissions } from '../../context/PermissionsContext';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, LogOut, ChevronDown, Fingerprint, User, UserCircle } from 'lucide-react';
import PasskeysModal from '../../features/auth/PasskeysModal';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { ROLE_LABELS } from '@ofauria/shared';
import type { Role } from '@ofauria/shared';
import NotificationBell from './NotificationBell';
import StoreSwitcher from './StoreSwitcher';
import GlobalSearch from './GlobalSearch';
import { NAV_ITEM_BY_PATH, NAV_LABEL_BY_PATH, SALES_SHELL_PATHS, navLabel } from '../../config/navigation';
import { useLocale } from '../../i18n';
import { LanguageMenu } from './LanguageSwitcher';
import InterfacePreferenceMenu from './InterfacePreferenceMenu';

export default function Header({ onToggleApps }: { onToggleApps: () => void }) {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasskeys, setShowPasskeys] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { sectorLabel } = usePermissions();
  const { locale, t } = useLocale();
  const currentPath = '/' + location.pathname.split('/')[1];
  const navItem = NAV_ITEM_BY_PATH[currentPath];
  const currentModule = SALES_SHELL_PATHS.has(currentPath) ? t('module.sales')
    : navItem ? navLabel(navItem, sectorLabel, locale) : (NAV_LABEL_BY_PATH[currentPath] || '');

  return (
    <header className="h-12 flex items-center px-4 shrink-0 z-40" style={{ backgroundColor: 'var(--ds-accent)', color: 'var(--theme-cta-text)' }}>
      {/* Left: App grid + branding */}
      <div className="flex items-center gap-2">
        <button onClick={onToggleApps}
          className="p-1.5 rounded hover:bg-white/15 transition-colors" title={t('header.apps')} aria-label={t('header.apps')}>
          <LayoutGrid size={20} />
        </button>
        <button onClick={() => navigate('/', { state: { launcher: true } })}
          className="text-base font-bold tracking-wide hover:opacity-80 transition-opacity px-1">
          {settings.companyName}
        </button>
        {currentModule && currentPath !== '/' && (
          <>
            <span className="text-white/30 text-sm">/</span>
            <span className="text-sm font-medium text-white/80">{currentModule}</span>
          </>
        )}
      </div>

      <div className="flex-1 flex justify-center px-4">
        <GlobalSearch />
      </div>

      {/* Établissement actif (lot 7) : seulement si le compte en a plusieurs */}
      <StoreSwitcher />

      {/* Notifications */}
      <NotificationBell />

      {/* Right: User dropdown */}
      <div className="relative" ref={menuRef}>
        <button onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/15 transition-colors">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <span className="text-sm font-medium hidden sm:block">{user?.firstName}</span>
          <ChevronDown size={14} className="text-white/60" />
        </button>

        {showUserMenu && (
          <div className="absolute end-0 top-full mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-gray-800 z-50">
            <div className="px-4 py-3 border-b">
              <p className="font-semibold text-sm">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-500"><bdi>{user?.email}</bdi></p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                {user?.role ? ROLE_LABELS[user.role as Role] || user.role : ''}
              </span>
            </div>
            {/* Espace employe : bulletins, conges, avances (si le compte est lie a une fiche). */}
            <button onClick={() => { navigate('/employees?tab=me'); setShowUserMenu(false); }}
              className="w-full text-start px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2">
              <UserCircle size={16} className="text-gray-400" /> {t('header.mySpace')}
            </button>
            {/* Passkeys (mig 705) : connexion par Face ID / empreinte, sans mot de passe ni code. */}
            <button onClick={() => { setShowPasskeys(true); setShowUserMenu(false); }}
              className="w-full text-start px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2">
              <Fingerprint size={16} className="text-gray-400" /> {t('header.passkeys')}
            </button>
            {user?.role === 'admin' && (
              <>
                <button onClick={() => { navigate('/users'); setShowUserMenu(false); }}
                  className="w-full text-start px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2">
                  <User size={16} className="text-gray-400" /> {t('header.myProfile')}
                </button>
              </>
            )}
            <div className="border-t" />
            {/* G6-05 : langue de l'interface, enregistrée sur le compte. */}
            <LanguageMenu onDone={() => setShowUserMenu(false)} />
            <InterfacePreferenceMenu />
            <div className="border-t" />
            <button onClick={logout}
              className="w-full text-start px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
              <LogOut size={16} /> {t('header.logout')}
            </button>
          </div>
        )}
      </div>
      {showPasskeys && <PasskeysModal onClose={() => setShowPasskeys(false)} />}
    </header>
  );
}
