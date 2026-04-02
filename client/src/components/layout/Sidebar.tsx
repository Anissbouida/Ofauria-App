import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Package, ClipboardList,
  Users, ChefHat, Warehouse, UserCog, BarChart3, Monitor
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const navigation = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, roles: ['admin', 'manager', 'cashier'] },
  { name: 'Point de vente', href: '/pos', icon: Monitor, roles: ['admin', 'manager', 'cashier'] },
  { name: 'Commandes', href: '/orders', icon: ClipboardList, roles: ['admin', 'manager', 'cashier'] },
  { name: 'Produits', href: '/products', icon: ShoppingBag, roles: ['admin', 'manager'] },
  { name: 'Clients', href: '/customers', icon: Users, roles: ['admin', 'manager', 'cashier'] },
  { name: 'Inventaire', href: '/inventory', icon: Warehouse, roles: ['admin', 'manager'] },
  { name: 'Recettes', href: '/recipes', icon: ChefHat, roles: ['admin', 'manager'] },
  { name: 'Employes', href: '/employees', icon: UserCog, roles: ['admin', 'manager'] },
  { name: 'Rapports', href: '/reports', icon: BarChart3, roles: ['admin', 'manager'] },
];

export default function Sidebar() {
  const { user } = useAuth();
  const filteredNav = navigation.filter(item => user && item.roles.includes(user.role));

  return (
    <aside className="w-64 bg-bakery-chocolate text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10">
        <h1 className="text-2xl font-bold tracking-wide">Ofauria</h1>
        <p className="text-sm text-primary-300 mt-1">Boulangerie & Patisserie</p>
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
            <p className="text-gray-400 capitalize">{user?.role}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
