import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ShoppingBag, Package, ClipboardList,
  Users, ChefHat, Warehouse, UserCog, BarChart3, Monitor, Factory, Receipt, Lock, Calculator, Truck, Box, ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { ROLE_LABELS } from '@ofauria/shared';
import type { AppModule } from '@ofauria/shared';

const navigation: { name: string; href: string; icon: typeof LayoutDashboard; module: AppModule }[] = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, module: 'dashboard' },
  { name: 'Point de vente', href: '/pos', icon: Monitor, module: 'pos' },
  { name: 'Ventes', href: '/sales', icon: Receipt, module: 'sales' },
  { name: 'Commandes', href: '/orders', icon: ClipboardList, module: 'orders' },
  { name: 'Produits', href: '/products', icon: ShoppingBag, module: 'products' },
  { name: 'Clients', href: '/customers', icon: Users, module: 'customers' },
  { name: 'Économat', href: '/inventory', icon: Warehouse, module: 'economat' },
  { name: 'Pesage', href: '/warehouse', icon: Truck, module: 'pesage' },
  { name: 'Emballages', href: '/packaging', icon: Box, module: 'packaging' },
  { name: 'Recettes', href: '/recipes', icon: ChefHat, module: 'recipes' },
  { name: 'Production', href: '/production', icon: Factory, module: 'production' },
  { name: 'Approvisionnement', href: '/replenishment', icon: Package, module: 'replenishment' },
  { name: 'Contrôle ouverture', href: '/inventory-check/validation', icon: ClipboardCheck, module: 'unsold' },
  { name: 'RH', href: '/employees', icon: UserCog, module: 'employees' },
  { name: 'Comptabilite', href: '/accounting', icon: Calculator, module: 'accounting' },
  { name: 'Achats', href: '/purchasing', icon: ShoppingBag, module: 'purchasing' },
  { name: 'Utilisateurs', href: '/users', icon: Lock, module: 'users' },
  { name: 'Rapports', href: '/reports', icon: BarChart3, module: 'reports' },
];

export default function Sidebar() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const filteredNav = navigation.filter(item => hasModule(item.module));

  // Badge "transferts en attente" sur l'icone Pesage : compteur global toutes BSI confondues
  // pour le store du magasinier. Polling 30s pour rester aligne avec la file d'attente.
  // Visible uniquement pour les roles ayant acces au module pesage (filteredNav le garantit).
  const isWarehouseUser = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  const showsPesage = filteredNav.some(n => n.module === 'pesage');
  const { data: transferRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    enabled: isWarehouseUser && showsPesage,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const transferCount = transferRequests.length;

  return (
    <aside className="w-64 bg-bakery-chocolate text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <img src="/images/logo-horizontal.png" alt="Ofauria" className="h-10 brightness-0 invert" />
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {filteredNav.map((item) => {
          const showBadge = item.module === 'pesage' && isWarehouseUser && transferCount > 0;
          return (
            <NavLink
              key={item.href}
              to={showBadge ? `${item.href}?tab=transfers` : item.href}
              end={item.href === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              <span className="flex-1">{item.name}</span>
              {showBadge && (
                <span
                  className="ml-auto bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center shadow"
                  title={`${transferCount} transfert(s) economat en attente`}
                >
                  {transferCount}
                </span>
              )}
            </NavLink>
          );
        })}
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
