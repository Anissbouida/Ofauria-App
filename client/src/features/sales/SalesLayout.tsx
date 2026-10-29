import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Monitor, ClipboardList, Receipt, RotateCcw, Lock, FileText, Clock, Users, ShoppingBag, Radio, LayoutDashboard, Sparkles, Percent, FileSignature, BellRing, Target, BadgePercent, Repeat, Truck } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';
import { SALES_MAIN_TABS } from './SalesPage';

/**
 * Module Ventes : commandes, ventes (et leurs écrans ?tab=), clients, produits et
 * rapports de vente (/reports), regroupés sous les rubriques standard. Chaque page garde son fil d'Ariane et ses
 * boutons ; l'entrée active suit l'URL. Le point de vente reste plein écran (lien).
 */
export default function SalesLayout() {
  const { hasModule } = usePermissions();
  const { user } = useAuth();
  // Devis : réservés à la direction, comme les commandes de professionnels (mig 354/365).
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const { pathname } = useLocation();
  const [params] = useSearchParams();

  const salesView = (key: typeof SALES_MAIN_TABS[number]['key'], icon: ModuleView['icon']): ModuleView => ({
    key: `sales:${key}`,
    label: SALES_MAIN_TABS.find(t => t.key === key)!.label,
    icon, section: 'operations',
    href: key === 'sales' ? '/sales' : `/sales?tab=${key}`,
    hidden: !hasModule('sales'),
  });
  const views: ModuleView[] = [
    { key: 'reports:overview', label: "Vue d'ensemble", icon: LayoutDashboard, section: 'dashboard', href: '/reports', hidden: !hasModule('reports') },
    { key: 'pos', label: 'Point de vente', icon: Monitor, section: 'operations', href: '/pos', external: true, hidden: !hasModule('pos') },
    { key: 'crm', label: 'Pipeline', icon: Target, section: 'operations', href: '/crm', hidden: !hasModule('crm') },
    { key: 'quotes', label: 'Devis', icon: FileSignature, section: 'operations', href: '/quotes', hidden: !hasModule('orders') || !isDirection },
    { key: 'orders', label: 'Commandes', icon: ClipboardList, section: 'operations', href: '/orders', hidden: !hasModule('orders') },
    salesView('sales', Receipt),
    salesView('returns', RotateCcw),
    salesView('sessions', Lock),
    salesView('invoices', FileText),
    salesView('unpaid', Clock),
    { key: 'sales:subscriptions', label: 'Abonnements', icon: Repeat, section: 'operations', href: '/sales?tab=subscriptions', hidden: !hasModule('sales') || !isDirection },
    { key: 'sales:routes', label: 'Tournées', icon: Truck, section: 'operations', href: '/sales?tab=routes', hidden: !hasModule('sales') },
    { key: 'dunning', label: 'Relances', icon: BellRing, section: 'operations', href: '/dunning', hidden: !hasModule('sales') || !isDirection },
    { key: 'reports:menu', label: 'Menu Engineering', icon: Sparkles, section: 'reports', href: '/reports?tab=menu', hidden: !hasModule('reports') },
    { key: 'reports:margins', label: 'Marges', icon: Percent, section: 'reports', href: '/reports?tab=margins', hidden: !hasModule('reports') },
    { key: 'customers', label: 'Clients', icon: Users, section: 'setup', href: '/customers', hidden: !hasModule('customers') },
    { key: 'promotions', label: 'Promotions et fidélité', icon: BadgePercent, section: 'setup', href: '/promotions', hidden: !hasModule('sales') },
    { key: 'products', label: 'Produits', icon: ShoppingBag, section: 'setup', href: '/products', hidden: !hasModule('products') },
    { key: 'channels', label: 'Canaux de vente', icon: Radio, section: 'setup', href: '/settings?page=channels', external: true, hidden: !hasModule('settings') },
  ];
  const tab = params.get('tab');
  const currentKey = pathname === '/sales'
    ? `sales:${SALES_MAIN_TABS.some(t => t.key === tab) ? tab : 'sales'}`
    : pathname === '/reports'
      ? `reports:${tab === 'menu' || tab === 'margins' ? tab : 'overview'}`
      : pathname.slice(1);
  const current = views.find(v => v.key === currentKey);

  return (
    <ModuleShell title="Ventes" views={views} current={current} onSelect={() => {}} bar={false} flush>
      <Outlet />
    </ModuleShell>
  );
}
