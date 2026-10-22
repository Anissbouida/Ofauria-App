import * as shared from '@ofauria/shared';

/**
 * Règles pures des droits par module (sans accès base) : utilisées par
 * access-rights.ts, les middlewares et les tests unitaires.
 */

export type RightAction = 'view' | 'create' | 'edit' | 'delete';

export interface RightRow {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  config: Record<string, unknown>;
}

export interface EffectiveRights {
  roleCode: string;
  baseRole: string;
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
