import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings, Calculator, Package,
} from 'lucide-react';
import type { AppModule } from '@ofauria/shared';

const modules: { name: string; description: string; href: string; icon: typeof LayoutDashboard; color: string; module: AppModule }[] = [
  { name: 'Tableau de bord', description: 'Vue d\'ensemble de l\'activite', href: '/reports', icon: LayoutDashboard, color: 'bg-blue-500', module: 'dashboard' },
  { name: 'Point de vente', description: 'Caisse et ventes directes', href: '/pos', icon: Monitor, color: 'bg-green-600', module: 'pos' },
  { name: 'Ventes', description: 'Historique des ventes', href: '/sales', icon: Receipt, color: 'bg-emerald-500', module: 'sales' },
  { name: 'Pre-commandes', description: 'Commandes clients a produire', href: '/orders', icon: ClipboardList, color: 'bg-orange-500', module: 'orders' },
  { name: 'Produits', description: 'Catalogue et tarifs', href: '/products', icon: ShoppingBag, color: 'bg-purple-500', module: 'products' },
  { name: 'Clients', description: 'Fichier clients et fidelite', href: '/customers', icon: Users, color: 'bg-cyan-600', module: 'customers' },
  { name: 'Inventaire', description: 'Stock matieres premieres', href: '/inventory', icon: Warehouse, color: 'bg-amber-600', module: 'inventory' },
  { name: 'Recettes', description: 'Fiches techniques de fabrication', href: '/recipes', icon: ChefHat, color: 'bg-pink-500', module: 'recipes' },
  { name: 'Production', description: 'Planification de la fabrication', href: '/production', icon: Factory, color: 'bg-indigo-500', module: 'production' },
  { name: 'Approvisionnement', description: 'Demandes et transferts de stock', href: '/replenishment', icon: Package, color: 'bg-rose-500', module: 'replenishment' },
  { name: 'RH', description: 'Gestion des ressources humaines', href: '/employees', icon: UserCog, color: 'bg-teal-600', module: 'employees' },
  { name: 'Comptabilite', description: 'Factures, paiements et fournisseurs', href: '/accounting', icon: Calculator, color: 'bg-yellow-600', module: 'accounting' },
  { name: 'Utilisateurs', description: 'Comptes et droits d\'acces', href: '/users', icon: Lock, color: 'bg-gray-600', module: 'users' },
  { name: 'Rapports', description: 'Statistiques et analyses', href: '/reports', icon: BarChart3, color: 'bg-red-500', module: 'reports' },
  { name: 'Parametres', description: 'Personnalisation de l\'application', href: '/settings', icon: Settings, color: 'bg-slate-600', module: 'settings' },
];

export default function HomePage() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const navigate = useNavigate();

  const userModules = modules.filter(m => hasModule(m.module));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-800">Bienvenue, {user?.firstName}</h1>
        <p className="text-gray-500 mt-1">Que souhaitez-vous faire aujourd'hui ?</p>
      </div>

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
    </div>
  );
}
