/** All application modules */
export const APP_MODULES = {
  dashboard: 'dashboard',
  pos: 'pos',
  sales: 'sales',
  orders: 'orders',
  products: 'products',
  customers: 'customers',
  /**
   * Stock : fusion de l'Économat (stock scelle) et du Pesage (stock entame + bons de
   * sortie magasinier), decision du 2026-10-11. Les quatre cles ci-dessous restent
   * acceptees comme alias (droits deja enregistres), voir MODULE_ALIASES.
   */
  stock: 'stock',
  /** @deprecated alias de stock (ex-Économat). */
  economat: 'economat',
  /** @deprecated alias de stock (ex-inventory). */
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
  /** @deprecated alias de stock (ex-Pesage). */
  pesage: 'pesage',
  /** @deprecated alias de stock (ex-warehouse). */
  warehouse: 'warehouse',
  /** Catalogue + stock des emballages (caissettes, boites, etiquettes...). */
  packaging: 'packaging',
  /** Rapprochement journalier (ISOLE, TEMPORAIRE) : appro - vendu - invendu. */
  reconciliation: 'reconciliation',
  /**
   * Contrôle & Qualité (2026-10-18) : vue d'ensemble des anomalies, contrôles des
   * ventes / achats / production et registre unifié des pertes (mig 313).
   */
  controle: 'controle',
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

/**
 * Cles historiques designant le meme module. hasModule (client) accorde le module
 * des qu'UNE des cles est presente dans les droits de l'utilisateur, sinon un compte
 * dont les droits ont ete enregistres sous l'ancienne cle perdrait l'acces.
 */
export const MODULE_ALIASES: Partial<Record<AppModule, AppModule[]>> = {
  stock: ['economat', 'inventory', 'pesage', 'warehouse'],
};

/** Cles qui ne sont que des alias : masquees dans l'ecran des droits et la navigation. */
export const LEGACY_MODULE_KEYS: ReadonlySet<AppModule> = new Set(
  Object.values(MODULE_ALIASES).flat() as AppModule[],
);

/** Module canonique d'une cle (elle-meme si ce n'est pas un alias). */
export function canonicalModule(module: AppModule): AppModule {
  for (const [canon, aliases] of Object.entries(MODULE_ALIASES)) {
    if (aliases?.includes(module)) return canon as AppModule;
  }
  return module;
}

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
  stock: 'Stock',
  economat: 'Stock',   // alias
  inventory: 'Stock',  // alias
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
  pesage: 'Stock',     // alias
  warehouse: 'Stock',  // alias
  packaging: 'Emballages',
  reconciliation: 'Contrôle des ventes',
  controle: 'Contrôle & Qualité',
};

/** Default permissions per role (used when no custom permissions are set) */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'stock', 'recipes', 'production', 'employees', 'accounting', 'purchasing', 'reports', 'replenishment', 'unsold', 'packaging', 'reconciliation', 'controle'],
  cashier: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  saleswoman: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  // Les chefs demandent les ingredients depuis leur plan ; le pesage (preparation
  // des bons) est le poste du magasinier.
  baker: ['stock', 'recipes', 'production', 'replenishment', 'packaging'],
  pastry_chef: ['stock', 'recipes', 'production', 'replenishment', 'packaging'],
  viennoiserie: ['stock', 'recipes', 'production', 'replenishment', 'packaging'],
  beldi_sale: ['stock', 'recipes', 'production', 'replenishment', 'packaging'],
  /** Magasinier : stock (scelle + entame + BSI) + approv + emballages. */
  magasinier: ['stock', 'replenishment', 'packaging'],
};

export interface UserPermission {
  module: AppModule;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}
