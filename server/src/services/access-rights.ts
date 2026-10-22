import * as shared from '@ofauria/shared';
import { db } from '../config/database.js';

/**
 * Droits effectifs d'un utilisateur (mig 330) :
 *   - administrateur : tout ;
 *   - exceptions de l'utilisateur (user_permissions) si elles existent : elles
 *     remplacent les droits du rôle, comme avant ;
 *   - sinon droits du rôle (role_permissions), éditables dans Utilisateurs › Rôles.
 * Si la table roles n'existe pas encore (migration 330 non appliquée), repli
 * sur DEFAULT_ROLE_MODULES : voir / créer / modifier, jamais supprimer.
 */

export { hasRight, moduleKeys, rightRow } from './access-rules.js';
export type { RightAction, RightRow, EffectiveRights } from './access-rules.js';
import type { RightRow, EffectiveRights } from './access-rules.js';

// ─── Rôles (cache court : un rôle modifié s'applique en moins de 30 s) ─────
type RoleInfo = { code: string; label: string; baseRole: string; isSystem: boolean };
let rolesCache: { at: number; byCode: Map<string, RoleInfo>; tablesExist: boolean } | null = null;
const TTL_MS = 30_000;

async function loadRoles() {
  if (rolesCache && Date.now() - rolesCache.at < TTL_MS) return rolesCache;
  const exists = (await db.query(`SELECT to_regclass('public.roles') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  const byCode = new Map<string, RoleInfo>();
  if (exists) {
    const r = await db.query(`SELECT code, label, base_role, is_system FROM roles`);
    for (const x of r.rows) byCode.set(x.code, { code: x.code, label: x.label, baseRole: x.base_role, isSystem: x.is_system });
  }
  rolesCache = { at: Date.now(), byCode, tablesExist: exists };
  return rolesCache;
}

/** À appeler après une modification des rôles ou de leurs droits. */
export function invalidateRolesCache() { rolesCache = null; }

/** Rôle de base (périmètre technique) et libellé d'un code de rôle. */
export async function resolveRole(code: string): Promise<RoleInfo> {
  const { byCode } = await loadRoles();
  const labels = (shared as unknown as { ROLE_LABELS?: Record<string, string> }).ROLE_LABELS ?? {};
  return byCode.get(code) ?? { code, label: labels[code] ?? code, baseRole: code, isSystem: true };
}

let modeCache: { at: number; mode: 'off' | 'log' | 'enforce' } | null = null;
/** Mode de contrôle des droits par module (company_settings, mig 330). */
export async function enforcementMode(): Promise<'off' | 'log' | 'enforce'> {
  if (modeCache && Date.now() - modeCache.at < TTL_MS) return modeCache.mode;
  // Colonne absente (migration 330 non appliquée) : contrôle désactivé. Testé sans
  // provoquer d'erreur SQL, qui annulerait une transaction en cours.
  const has = (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'company_settings' AND column_name = 'security_module_enforcement'`)).rows.length > 0;
  const mode = (has
    ? (await db.query(`SELECT security_module_enforcement AS m FROM company_settings WHERE id = 1`)).rows[0]?.m ?? 'off'
    : 'off') as 'off' | 'log' | 'enforce';
  modeCache = { at: Date.now(), mode };
  return mode;
}
export function invalidateEnforcementMode() { modeCache = null; }

/** Droits effectifs, d'après le rôle enregistré en base (pas celui du jeton). */
export async function effectiveRights(userId: string): Promise<EffectiveRights> {
  const u = (await db.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0];
  const roleCode = (u?.role as string) ?? '';
  const role = await resolveRole(roleCode);
  if (role.baseRole === 'admin') {
    return { roleCode, baseRole: 'admin', isAdmin: true, source: 'admin', rows: [] };
  }
  const custom = await db.query(
    `SELECT module, can_view, can_create, can_edit, can_delete, config FROM user_permissions WHERE user_id = $1`, [userId]);
  if (custom.rows.length > 0) {
    return { roleCode, baseRole: role.baseRole, isAdmin: false, source: 'user', rows: custom.rows };
  }
  const { tablesExist } = await loadRoles();
  if (tablesExist) {
    const r = await db.query(
      `SELECT module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = $1`, [roleCode]);
    return { roleCode, baseRole: role.baseRole, isAdmin: false, source: 'role', rows: r.rows };
  }
  const defaults = ((shared.DEFAULT_ROLE_MODULES as Record<string, string[]>)[roleCode] ?? []);
  return {
    roleCode, baseRole: role.baseRole, isAdmin: false, source: 'role',
    rows: defaults.map(module => ({ module, can_view: true, can_create: true, can_edit: true, can_delete: false, config: {} })),
  };
}
