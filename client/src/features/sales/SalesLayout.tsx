import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Monitor, ClipboardList, Receipt, RotateCcw, Lock, FileText, Clock, Users, ShoppingBag, Radio } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';
import { SALES_MAIN_TABS } from './SalesPage';

/**
 * Module Ventes : commandes, ventes (et leurs écrans ?tab=), clients et produits,
 * regroupés sous les rubriques standard. Chaque page garde son fil d'Ariane et ses
 * boutons ; l'entrée active suit l'URL. Le point de vente reste plein écran (lien).
 */
export default function SalesLayout() {
  const { hasModule } = usePermissions();
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
    { key: 'pos', label: 'Point de vente', icon: Monitor, section: 'operations', href: '/pos', external: true, hidden: !hasModule('pos') },
    { key: 'orders', label: 'Commandes', icon: ClipboardList, section: 'operations', href: '/orders', hidden: !hasModule('orders') },
    salesView('sales', Receipt),
    salesView('returns', RotateCcw),
    salesView('sessions', Lock),
    salesView('invoices', FileText),
    salesView('unpaid', Clock),
    { key: 'customers', label: 'Clients', icon: Users, section: 'setup', href: '/customers', hidden: !hasModule('customers') },
    { key: 'products', label: 'Produits', icon: ShoppingBag, section: 'setup', href: '/products', hidden: !hasModule('products') },
    { key: 'channels', label: 'Canaux de vente', icon: Radio, section: 'setup', href: '/settings?page=channels', external: true, hidden: !hasModule('settings') },
  ];
  const tab = params.get('tab');
  const currentKey = pathname === '/sales'
    ? `sales:${SALES_MAIN_TABS.some(t => t.key === tab) ? tab : 'sales'}`
    : pathname.slice(1);
  const current = views.find(v => v.key === currentKey);

  return (
    <ModuleShell title="Ventes" views={views} current={current} onSelect={() => {}} bar={false} flush>
      <Outlet />
    </ModuleShell>
  );
}
