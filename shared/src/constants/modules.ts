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
  users: 'users',
  reports: 'reports',
  settings: 'settings',
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: 'Tableau de bord',
  pos: 'Point de vente',
  sales: 'Ventes',
  orders: 'Pre-commandes',
  products: 'Produits',
  customers: 'Clients',
  inventory: 'Inventaire',
  recipes: 'Recettes',
  production: 'Production',
  employees: 'Personnel',
  accounting: 'Comptabilite',
  users: 'Utilisateurs',
  reports: 'Rapports',
  settings: 'Parametres',
};

/** Default permissions per role (used when no custom permissions are set) */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'inventory', 'recipes', 'production', 'employees', 'accounting', 'reports'],
  cashier: ['pos', 'orders', 'customers', 'production'],
  saleswoman: ['pos', 'orders', 'customers', 'production'],
  baker: ['inventory', 'recipes', 'production'],
  pastry_chef: ['inventory', 'recipes', 'production'],
  viennoiserie: ['inventory', 'recipes', 'production'],
};

export interface UserPermission {
  module: AppModule;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}
