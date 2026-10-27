import {
  LayoutDashboard, Monitor, Receipt, ClipboardList, ShoppingBag,
  Users, Warehouse, ChefHat, Factory, UserCog, Lock, BarChart3, Settings, Calculator,
  Package, Box, Store, Tag, FolderKanban, Wrench, ShieldCheck, TrendingUp, Thermometer, ShieldAlert, ClipboardCheck,
} from 'lucide-react';
import { MODULE_LABELS, MODULE_ALIASES, ROLE_GROUPS } from '@ofauria/shared';
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
   * Cles historiques designant le meme module (voir MODULE_ALIASES dans shared).
   * hasModule resout deja les alias ; la liste est gardee ici pour les consommateurs
   * qui testent une cle brute.
   */
  aliases?: AppModule[];
  href: string;
  icon: typeof LayoutDashboard;
  color: string;
  /** Sous-titre affiche sur la grille d'accueil. */
  description: string;
  /**
   * Override de libelle, reserve aux entrees qui ne sont PAS 1:1 avec un module.
   * Cas aujourd'hui : 'unsold' porte la Journée boutique (ouverture, ventes,
   * invendus) et 'production' porte aussi Prévisions et Relevés HACCP.
   * Partout ailleurs, laisser MODULE_LABELS decider.
   */
  label?: string;
  /**
   * Restriction par rôle, en plus du module. Sert aux écrans hébergés par un module
   * large : 'production' est aussi accordé aux vendeuses, mais Prévisions et
   * Relevés HACCP ne concernent que les chefs et le gérant.
   */
  roles?: string[];
  /** Compteur affiché en pastille sur la tuile (ex. pièces à approuver). */
  counter?: 'approvals';
}

/** Chefs + gérant + admin : mêmes rôles que les routes serveur concernées. */
const PRODUCTION_ROLES: string[] = ROLE_GROUPS.PRODUCTION;

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
      // Projets (mig 358) : travaux suivis dans le temps pour un client — événement,
      // chantier, mission, commande sur devis — avec tâches et temps passé.
      { module: 'projects', href: '/projects', icon: FolderKanban, color: 'bg-fuchsia-600',
        description: 'Événements, chantiers, missions : tâches et temps passé' },
      // Catalogue et tarifs : c'est ce qu'on vend (prix, canaux) ; les recettes,
      // elles, restent en Production.
      { module: 'products', href: '/products', icon: Tag, color: 'bg-purple-500',
        description: 'Catalogue et tarifs' },
    ],
  },
  {
    title: 'Achats & Stock',
    items: [
      { module: 'purchasing', href: '/purchasing', icon: ShoppingBag, color: 'bg-blue-700',
        description: 'Fournisseurs, commandes et factures' },
      { module: 'stock', aliases: MODULE_ALIASES.stock as AppModule[] | undefined, href: '/stock', icon: Warehouse, color: 'bg-amber-600',
        description: 'Stock scelle, stock entame et bons de sortie' },
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
      { module: 'production', href: '/forecast', icon: TrendingUp, color: 'bg-violet-500',
        label: 'Prévisions', description: 'Quantités suggérées par produit et par jour', roles: PRODUCTION_ROLES },
      { module: 'production', href: '/haccp', icon: Thermometer, color: 'bg-sky-600',
        label: 'Relevés HACCP', description: 'Températures, nettoyage et actions correctives', roles: PRODUCTION_ROLES },
      { module: 'replenishment', href: '/replenishment', icon: Package, color: 'bg-rose-500',
        description: 'Demandes et transferts de stock' },
    ],
  },
  {
    title: 'Contrôle',
    items: [
      // Circuits d'approbation (lot 8) : la boîte « À approuver » sans passer par la cloche.
      { module: 'purchasing', href: '/approvals', icon: ClipboardCheck, color: 'bg-amber-500',
        label: 'Approbations', description: 'Bons de commande, avoirs et écarts qui attendent une décision',
        counter: 'approvals' },
      { module: 'controle', href: '/controle', icon: ShieldCheck, color: 'bg-emerald-600',
        description: 'Anomalies, contrôles et registre des pertes' },
      { module: 'unsold', aliases: ['reconciliation'], href: '/boutique', icon: Store, color: 'bg-orange-600',
        label: 'Journée boutique', description: 'Ouverture, appro et ventes, invendus du jour' },
      // Rappel de lot : traçabilité descendante (matière → clients). Réservé admin/gérant
      // (module 'reconciliation'), cohérent avec la route API réservée.
      { module: 'reconciliation', href: '/traceability/recall', icon: ShieldAlert, color: 'bg-red-700',
        label: 'Rappel de lot', description: "Remonter d'un lot matière aux clients" },
    ],
  },
  {
    title: 'Gestion',
    items: [
      { module: 'accounting', href: '/accounting', icon: Calculator, color: 'bg-yellow-600',
        description: 'Caisse, charges et tresorerie' },
      { module: 'employees', href: '/employees', icon: UserCog, color: 'bg-teal-600',
        description: 'Pointage, paie et dossiers du personnel' },
      // Maintenance (mig 359) : entretien du matériel (immobilisations) et interventions chez le client.
      { module: 'maintenance', href: '/maintenance', icon: Wrench, color: 'bg-stone-600',
        description: 'Entretien du matériel et interventions chez le client' },
      // Les rapports vivent dans leurs modules (Ventes › Rapports, Production › Coûts) ;
      // cette tuile ouvre le tableau de bord des ventes.
      { module: 'reports', href: '/reports', icon: BarChart3, color: 'bg-red-500',
        description: 'Tableau de bord des ventes, marges et coûts' },
    ],
  },
  {
    title: 'Administration',
    items: [
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

/**
 * Visible si le module principal OU l'une de ses cles historiques est accorde,
 * et si le role est autorise quand l'entree en restreint (roles).
 */
export function isNavItemVisible(item: NavItem, hasModule: (m: AppModule) => boolean, role?: string): boolean {
  if (item.roles && !(role && item.roles.includes(role))) return false;
  return hasModule(item.module) || (item.aliases?.some(hasModule) ?? false);
}

/** Groupes filtres sur les droits, groupes vides ecartes (pas de titre orphelin). */
export function visibleNavGroups(hasModule: (m: AppModule) => boolean, role?: string): NavGroup[] {
  return NAV_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => isNavItemVisible(item, hasModule, role)) }))
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
