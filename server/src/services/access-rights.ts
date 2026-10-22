import * as shared from '@ofauria/shared';
import { db } from '../config/database.js';
import { unionRights } from './access-rules.js';

/**
 * Droits effectifs d'un utilisateur (mig 330 + rôles multiples mig 335) :
 *   - administrateur (l'un de ses rôles a pour base admin) : tout ;
 *   - exceptions de l'utilisateur (user_permissions) si elles existent : elles
 *     remplacent les droits des rôles, comme avant ;
 *   - sinon UNION des droits de tous ses rôles (role_permissions), éditables
 *     dans Utilisateurs › Rôles.
 * Si la table roles n'existe pas encore (migration 330 non appliquée), repli
 * sur DEFAULT_ROLE_MODULES : voir / créer / modifier, jamais supprimer.
 */

export { hasRight, hasVerb, effectiveScope, scopeStoreFilter, hasCapability, evaluateSod, moduleKeys, rightRow, unionRights } from './access-rules.js';
export type { RightAction, RightRow, EffectiveRights, DataScope, SodRule, SodViolation } from './access-rules.js';
import type { RightRow, EffectiveRights, DataScope } from './access-rules.js';
import { effectiveScope } from './access-rules.js';

// ─── Rôles (cache court : un rôle modifié s'applique en moins de 30 s) ─────
type RoleInfo = { code: string; label: string; baseRole: string; isSystem: boolean };
let rolesCache: { at: number; byCode: Map<string, RoleInfo>; tablesExist: boolean; userRolesExist: boolean; delegationsExist: boolean } | null = null;
const TTL_MS = 30_000;

async function loadRoles() {
  if (rolesCache && Date.now() - rolesCache.at < TTL_MS) return rolesCache;
  const reg = (await db.query(
    `SELECT to_regclass('public.roles') IS NOT NULL AS roles_ok,
            to_regclass('public.user_roles') IS NOT NULL AS user_roles_ok,
            to_regclass('public.role_delegations') IS NOT NULL AS delegations_ok`)).rows[0];
  const exists = reg.roles_ok as boolean;
  const byCode = new Map<string, RoleInfo>();
  if (exists) {
    const r = await db.query(`SELECT code, label, base_role, is_system FROM roles`);
    for (const x of r.rows) byCode.set(x.code, { code: x.code, label: x.label, baseRole: x.base_role, isSystem: x.is_system });
  }
  rolesCache = {
    at: Date.now(), byCode, tablesExist: exists,
    userRolesExist: reg.user_roles_ok as boolean, delegationsExist: reg.delegations_ok as boolean,
  };
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

/**
 * Rôles d'un utilisateur et rôle principal (mig 335), augmentés des rôles
 * délégués actifs (mig 336). Le rôle principal reste celui de l'utilisateur ;
 * les rôles délégués s'ajoutent à l'union le temps de la fenêtre. Repli sur
 * users.role si la table user_roles n'existe pas encore.
 */
async function userRoleContext(userId: string): Promise<{ roleCodes: string[]; primary: string; delegated: string[] }> {
  const { userRolesExist, delegationsExist } = await loadRoles();
  let own: string[] = [];
  let primary = '';
  if (userRolesExist) {
    const r = await db.query(`SELECT role_code, is_primary FROM user_roles WHERE user_id = $1 ORDER BY is_primary DESC, role_code`, [userId]);
    if (r.rows.length > 0) {
      primary = (r.rows.find((x: { is_primary: boolean }) => x.is_primary)?.role_code as string) ?? r.rows[0].role_code;
      own = r.rows.map((x: { role_code: string }) => x.role_code);
    }
  }
  if (own.length === 0) {
    const u = (await db.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0];
    const role = (u?.role as string) ?? '';
    own = role ? [role] : [];
    primary = role;
  }
  let delegated: string[] = [];
  if (delegationsExist) {
    const d = await db.query(
      `SELECT DISTINCT role_code FROM role_delegations WHERE to_user_id = $1 AND now() BETWEEN starts_at AND ends_at`, [userId]);
    delegated = d.rows.map((x: { role_code: string }) => x.role_code).filter((c: string) => !own.includes(c));
  }
  return { roleCodes: [...own, ...delegated], primary, delegated };
}

/** Rôles de base distincts d'un ensemble de codes de rôle. */
async function baseRolesOf(roleCodes: string[]): Promise<string[]> {
  const infos = await Promise.all(roleCodes.map(resolveRole));
  return [...new Set(infos.map(i => i.baseRole).filter(Boolean))];
}

/**
 * Contexte de rôle pour la connexion : le jeton porte le rôle de base PRINCIPAL
 * (périmètre technique des routes) et l'ensemble des rôles de base (gardes
 * authorize multi-rôles). L'administrateur l'emporte dès qu'il est présent.
 */
export async function loginRoleContext(userId: string): Promise<{
  primaryBaseRole: string; baseRoles: string[]; roles: string[]; roleCode: string; roleLabel: string;
}> {
  const { roleCodes, primary } = await userRoleContext(userId);
  const baseRoles = await baseRolesOf(roleCodes);
  const primaryInfo = await resolveRole(primary);
  const primaryBaseRole = baseRoles.includes('admin') ? 'admin' : primaryInfo.baseRole;
  return { primaryBaseRole, baseRoles, roles: roleCodes, roleCode: primaryInfo.code, roleLabel: primaryInfo.label };
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

/** Droits effectifs, d'après les rôles enregistrés en base (pas celui du jeton). */
export async function effectiveRights(userId: string): Promise<EffectiveRights> {
  const { roleCodes, primary } = await userRoleContext(userId);
  const baseRoles = await baseRolesOf(roleCodes);
  const isAdmin = baseRoles.includes('admin');
  const primaryInfo = await resolveRole(primary);
  const roleCode = primary;
  const baseRole = isAdmin ? 'admin' : primaryInfo.baseRole;

  if (isAdmin) {
    return { roleCode, baseRole: 'admin', roles: roleCodes, baseRoles, isAdmin: true, source: 'admin', rows: [] };
  }

  const custom = await db.query(
    `SELECT module, can_view, can_create, can_edit, can_delete, config FROM user_permissions WHERE user_id = $1`, [userId]);
  if (custom.rows.length > 0) {
    return { roleCode, baseRole, roles: roleCodes, baseRoles, isAdmin: false, source: 'user', rows: custom.rows };
  }

  const { tablesExist } = await loadRoles();
  if (tablesExist) {
    const r = await db.query(
      `SELECT module, can_view, can_create, can_edit, can_delete, config
         FROM role_permissions WHERE role_code = ANY($1::varchar[])`, [roleCodes]);
    return { roleCode, baseRole, roles: roleCodes, baseRoles, isAdmin: false, source: 'role', rows: unionRights(r.rows as RightRow[]) };
  }

  const defaults = new Set<string>();
  for (const code of roleCodes) {
    for (const m of ((shared.DEFAULT_ROLE_MODULES as Record<string, string[]>)[code] ?? [])) defaults.add(m);
  }
  return {
    roleCode, baseRole, roles: roleCodes, baseRoles, isAdmin: false, source: 'role',
    rows: [...defaults].map(module => ({ module, can_view: true, can_create: true, can_edit: true, can_delete: false, config: {} })),
  };
}

/** Portée effective des données d'un utilisateur pour un module (admin : 'all'). */
export async function effectiveScopeFor(userId: string, module: string): Promise<DataScope> {
  const rights = await effectiveRights(userId);
  return effectiveScope(rights, module);
}
