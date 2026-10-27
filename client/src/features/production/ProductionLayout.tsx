import { Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Factory, TrendingUp, Thermometer, Package, ChefHat } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';

type ProductionView = 'dashboard' | 'plans' | 'forecast' | 'haccp' | 'replenishment' | 'recipes';

/**
 * Module Production : ses écrans sont des pages distinctes (plans, tableau de bord,
 * prévisions, relevés HACCP), regroupées ici sous les rubriques standard. Chaque page
 * garde son propre fil d'Ariane et ses boutons ; l'entrée active suit l'URL.
 * Le détail d'un plan (/production/:id) reste une page pleine largeur, hors coquille.
 */
export default function ProductionLayout() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const { pathname } = useLocation();
  // Prévisions et HACCP : droit Production ET rôle chef/gérant/admin, même règle que le
  // lanceur (navigation.ts) et que les routes serveur.
  const isProductionRole = hasModule('production') && !!user && ROLE_GROUPS.PRODUCTION.includes(user.role);

  const views: ModuleView<ProductionView>[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard', href: '/production/dashboard' },
    { key: 'plans', label: 'Plans de production', icon: Factory, section: 'operations', href: '/production' },
    { key: 'forecast', label: 'Prévisions', icon: TrendingUp, section: 'operations', href: '/forecast', hidden: !isProductionRole },
    { key: 'haccp', label: 'Relevés HACCP', icon: Thermometer, section: 'operations', href: '/haccp', hidden: !isProductionRole },
    { key: 'replenishment', label: 'Réapprovisionnement', icon: Package, section: 'operations', href: '/replenishment', external: true, hidden: !hasModule('replenishment') },
    { key: 'recipes', label: 'Recettes', icon: ChefHat, section: 'setup', href: '/recipes', external: true, hidden: !hasModule('recipes') },
  ];
  const current = views.find(v => !v.external && v.href === pathname);

  return (
    <ModuleShell title="Production" views={views} current={current} onSelect={() => {}} bar={false} flush>
      <Outlet />
    </ModuleShell>
  );
}
