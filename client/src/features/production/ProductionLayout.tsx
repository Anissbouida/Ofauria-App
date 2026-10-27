import { Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Factory, TrendingUp, Thermometer, Package, ChefHat, Wallet } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';

type ProductionView = 'dashboard' | 'plans' | 'forecast' | 'haccp' | 'replenishment' | 'costs' | 'recipes';

/**
 * Module Production : ses écrans sont des pages distinctes (plans, tableau de bord,
 * prévisions, relevés HACCP, besoins, fiches techniques), regroupées ici sous les
 * rubriques standard. Chaque page garde son propre fil d'Ariane et ses boutons ;
 * l'entrée active suit l'URL. Les pages de détail (plan, nomenclature, demande)
 * restent pleine largeur, hors coquille. Chaque entrée suit son propre droit.
 */
export default function ProductionLayout() {
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const { pathname } = useLocation();
  // Prévisions et HACCP : droit Production ET rôle chef/gérant/admin, même règle que le
  // lanceur (navigation.ts) et que les routes serveur.
  const isProductionRole = hasModule('production') && !!user && ROLE_GROUPS.PRODUCTION.includes(user.role);

  const views: ModuleView<ProductionView>[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard', href: '/production/dashboard', hidden: !hasModule('production') },
    { key: 'plans', label: 'Plans de production', icon: Factory, section: 'operations', href: '/production', hidden: !hasModule('production') },
    { key: 'forecast', label: 'Prévisions', icon: TrendingUp, section: 'operations', href: '/forecast', hidden: !isProductionRole },
    { key: 'haccp', label: 'Relevés HACCP', icon: Thermometer, section: 'operations', href: '/haccp', hidden: !isProductionRole },
    // Libellés du menu principal (MODULE_LABELS) : Besoins, Fiches techniques.
    { key: 'replenishment', label: 'Besoins', icon: Package, section: 'operations', href: '/replenishment', hidden: !hasModule('replenishment') },
    { key: 'costs', label: 'Coûts', icon: Wallet, section: 'reports', href: '/production/costs', hidden: !hasModule('reports') },
    { key: 'recipes', label: 'Fiches techniques', icon: ChefHat, section: 'setup', href: '/recipes', hidden: !hasModule('recipes') },
  ];
  const current = views.find(v => !v.external && v.href === pathname);

  return (
    <ModuleShell title="Production" views={views} current={current} onSelect={() => {}} bar={false} flush>
      <Outlet />
    </ModuleShell>
  );
}
