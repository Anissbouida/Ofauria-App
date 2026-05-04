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
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: 'Tableau de bord',
  pos: 'Point de vente',
  sales: 'Ventes',
  orders: 'Commandes',
  products: 'Produits',
  customers: 'Clients',
  economat: 'Économat',
  inventory: 'Économat',  // alias
  recipes: 'Recettes',
  production: 'Production',
  employees: 'Personnel',
  accounting: 'Comptabilite',
  purchasing: 'Achats',
  users: 'Utilisateurs',
  reports: 'Rapports',
  settings: 'Parametres',
  replenishment: 'Approvisionnement',
  unsold: 'Invendus',
  pesage: 'Pesage',
  warehouse: 'Pesage',  // alias retrocompat
  packaging: 'Emballages',
};

/** Default permissions per role (used when no custom permissions are set) */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'economat', 'recipes', 'production', 'employees', 'accounting', 'purchasing', 'reports', 'replenishment', 'unsold', 'pesage', 'packaging'],
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
