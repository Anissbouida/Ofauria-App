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
  /** Projets (mig 358) : chantiers, événements, missions ; tâches et temps passé. */
  projects: 'projects',
  /** CRM (mig 371) : opportunités, pipeline commercial et activités. */
  crm: 'crm',
  /** Maintenance (mig 359) : plans d'entretien et interventions, interne ou chez le client. */
  maintenance: 'maintenance',
} as const;

export type AppModule = (typeof APP_MODULES)[keyof typeof APP_MODULES];

/** Module canonique d'une cle (elle-meme si ce n'est pas un alias).
 *  MODULE_ALIASES / LEGACY_MODULE_KEYS / resolveModuleKeys sont declares plus bas
 *  (une seule source, partagee client + serveur). */
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
  packaging: 'Stock',   // alias (emballages = onglet Consommables du Stock)
  reconciliation: 'Contrôle des ventes',
  controle: 'Contrôle & Qualité',
  projects: 'Projets',
  crm: 'CRM',
  maintenance: 'Maintenance',
};

/** Default permissions per role (used when no custom permissions are set).
 *  Cles CANONIQUES (stock = economat+pesage unifies, cf. MODULE_ALIASES). */
export const DEFAULT_ROLE_MODULES: Record<string, AppModule[]> = {
  admin: Object.values(APP_MODULES),
  manager: ['dashboard', 'pos', 'sales', 'orders', 'products', 'customers', 'stock', 'recipes', 'production', 'employees', 'accounting', 'purchasing', 'reports', 'replenishment', 'unsold', 'reconciliation', 'controle', 'projects', 'maintenance', 'crm'],
  cashier: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  saleswoman: ['pos', 'orders', 'customers', 'production', 'replenishment', 'unsold'],
  // Les chefs demandent les ingredients depuis leur plan ; le pesage (preparation
  // des bons) est le poste du magasinier.
  baker: ['stock', 'recipes', 'production', 'replenishment'],
  pastry_chef: ['stock', 'recipes', 'production', 'replenishment'],
  viennoiserie: ['stock', 'recipes', 'production', 'replenishment'],
  beldi_sale: ['stock', 'recipes', 'production', 'replenishment'],
  /** Magasinier : stock (scelle + entame + BSI) + approv + emballages. */
  magasinier: ['stock', 'replenishment'],
};

/**
 * Fusion Stock : 'stock' est la cle canonique ; les cles historiques
 * economat/inventory/pesage/warehouse designent le meme module (droit unique).
 * MODULE_ALIASES mappe canonique -> cles legacy ; LEGACY_MODULE_KEYS liste les
 * cles a MASQUER dans l'ecran des droits (remplacees par 'stock').
 */
export const MODULE_ALIASES: Partial<Record<string, string[]>> = {
  stock: ['economat', 'inventory', 'pesage', 'warehouse', 'packaging'],
};
export const LEGACY_MODULE_KEYS: ReadonlySet<string> = new Set(['economat', 'inventory', 'pesage', 'warehouse', 'packaging']);

/** Un module et ses cles equivalentes (canonique <-> legacy), dans les deux sens. */
export function resolveModuleKeys(module: string): string[] {
  const keys = new Set<string>([module, ...(MODULE_ALIASES[module] ?? [])]);
  for (const [canon, aliases] of Object.entries(MODULE_ALIASES)) {
    if (aliases?.includes(module)) { keys.add(canon); aliases.forEach(a => keys.add(a)); }
  }
  return [...keys];
}

export interface UserPermission {
  module: AppModule;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}

// ─── Alignement ERP (Phase 1) ───────────────────────────────────────────
// Deux dimensions que les grands ERP ajoutent au CRUD par module :
//  1. des VERBES MÉTIER (approuver, valider, comptabiliser…) au-delà de
//     créer/modifier/supprimer ;
//  2. une PORTÉE DES DONNÉES déclarative (ses enregistrements / son
//     établissement / tous), équivalent des « record rules » Odoo.
// Les deux sont stockés dans le JSONB `config` d'un droit (role_permissions
// ou user_permissions) : config.verbs (string[]) et config.scope. Aucune
// colonne dédiée — voir migration 335 et services/access-rules.ts.

