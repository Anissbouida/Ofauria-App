/** All application modules */
export const APP_MODULES = {
  dashboard: 'dashboard',
  pos: 'pos',
  sales: 'sales',
  orders: 'orders',
  products: 'products',
  customers: 'customers',
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
  /** Tableau de bord du magasinier : file d'attente des BSI a preparer. */
  warehouse: 'warehouse',
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: 'Tableau de bord',
  pos: 'Point de vente',
  sales: 'Ventes',
  orders: 'Commandes',
  products: 'Produits',
  customers: 'Clients',
  inventory: 'Inventaire',
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
  warehouse: 'Economat',
};

/** Default permissions per role (used when no custom permissions are set) */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'inventory', 'recipes', 'production', 'employees', 'accounting', 'purchasing', 'reports', 'replenishment', 'unsold', 'warehouse'],
  cashier: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  saleswoman: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  baker: ['inventory', 'recipes', 'production', 'replenishment'],
  pastry_chef: ['inventory', 'recipes', 'production', 'replenishment'],
  viennoiserie: ['inventory', 'recipes', 'production', 'replenishment'],
  beldi_sale: ['inventory', 'recipes', 'production', 'replenishment'],
  /** Magasinier : economat (tableau des BSI a preparer) + inventaire + approvisionnement. */
  magasinier: ['warehouse', 'inventory', 'replenishment'],
};

export interface UserPermission {
  module: AppModule;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}
