import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { ROLE_LABELS } from '@ofauria/shared';
import { NAV_HOME, navLabel, isNavItemVisible, visibleNavGroups } from '../../config/navigation';

/** Chemin de l'Economat : sert d'ancre au badge des actions magasinier en attente. */
const ECONOMAT_HREF = '/inventory';

export default function Sidebar() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();

  const homeItem = isNavItemVisible(NAV_HOME, hasModule) ? NAV_HOME : null;
  const userGroups = visibleNavGroups(hasModule);

  // Badge "transferts en attente" sur l'icone Economat : compteur global toutes BSI
  // confondues pour le store du magasinier. Polling 30s pour rester aligne avec la
  // file d'attente. Le badge est attache au module Economat : c'est la qu'on
  // selectionne le lot FEFO, qu'on declenche le transfert vers Pesage et qu'on
  // commande les ingredients en rupture (decision metier de centraliser ces actions
  // cote economat). Le compteur agrege transferts + ruptures pour un signal unique.
  const isWarehouseUser = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  const showsEconomat = userGroups.some(g => g.items.some(i => i.href === ECONOMAT_HREF));
  const { data: transferRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    enabled: isWarehouseUser && showsEconomat,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const { data: ruptureRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-rupture-requests'],
    queryFn: bonSortieApi.ruptureRequests,
    enabled: isWarehouseUser && showsEconomat,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const transferCount = transferRequests.length;
  const ruptureCount = ruptureRequests.length;
  const economatActionCount = transferCount + ruptureCount;
  // Priorite a l'onglet transferts si les deux ont des items. Sinon, ruptures.
  const badgeTab = transferCount > 0 ? 'transfers' : 'ruptures';

  const renderLink = (item: typeof NAV_HOME) => {
    const showBadge = item.href === ECONOMAT_HREF && isWarehouseUser && economatActionCount > 0;
    return (
      <NavLink
        key={item.href}
        to={showBadge ? `${item.href}?tab=${badgeTab}` : item.href}
        end={item.href === '/'}
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors text-sm font-medium ${
            isActive
              ? 'bg-primary-600 text-white'
              : 'text-gray-300 hover:bg-white/10 hover:text-white'
          }`
        }
      >
        <item.icon size={20} />
        <span className="flex-1">{navLabel(item)}</span>
        {showBadge && (
          <span
            className="ml-auto bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center shadow"
            title={`${transferCount} transfert(s) + ${ruptureCount} commande(s) en attente`}
          >
            {economatActionCount}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-64 bg-bakery-chocolate text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <img src="/images/logo-horizontal.png" alt="Ofauria" className="h-10 brightness-0 invert" />
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {homeItem && renderLink(homeItem)}
        {userGroups.map(group => (
          <div key={group.title} className="pt-4 first:pt-2">
            <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {group.title}
            </p>
            <div className="space-y-1">{group.items.map(renderLink)}</div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-4">
          <Package size={20} className="text-primary-400" />
          <div className="text-xs">
            <p className="font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-gray-400">{user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] || user.role : ''}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
