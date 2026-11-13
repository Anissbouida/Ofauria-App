import { APP_MODULES, LEGACY_MODULE_KEYS, canonicalModule, type AppModule } from './modules.js';

/**
 * Activation des modules (plan Production générique, lot P0a, mig 507).
 *
 * Le secteur d'activité est un PRÉRÉGLAGE ; l'administrateur ajuste ensuite chaque
 * module dans Paramètres › Secteur et modules. Ce fichier est la source unique,
 * client + serveur, des règles de cet écran : modules activables, modules socle,
 * regroupement, dépendances, et calcul des modules effectifs.
 */

/** Modules qu'on peut activer ou désactiver : clés canoniques (sans les alias du Stock). */
export const ACTIVATABLE_MODULES: AppModule[] =
  (Object.values(APP_MODULES) as AppModule[]).filter(m => !LEGACY_MODULE_KEYS.has(m));

/** Modules socle : toujours actifs, jamais désactivables. */
export const CORE_MODULES: ReadonlySet<AppModule> = new Set<AppModule>(['dashboard', 'settings', 'users']);

/**
 * Dépendances : un module ne fonctionne pas sans ceux-ci. Activer un module active
 * ses dépendances ; désactiver un module désactive ceux qui en dépendent.
 */
export const MODULE_DEPENDENCIES: Partial<Record<AppModule, AppModule[]>> = {
  production: ['recipes', 'stock'],
  recipes: ['production'],
  unsold: ['production'],
  replenishment: ['production'],
  reconciliation: ['pos'],
};

/** Une ligne d'explication par module, affichée sous l'interrupteur. */
export const MODULE_DESCRIPTIONS: Partial<Record<AppModule, string>> = {
  dashboard: "Page d'accueil et indicateurs du jour.",
  pos: 'Caisse en boutique : tickets, encaissements, fermetures.',
  sales: 'Historique des ventes, bons de livraison, factures émises et créances.',
  orders: 'Commandes clients et devis.',
  customers: 'Fiches clients, encours et fidélité.',
  crm: 'Opportunités, pipeline commercial et activités.',
  products: 'Catalogue des articles vendus, prix et catégories.',
  stock: 'Matières, emballages, lots, inventaires et sorties magasin.',
  purchasing: "Demandes d'achat, demandes de prix, bons de commande et réceptions.",
  recipes: 'Fiches techniques (nomenclatures) : composition, coût et étapes.',
  production: 'Plans de production, lancement, consommation matière et coût réel.',
  replenishment: 'Demandes de réassort des boutiques vers le laboratoire.',
  unsold: 'Décisions sur les invendus du jour : réexposer, recycler ou jeter.',
  reconciliation: 'Contrôle des ventes par service : approvisionné − vendu − invendu.',
  employees: 'Personnel, plannings, pointage, congés et paie.',
  accounting: 'Comptabilité, trésorerie, TVA et clôtures.',
  reports: 'Rapports et tableaux de bord.',
  controle: 'Contrôles, anomalies et registre des pertes.',
  projects: 'Projets, tâches et temps passé.',
  maintenance: "Plans d'entretien et interventions.",
  users: "Comptes, rôles et droits d'accès.",
  settings: "Paramétrage de l'application.",
};

/** Regroupement des modules dans l'écran, dans l'ordre d'affichage. */
export const MODULE_GROUPS: { key: string; label: string; modules: AppModule[] }[] = [
  { key: 'sales', label: 'Ventes et caisse', modules: ['pos', 'sales', 'orders', 'customers', 'crm'] },
  { key: 'supply', label: 'Catalogue, achats et stock', modules: ['products', 'stock', 'purchasing'] },
  { key: 'production', label: 'Production', modules: ['recipes', 'production', 'replenishment', 'unsold', 'reconciliation'] },
  { key: 'management', label: 'Gestion', modules: ['employees', 'accounting', 'reports', 'controle', 'projects', 'maintenance'] },
  { key: 'core', label: 'Socle', modules: ['dashboard', 'users', 'settings'] },
];

/** Écart au préréglage : true = activé, false = désactivé (pas d'entrée = suit le secteur). */
export type ModuleOverrides = Partial<Record<string, boolean>>;