/** Portée des données d'un droit (du plus restreint au plus large). */
export type DataScope = 'own' | 'store' | 'all';
export const DATA_SCOPES: DataScope[] = ['own', 'store', 'all'];
/** Rang de permissivité : « all » > « store » > « own ». */
export const DATA_SCOPE_RANK: Record<DataScope, number> = { own: 0, store: 1, all: 2 };
export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  own: 'Ses enregistrements',
  store: 'Son établissement',
  all: 'Tous les établissements',
};
/** Portée par défaut d'un droit non précisé : l'établissement de l'utilisateur. */
export const DEFAULT_DATA_SCOPE: DataScope = 'store';

/** Actions métier au-delà du CRUD (verbes ERP). */
export type BusinessVerb = 'approve' | 'validate' | 'post' | 'export' | 'print' | 'close';
export const BUSINESS_VERBS: BusinessVerb[] = ['approve', 'validate', 'post', 'export', 'print', 'close'];
export const BUSINESS_VERB_LABELS: Record<BusinessVerb, string> = {
  approve: 'Approuver',
  validate: 'Valider',
  post: 'Comptabiliser',
  export: 'Exporter',
  print: 'Imprimer',
  close: 'Clôturer',
};

/**
 * Verbes métier proposés par module (un module absent n'expose aucun verbe
 * spécifique). Sert à l'écran des droits : seules ces cases apparaissent.
 * L'application effective des verbes (ex. bloquer l'approbation d'un BC) se
 * branche sur les flux métier (Phase 2, avec les limites d'approbation).
 */
export const MODULE_VERBS: Partial<Record<AppModule, BusinessVerb[]>> = {
  purchasing: ['approve', 'validate', 'post', 'export', 'print'],
  accounting: ['validate', 'post', 'export', 'print', 'close'],
  production: ['validate', 'close', 'print'],
  replenishment: ['approve', 'validate'],
  employees: ['validate', 'export', 'print'],
  recipes: ['validate', 'export', 'print'],
  reports: ['export', 'print'],
  sales: ['export', 'print'],
  pos: ['print'],
  reconciliation: ['validate', 'close'],
};

export function isBusinessVerb(v: unknown): v is BusinessVerb {
  return typeof v === 'string' && (BUSINESS_VERBS as string[]).includes(v);
}
export function isDataScope(v: unknown): v is DataScope {
  return typeof v === 'string' && (DATA_SCOPES as string[]).includes(v);
}

// ─── Gouvernance (Phase 2) ──────────────────────────────────────────────
// Une « capacité » est l'unité manipulée par la séparation des tâches (SoD) :
// une action CRUD ou un verbe métier, sur un module donné.
export type Capability = 'view' | 'create' | 'edit' | 'delete' | BusinessVerb;
export const CAPABILITY_LABELS: Record<Capability, string> = {
  view: 'Voir', create: 'Créer', edit: 'Modifier', delete: 'Supprimer',
  approve: 'Approuver', validate: 'Valider', post: 'Comptabiliser',
  export: 'Exporter', print: 'Imprimer', close: 'Clôturer',
};
export const CAPABILITIES: Capability[] = Object.keys(CAPABILITY_LABELS) as Capability[];
export function isCapability(v: unknown): v is Capability {
  return typeof v === 'string' && (CAPABILITIES as string[]).includes(v);
}

/** Types de document soumis à un plafond d'approbation par rôle. */
export type ApprovalDocumentType = 'purchase_order' | 'expense' | 'invoice' | 'payment';
export const APPROVAL_DOCUMENT_TYPES: ApprovalDocumentType[] = ['purchase_order', 'expense', 'invoice', 'payment'];
export const APPROVAL_DOCUMENT_LABELS: Record<ApprovalDocumentType, string> = {
  purchase_order: 'Bon de commande',
  expense: 'Dépense',
  invoice: 'Facture',
  payment: 'Paiement',
};
export function isApprovalDocumentType(v: unknown): v is ApprovalDocumentType {
  return typeof v === 'string' && (APPROVAL_DOCUMENT_TYPES as string[]).includes(v);
}
