/** All application modules */
export const APP_MODULES = {
  dashboard: 'dashboard',
  pos: 'pos',
  sales: 'sales',
  orders: 'orders',
  products: 'products',
  customers: 'customers',
  /** ex-inventory : stock principal scelle (sacs/boites intacts). */
  economat: 'economat',
  /** alias retrocompat pour inventory : meme module que economat */
  inventory: 'inventory',
  recipes: 'recipes',
  production: 'production',
  employees: 'employees',
  accounting: 'accounting',
  purchasing: 'purchasing',
  users: 'users',
  reports: 'reports',
  settings: 'settings',
  replenishment: 'replenishment',
  unsold: 'unsold',
  /** ex-warehouse : pesage = stock en cours d'utilisation + file BSI magasinier. */
  pesage: 'pesage',
  /** alias retrocompat pour warehouse */
  warehouse: 'warehouse',
  /** Catalogue + stock des emballages (caissettes, boites, etiquettes...). */
  packaging: 'packaging',
  /** Rapprochement journalier (ISOLE, TEMPORAIRE) : appro - vendu - invendu. */
  reconciliation: 'reconciliation',
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

/**
 * Source de verite UNIQUE des libelles de modules, cote client comme serveur.
 * Aucun ecran ne doit redefinir son propre libelle : la nav, le fil d'ariane et
 * l'ecran des permissions lisent tous ici (cf. client/src/config/navigation.ts).
 *
 * Choix de vocabulaire volontaires :
 *  - 'Fiches techniques' plutot que 'Recettes' : en comptabilite « recettes » =
 *    encaissements, et le module Comptabilite est juste a cote.
 *  - 'Besoins' plutot que 'Approvisionnement' : dans les ERP du marche
 *    « approvisionnement » designe l'achat, or ici c'est le calcul des besoins.
 */
export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: 'Tableau de bord',
  pos: 'Point de vente',
  sales: 'Ventes',
  orders: 'Commandes',
  products: 'Produits',
  customers: 'Clients',
  economat: 'Économat',
  inventory: 'Économat',  // alias
  recipes: 'Fiches techniques',
  production: 'Production',
  employees: 'Personnel',
  accounting: 'Comptabilité',
  purchasing: 'Achats',
  users: 'Utilisateurs',
  reports: 'Rapports',
  settings: 'Paramètres',
  replenishment: 'Besoins',
  unsold: 'Invendus',
  pesage: 'Pesage',
  warehouse: 'Pesage',  // alias retrocompat
  packaging: 'Emballages',
  reconciliation: 'Contrôle des ventes',
};

/** Default permissions per role (used when no custom permissions are set) */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'economat', 'recipes', 'production', 'employees', 'accounting', 'purchasing', 'reports', 'replenishment', 'unsold', 'pesage', 'packaging', 'reconciliation'],
  cashier: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  saleswoman: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  baker: ['economat', 'recipes', 'production', 'replenishment', 'packaging', 'pesage'],
  pastry_chef: ['economat', 'recipes', 'production', 'replenishment', 'packaging', 'pesage'],
  viennoiserie: ['economat', 'recipes', 'production', 'replenishment', 'packaging', 'pesage'],
  beldi_sale: ['economat', 'recipes', 'production', 'replenishment', 'packaging', 'pesage'],
  /** Magasinier : pesage (BSI + sacs ouverts) + economat (stock scelle) + approv + emballages. */
  magasinier: ['pesage', 'economat', 'replenishment', 'packaging'],
};

export interface UserPermission {
  module: AppModule;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}
