import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings, Calculator,
  Package, PackageX, Truck, ClipboardCheck, ArrowLeftRight, Box,
} from 'lucide-react';
import { MODULE_LABELS } from '@ofauria/shared';
import type { AppModule } from '@ofauria/shared';

/**
 * Definition UNIQUE de la navigation : lanceur d'applications (AppLayout), grille
 * d'accueil (HomePage), fil d'ariane (Header), sidebar.
 *
 * Avant : quatre listes en dur qui avaient deja diverge sur les libelles
 * (« RH » vs « Personnel », « Contrôle ouverture » vs « Invendus ») ET sur les cles
 * de permission (AppLayout filtrait sur 'inventory', HomePage sur 'economat', qui
 * sont deux chaines distinctes pour hasModule — voir le champ `aliases`).
 * Les libelles viennent de MODULE_LABELS (shared) pour rester alignes avec l'ecran
 * des permissions.
 */
export interface NavItem {
  /** Module de permission principal, et cle de lecture du libelle. */
  module: AppModule;
  /**
   * Cles historiques designant le meme module ('economat' ~ 'inventory',
   * 'pesage' ~ 'warehouse'). hasModule compare la chaine brute sans resoudre les
   * alias : l'entree est visible des qu'UNE des cles est accordee, sinon un compte
   * dont les droits ont ete enregistres sous l'ancienne cle perdrait l'acces.
   */
  aliases?: AppModule[];
  href: string;
  icon: typeof LayoutDashboard;
  color: string;
  /** Sous-titre affiche sur la grille d'accueil. */
  description: string;
  /**
   * Override de libelle, reserve aux entrees qui ne sont PAS 1:1 avec un module.
   * Seul cas aujourd'hui : 'unsold' porte deux ecrans distincts (Invendus et
   * Contrôle ouverture). Partout ailleurs, laisser MODULE_LABELS decider.
   */
  label?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Entree d'accueil, hors groupes (toujours en tete du lanceur). */
export const NAV_HOME: NavItem = {
  module: 'dashboard', href: '/', icon: LayoutDashboard, color: 'bg-blue-500',
  description: "Vue d'ensemble de l'activite",
};

/**
 * Regroupement par domaine metier, dans l'ordre du flux : on vend, on achete et on
 * stocke, on produit, on controle, on gere. Une liste plate de 19 entrees ne
 * racontait aucun flux et melangeait referentiel et operationnel.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Ventes',
    items: [
      { module: 'pos', href: '/pos', icon: Monitor, color: 'bg-green-600',
        description: 'Caisse et ventes directes' },
      { module: 'sales', href: '/sales', icon: Receipt, color: 'bg-emerald-500',
        description: 'Historique des ventes' },
      { module: 'orders', href: '/orders', icon: ClipboardList, color: 'bg-orange-500',
        description: 'Commandes clients a produire' },
      { module: 'customers', href: '/customers', icon: Users, color: 'bg-cyan-600',
        description: 'Fichier clients et fidelite' },
    ],
  },
  {
    title: 'Achats & Stock',
    items: [
      { module: 'purchasing', href: '/purchasing', icon: ShoppingBag, color: 'bg-blue-700',
        description: 'Fournisseurs, commandes et factures' },
      { module: 'economat', aliases: ['inventory'], href: '/inventory', icon: Warehouse, color: 'bg-amber-600',
        description: 'Stock principal scelle (sacs/boites intacts)' },
      { module: 'pesage', aliases: ['warehouse'], href: '/warehouse', icon: Truck, color: 'bg-amber-500',
        description: "Stock en cours d'utilisation + BSI magasinier" },
      { module: 'packaging', href: '/packaging', icon: Box, color: 'bg-blue-500',
        description: 'Caissettes, boites, etiquettes, films' },
    ],
  },
  {
    title: 'Production',
    items: [
      { module: 'recipes', href: '/recipes', icon: ChefHat, color: 'bg-pink-500',
        description: 'Nomenclatures et couts de fabrication' },
      { module: 'production', href: '/production', icon: Factory, color: 'bg-indigo-500',
        description: 'Planification de la fabrication' },
      { module: 'replenishment', href: '/replenishment', icon: Package, color: 'bg-rose-500',
        description: 'Demandes et transferts de stock' },
    ],
  },
  {
    title: 'Contrôle',
    items: [
      { module: 'unsold', href: '/unsold', icon: PackageX, color: 'bg-orange-600',
        description: 'Decisions sur les invendus du jour' },
      { module: 'unsold', href: '/inventory-check/validation', icon: ClipboardCheck, color: 'bg-orange-700',
        label: 'Contrôle ouverture', description: "Validation du stock d'ouverture" },
      { module: 'reconciliation', href: '/reconciliation', icon: ArrowLeftRight, color: 'bg-lime-600',
        description: 'Suivi appro, transferts et invendus' },
    ],
  },
  {
    title: 'Gestion',
    items: [
      { module: 'accounting', href: '/accounting', icon: Calculator, color: 'bg-yellow-600',
        description: 'Caisse, charges et tresorerie' },
      { module: 'employees', href: '/employees', icon: UserCog, color: 'bg-teal-600',
        description: 'Pointage, paie et dossiers du personnel' },
      { module: 'reports', href: '/reports', icon: BarChart3, color: 'bg-red-500',
        description: 'Statistiques et analyses' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { module: 'products', href: '/products', icon: ShoppingBag, color: 'bg-purple-500',
        description: 'Catalogue et tarifs' },
      { module: 'users', href: '/users', icon: Lock, color: 'bg-gray-600',
        description: "Comptes et droits d'acces" },
      { module: 'settings', href: '/settings', icon: Settings, color: 'bg-slate-600',
        description: "Personnalisation de l'application" },
    ],
  },
];

/** Libelle affiche : MODULE_LABELS, sauf override explicite. */
export function navLabel(item: NavItem): string {
  return item.label ?? MODULE_LABELS[item.module];
}

/** Visible si le module principal OU l'une de ses cles historiques est accorde. */
export function isNavItemVisible(item: NavItem, hasModule: (m: AppModule) => boolean): boolean {
  return hasModule(item.module) || (item.aliases?.some(hasModule) ?? false);
}

/** Groupes filtres sur les droits, groupes vides ecartes (pas de titre orphelin). */
export function visibleNavGroups(hasModule: (m: AppModule) => boolean): NavGroup[] {
  return NAV_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => isNavItemVisible(item, hasModule)) }))
    .filter(group => group.items.length > 0);
}

/** Toutes les entrees a plat, accueil compris. */
export const NAV_ITEMS: NavItem[] = [NAV_HOME, ...NAV_GROUPS.flatMap(g => g.items)];

/**
 * Fil d'ariane : premier segment d'URL -> libelle. En cas de collision (deux ecrans
 * sous /inventory-check), la premiere entree declaree dans NAV_GROUPS gagne.
 */
export const NAV_LABEL_BY_PATH: Record<string, string> = NAV_ITEMS.reduce((acc, item) => {
  const segment = '/' + item.href.split('/')[1];
  if (!acc[segment]) acc[segment] = navLabel(item);
  return acc;
}, {} as Record<string, string>);
