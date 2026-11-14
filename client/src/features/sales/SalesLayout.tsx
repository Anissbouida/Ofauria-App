import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Monitor, ClipboardList, Receipt, RotateCcw, Lock, FileText, Clock, Users, ShoppingBag, Radio, LayoutDashboard, Sparkles, Percent, FileSignature, BellRing, Target, BadgePercent, Repeat, Truck, BarChart3, PackageCheck, Tag, ArrowLeftRight, Undo2, Handshake } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';
import { SALES_MAIN_TABS } from './SalesPage';
import '../projects/projects.css';
import './sales.css';

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

  const salesView = (key: typeof SALES_MAIN_TABS[number]['key'], icon: ModuleView['icon'], group: string): ModuleView => ({
    key: `sales:${key}`,
    label: SALES_MAIN_TABS.find(t => t.key === key)!.label,
    icon, section: 'operations', group,
    href: key === 'sales' ? '/sales' : `/sales?tab=${key}`,
    hidden: !hasModule('sales'),
  });
  // Opérations rangées par flux (maquette 2026-11-13) : la caisse, puis la chaîne pro
  // devis → commande → livraison → facture, au lieu d'une liste à plat.
  const views: ModuleView[] = [
    // Tableau de bord Ventes (maquette planche 1) ; l'analyse détaillée (/reports) passe en Rapports.
    { key: 'sales-dashboard', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard', href: '/sales-dashboard', hidden: !isDirection },
    { key: 'pos', label: 'Point de vente', icon: Monitor, section: 'operations', group: 'Caisse', href: '/pos', external: true, hidden: !hasModule('pos') },
    salesView('sales', Receipt, 'Caisse'),
    salesView('returns', RotateCcw, 'Caisse'),
    salesView('sessions', Lock, 'Caisse'),
    { key: 'crm', label: 'Pipeline', icon: Target, section: 'operations', group: 'Ventes pro', href: '/crm', hidden: !hasModule('crm') },
    { key: 'quotes', label: 'Devis', icon: FileSignature, section: 'operations', group: 'Ventes pro', href: '/quotes', hidden: !hasModule('orders') || !isDirection },
    { key: 'orders', label: 'Commandes', icon: ClipboardList, section: 'operations', group: 'Ventes pro', href: '/orders', hidden: !hasModule('orders') },
    // Contrats-cadres / commandes ouvertes (phase 11, D3-37) : engagement B2B suivi par appels.
    { key: 'sales-contracts', label: 'Contrats-cadres', icon: Handshake, section: 'operations', group: 'Ventes pro', href: '/sales-contracts', hidden: !hasModule('orders') || !isDirection },
    { key: 'pro-returns', label: 'Retours clients', icon: Undo2, section: 'operations', group: 'Ventes pro', href: '/pro-returns', hidden: !hasModule('sales') || !isDirection },
    // Bon de livraison = document O2C de premier rang (sortie de stock FEFO + lots, ancre du rappel) :
    // Écran autonome, séparé des commandes comme dans les ERP standards (Odoo, SAP).
    { key: 'orders:deliveries', label: 'Bons de livraison', icon: PackageCheck, section: 'operations', group: 'Livraison', href: '/delivery-notes', hidden: !hasModule('orders') || !isDirection },
    salesView('routes', Truck, 'Livraison'),
    { key: 'product-transfers', label: 'Transferts', icon: ArrowLeftRight, section: 'operations', group: 'Livraison', href: '/product-transfers', hidden: !hasModule('sales') || !isDirection },
    salesView('invoices', FileText, 'Facturation'),
    salesView('unpaid', Clock, 'Facturation'),
    { key: 'dunning', label: 'Relances', icon: BellRing, section: 'operations', group: 'Facturation', href: '/dunning', hidden: !hasModule('sales') || !isDirection },
    { key: 'sales:subscriptions', label: 'Abonnements', icon: Repeat, section: 'operations', group: 'Facturation', href: '/sales?tab=subscriptions', hidden: !hasModule('sales') || !isDirection },
    // Ristournes de fin d'année (phase 11, D5-12) : taux sur le CA annuel, direction.
    { key: 'rebates', label: 'Ristournes', icon: BadgePercent, section: 'operations', group: 'Facturation', href: '/rebates', hidden: !hasModule('sales') || !isDirection },
    { key: 'reports:overview', label: 'Analyse des ventes', icon: BarChart3, section: 'reports', href: '/reports', hidden: !hasModule('reports') },
    { key: 'reports:margins', label: 'Marges', icon: Percent, section: 'reports', href: '/reports?tab=margins', hidden: !hasModule('reports') },
    { key: 'reports:menu', label: 'Menu Engineering', icon: Sparkles, section: 'reports', href: '/reports?tab=menu', hidden: !hasModule('reports') },
    // Objectifs par commercial (phase 11, D3-13) : objectif vs réalisé par vendeur.
    { key: 'sales-targets', label: 'Objectifs', icon: BarChart3, section: 'reports', href: '/sales-targets', hidden: !hasModule('sales') },
    { key: 'reports:builder', label: 'Rapports personnalisés', icon: BarChart3, section: 'reports', href: '/reports?tab=builder', hidden: !hasModule('reports') },
    { key: 'customers', label: 'Clients', icon: Users, section: 'setup', href: '/customers', hidden: !hasModule('customers') },
    { key: 'products', label: 'Produits', icon: ShoppingBag, section: 'setup', href: '/products', hidden: !hasModule('products') },
    { key: 'price-lists', label: 'Listes de prix', icon: Tag, section: 'setup', href: '/price-lists', hidden: !hasModule('sales') || !isDirection },
    { key: 'promotions', label: 'Promotions et fidélité', icon: BadgePercent, section: 'setup', href: '/promotions', hidden: !hasModule('sales') },
    // Canaux de vente : écran intégré au module Ventes (route /sales-channels sous SalesLayout),
    // plus de renvoi vers Paramètres. Configuration réservée à la direction.
    { key: 'channels', label: 'Canaux de vente', icon: Radio, section: 'setup', href: '/sales-channels', hidden: !hasModule('sales') || !isDirection },
  ];
  const tab = params.get('tab');
  const currentKey = pathname === '/sales'
    ? `sales:${SALES_MAIN_TABS.some(t => t.key === tab) ? tab : 'sales'}`
    : pathname === '/reports'
      ? `reports:${tab === 'menu' || tab === 'margins' || tab === 'builder' ? tab : 'overview'}`
      : pathname === '/orders' || pathname.startsWith('/orders/')
        ? (tab === 'pro' ? 'orders:deliveries' : 'orders')
        : pathname.startsWith('/customers/')
          ? 'customers'
        : pathname === '/sales-channels'
          ? 'channels'
          : pathname.slice(1);
  const current = views.find(v => v.key === currentKey);

  return (
    <ModuleShell title="Ventes" views={views} current={current} onSelect={() => {}} bar={false} flush look="apple">
      {/* Refonte 2026-11 : briques communes au style cartes/panneaux dans tout le module (sales.css, .sal-module). */}
      <div className="sal-module"><Outlet /></div>
    </ModuleShell>
  );
}
