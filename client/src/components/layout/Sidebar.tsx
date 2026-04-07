import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Package, ClipboardList,
  Users, ChefHat, Warehouse, UserCog, BarChart3, Monitor, Factory, Receipt, Lock, Calculator
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { ROLE_LABELS } from '@ofauria/shared';
import type { AppModule } from '@ofauria/shared';

const navigation: { name: string; href: string; icon: typeof LayoutDashboard; module: AppModule }[] = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, module: 'dashboard' },
  { name: 'Point de vente', href: '/pos', icon: Monitor, module: 'pos' },
  { name: 'Ventes', href: '/sales', icon: Receipt, module: 'sales' },
  { name: 'Commandes', href: '/orders', icon: ClipboardList, module: 'orders' },
  { name: 'Produits', href: '/products', icon: ShoppingBag, module: 'products' },
  { name: 'Clients', href: '/customers', icon: Users, module: 'customers' },
  { name: 'Inventaire', href: '/inventory', icon: Warehouse, module: 'inventory' },
  { name: 'Recettes', href: '/recipes', icon: ChefHat, module: 'recipes' },
  { name: 'Production', href: '/production', icon: Factory, module: 'production' },
  { name: 'Approvisionnement', href: '/replenishment', icon: Package, module: 'replenishment' },
  { name: 'Personnel', href: '/employees', icon: UserCog, module: 'employees' },
  { name: 'Comptabilite', href: '/accounting', icon: Calculator, module: 'accounting' },
  { name: 'Utilisateurs', href: '/users', icon: Lock, module: 'users' },
  { name: 'Rapports', href: '/reports', icon: BarChart3, module: 'reports' },
];

export default function Sidebar() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const filteredNav = navigation.filter(item => hasModule(item.module));

  return (
    <aside className="w-64 bg-bakery-chocolate text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <img src="/images/logo-horizontal.png" alt="Ofauria" className="h-10 brightness-0 invert" />
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {filteredNav.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
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
            {item.name}
          </NavLink>
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
