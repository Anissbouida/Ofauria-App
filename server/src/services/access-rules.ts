import * as shared from '@ofauria/shared';

/**
 * Règles pures des droits par module (sans accès base) : utilisées par
 * access-rights.ts, les middlewares et les tests unitaires.
 *
 * Deux dimensions au-delà du CRUD, stockées dans `config` d'un droit :
 *  - config.verbs  : verbes métier accordés (approuver, valider…) — hasVerb() ;
 *  - config.scope  : portée des données ('own' | 'store' | 'all') — effectiveScope().
 */

export type RightAction = 'view' | 'create' | 'edit' | 'delete';
export type DataScope = 'own' | 'store' | 'all';

// Rang de permissivité (all > store > own) et portée par défaut. Définis ici
// (module pur) pour ne pas dépendre à l'exécution d'une version de shared.
const SCOPE_RANK: Record<DataScope, number> = { own: 0, store: 1, all: 2 };
const DEFAULT_SCOPE: DataScope = 'store';
const isScope = (v: unknown): v is DataScope => v === 'own' || v === 'store' || v === 'all';

export interface RightRow {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  config: Record<string, unknown>;
}

export interface EffectiveRights {
  /** Rôle principal (celui porté par users.role / le jeton). */
  roleCode: string;
  /** Rôle de base du rôle principal (périmètre technique). */
  baseRole: string;
  /** Tous les rôles de l'utilisateur (mig 335). */
  roles: string[];
  /** Rôles de base de tous les rôles (pour les gardes authorize). */
  baseRoles: string[];
  isAdmin: boolean;
  source: 'admin' | 'user' | 'role';
  rows: RightRow[];
}

// Clés historiques d'un module (fusion Stock). Lu par espace de noms : la
// constante n'existe pas dans toutes les versions de shared.
const MODULE_ALIASES: Partial<Record<string, string[]>> =
  (shared as unknown as { MODULE_ALIASES?: Partial<Record<string, string[]>> }).MODULE_ALIASES
  ?? { stock: ['economat', 'inventory', 'pesage', 'warehouse'] };

/** Le module et ses clés historiques (et inversement : un alias vaut pour le module canonique). */
export function moduleKeys(module: string): string[] {
  const keys = new Set([module, ...(MODULE_ALIASES[module] ?? [])]);
  for (const [canon, aliases] of Object.entries(MODULE_ALIASES)) {
    if (aliases?.includes(module)) { keys.add(canon); aliases.forEach(a => keys.add(a)); }
  }
  return [...keys];
}

const flag = (row: RightRow, action: RightAction) =>
  action === 'view' ? row.can_view : action === 'create' ? row.can_create : action === 'edit' ? row.can_edit : row.can_delete;

/** Vrai si l'un des modules est accordé pour l'action. */
export function hasRight(rights: EffectiveRights, modules: string[], action: RightAction): boolean {
  if (rights.isAdmin) return true;
  const wanted = new Set(modules.flatMap(moduleKeys));
  return rights.rows.some(r => wanted.has(r.module) && flag(r, action));
}

export function rightRow(rights: EffectiveRights, module: string): RightRow | undefined {
  const keys = moduleKeys(module);
  return rights.rows.find(r => keys.includes(r.module));
}

// ─── Verbes métier et portée des données (alignement ERP, Phase 1) ───────

function rowVerbs(row: RightRow): string[] {
  const v = (row.config as { verbs?: unknown })?.verbs;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function rowScope(row: RightRow): DataScope {
  const s = (row.config as { scope?: unknown })?.scope;
  return isScope(s) ? s : DEFAULT_SCOPE;
}

/** Vrai si l'un des modules accorde ce verbe métier (admin : toujours). */
export function hasVerb(rights: EffectiveRights, modules: string[], verb: string): boolean {
  if (rights.isAdmin) return true;
  const wanted = new Set(modules.flatMap(moduleKeys));
  return rights.rows.some(r => wanted.has(r.module) && rowVerbs(r).includes(verb));
}

/**
 * Portée effective des données pour un module : la plus permissive parmi les
 * droits qui le couvrent (all > store > own). Administrateur : 'all'. Un droit
 * sans portée vaut 'store' (comportement actuel d'isolation par établissement).
 */
export function effectiveScope(rights: EffectiveRights, module: string): DataScope {
  if (rights.isAdmin) return 'all';
  const keys = new Set(moduleKeys(module));
  let best: DataScope | null = null;
  for (const r of rights.rows) {
    if (!keys.has(r.module)) continue;
    const s = rowScope(r);
    if (best === null || SCOPE_RANK[s] > SCOPE_RANK[best]) best = s;
  }
  return best ?? DEFAULT_SCOPE;
}

/** Fusionne deux `config` de droits : verbes en union, portée la plus permissive, tableaux en union. */
function mergeConfig(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'verbs') {
      const prev = Array.isArray(out.verbs) ? (out.verbs as unknown[]) : [];
      const next = Array.isArray(v) ? v : [];
      out.verbs = [...new Set([...prev, ...next])];
    } else if (k === 'scope') {
      const prev = isScope(out.scope) ? out.scope : DEFAULT_SCOPE;
      const nb = isScope(v) ? v : DEFAULT_SCOPE;
      out.scope = SCOPE_RANK[nb] > SCOPE_RANK[prev] ? nb : prev;
    } else if (Array.isArray(v) && Array.isArray(out[k])) {
      out[k] = [...new Set([...(out[k] as unknown[]), ...v])];
    } else if (!(k in out)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Union de droits de plusieurs rôles (mig 335) : regroupés par module, le plus
 * permissif gagne par action, verbes et portée fusionnés. L'ordre de sortie
 * suit la première apparition de chaque module.
 */
export function unionRights(rows: RightRow[]): RightRow[] {
  const byModule = new Map<string, RightRow>();
  for (const r of rows) {
    const cur = byModule.get(r.module);
    if (!cur) {
      byModule.set(r.module, {
        module: r.module,
        can_view: r.can_view, can_create: r.can_create, can_edit: r.can_edit, can_delete: r.can_delete,
        config: { ...(r.config ?? {}) },
      });
      continue;
    }
    cur.can_view = cur.can_view || r.can_view;
    cur.can_create = cur.can_create || r.can_create;
    cur.can_edit = cur.can_edit || r.can_edit;
    cur.can_delete = cur.can_delete || r.can_delete;
    cur.config = mergeConfig(cur.config, r.config ?? {});
  }
  return [...byModule.values()];
}
