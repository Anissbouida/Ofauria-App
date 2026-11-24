import { Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Factory, TrendingUp, Thermometer, Package, ChefHat, Wallet, Cog, ClipboardList, Hammer, SlidersHorizontal, Recycle, Calculator } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';

type ProductionView = 'dashboard' | 'plans' | 'atelier' | 'forecast' | 'mrp' | 'haccp' | 'replenishment' | 'costs' | 'analytic' | 'recipes' | 'cost-settings' | 'workcenters' | 'settings' | 'disassembly';

/**
 * Module Production : ses écrans sont des pages distinctes (plans, tableau de bord,
 * prévisions, relevés HACCP, demandes boutique, fiches techniques), regroupées ici sous les
 * rubriques standard. Chaque page garde son propre fil d'Ariane et ses boutons ;
 * l'entrée active suit l'URL. Les pages de détail (plan, nomenclature, demande)
 * restent pleine largeur, hors coquille. Chaque entrée suit son propre droit.
 */
export default function ProductionLayout() {
  const { user } = useAuth();
  const { hasModule, hasFeature, sectorLabel, canEdit } = usePermissions();
  const { pathname } = useLocation();
  // Prévisions et HACCP : droit Production ET rôle chef/gérant/admin, même règle que le
  // lanceur (navigation.ts) et que les routes serveur.
  // Étape 3 multi-industries : le droit de modifier la production, plus la liste des rôles boulangers.
  const isProductionRole = hasModule('production') && !!user && canEdit('production');

  const views: ModuleView<ProductionView>[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard', href: '/production/dashboard', hidden: !hasModule('production') },
    { key: 'plans', label: sectorLabel('production_plans', 'Plans de production'), icon: Factory, section: 'operations', href: '/production', hidden: !hasModule('production') },
    { key: 'atelier', label: 'Atelier', icon: Hammer, section: 'operations', href: '/production/atelier', hidden: !isProductionRole },
    { key: 'forecast', label: 'Prévisions', icon: TrendingUp, section: 'operations', href: '/forecast', hidden: !isProductionRole },
    { key: 'mrp', label: 'Plan directeur', icon: ClipboardList, section: 'operations', href: '/production/mrp', hidden: !isProductionRole },
    // Option « HACCP » du module (Paramètres › Secteur et modules, mig 507).
    { key: 'haccp', label: 'Relevés HACCP', icon: Thermometer, section: 'operations', href: '/haccp', hidden: !isProductionRole || !hasFeature('haccp') },
    // M9 : désassemblage — défaire des produits finis, matières remises en stock.
    { key: 'disassembly', label: 'Désassemblage', icon: Recycle, section: 'operations', href: '/production/disassembly', hidden: !isProductionRole },
    // Demandes de réassort boutique -> labo (ex-tuile « Besoins » du menu principal).
    { key: 'replenishment', label: 'Demandes boutique', icon: Package, section: 'operations', href: '/replenishment', hidden: !hasModule('replenishment') },
    { key: 'costs', label: 'Coûts', icon: Wallet, section: 'reports', href: '/production/costs', hidden: !hasModule('reports') },
    // Mig 655 : comptabilité analytique (centres, charges, personnel, sous-activité) — gérant.
    { key: 'analytic', label: 'Analyse des coûts', icon: Calculator, section: 'reports', href: '/production/analyse-couts', hidden: !hasModule('production') || !canEdit('production') },
    { key: 'recipes', label: sectorLabel('recipes', 'Fiches techniques'), icon: ChefHat, section: 'setup', href: '/recipes', hidden: !hasModule('recipes') },
    // 2026-11-24 : tout le paramétrage du coût (mode, centres, charges, personnel, clés, équipements).
    { key: 'cost-settings', label: 'Coût de revient', icon: Calculator, section: 'setup', href: '/production/cout-de-revient', hidden: !hasModule('production') || !canEdit('production') },
    { key: 'workcenters', label: 'Postes & gammes', icon: Cog, section: 'setup', href: '/production/work-centers', hidden: !hasModule('production') },
    { key: 'settings', label: 'Paramétrage', icon: SlidersHorizontal, section: 'setup', href: '/production/settings', hidden: !isProductionRole },
  ];
  const current = views.find(v => !v.external && v.href === pathname);

  return (
    <ModuleShell title={sectorLabel('production', 'Production')} views={views} current={current} onSelect={() => {}} bar={false} flush>
      <Outlet />
    </ModuleShell>
  );
}