/**
 * Modules effectifs : modules du secteur + activés − désactivés, en clés canoniques.
 * Les modules socle sont toujours présents. Un alias du secteur (ex. « packaging »)
 * compte pour son module canonique (« stock ») : désactiver le Stock le retire aussi.
 */
export function effectiveModules(packModules: readonly string[], overrides: ModuleOverrides): Set<AppModule> {
  const set = new Set<AppModule>(packModules.map(m => canonicalModule(m as AppModule)));
  for (const [key, enabled] of Object.entries(overrides)) {
    if (enabled === undefined) continue;
    const canon = canonicalModule(key as AppModule);
    if (enabled) set.add(canon); else set.delete(canon);
  }
  CORE_MODULES.forEach(m => set.add(m));
  return set;
}

/** Dépendances d'un module, en cascade (sans le module lui-même). */
export function requiredModules(module: AppModule): AppModule[] {
  const out = new Set<AppModule>();
  const walk = (m: AppModule) => {
    for (const d of MODULE_DEPENDENCIES[m] ?? []) {
      if (d !== module && !out.has(d)) { out.add(d); walk(d); }
    }
  };
  walk(module);
  return [...out];
}

/** Modules qui dépendent de celui-ci, en cascade (sans le module lui-même). */
export function dependentModules(module: AppModule): AppModule[] {
  const out = new Set<AppModule>();
  const walk = (m: AppModule) => {
    for (const [mod, deps] of Object.entries(MODULE_DEPENDENCIES) as [AppModule, AppModule[]][]) {
      if (deps.includes(m) && mod !== module && !out.has(mod)) { out.add(mod); walk(mod); }
    }
  };
  walk(module);
  return [...out];
}

/** Modules actifs auxquels manque une dépendance (configuration incohérente). */
export function missingDependencies(active: ReadonlySet<AppModule>): { module: AppModule; missing: AppModule[] }[] {
  const out: { module: AppModule; missing: AppModule[] }[] = [];
  for (const m of active) {
    const missing = (MODULE_DEPENDENCIES[m] ?? []).filter(d => !active.has(d));
    if (missing.length) out.push({ module: m, missing });
  }
  return out;
}

/**
 * Diffusion (lot P0c, mig 509). Modules qu'on peut fermer pour un établissement
 * précis : ceux dont l'usage dépend du lieu (caisse, labo, vitrine). Les modules
 * centraux (compta, achats, paramètres…) restent au niveau de la société.
 */
export const STORE_SCOPED_MODULES: ReadonlySet<AppModule> = new Set<AppModule>([
  'pos', 'production', 'replenishment', 'unsold', 'reconciliation',
]);

/** Pilote d'un module : seuls ces rôles et utilisateurs le voient. */
export type ModulePilot = { roles: string[]; users: string[] };

export type ModuleRollout = {
  /** Modules en pilote, avec leurs membres. */
  pilots: Partial<Record<string, ModulePilot>>;
  /** Modules fermés par établissement (store_id → modules). */
  storeDisabled: Partial<Record<string, string[]>>;
};

/**
 * Modules visibles par un utilisateur : modules effectifs de la société, moins les
 * modules en pilote dont il n'est pas membre (l'administrateur est toujours membre),
 * moins les modules fermés pour son établissement.
 */
export function modulesForUser(
  companyModules: ReadonlySet<AppModule>,
  rollout: ModuleRollout,
  user: { userId: string; role: string; roles?: string[]; storeId?: string | null },
): Set<AppModule> {
  const roles = new Set([user.role, ...(user.roles ?? [])]);
  const closed = new Set(user.storeId ? rollout.storeDisabled[user.storeId] ?? [] : []);
  const out = new Set<AppModule>();
  for (const m of companyModules) {
    if (!CORE_MODULES.has(m)) {
      const pilot = rollout.pilots[m];
      if (pilot && !roles.has('admin') && !pilot.users.includes(user.userId) && !pilot.roles.some(r => roles.has(r))) continue;
      if (closed.has(m)) continue;
    }
    out.add(m);
  }
  return out;
}
