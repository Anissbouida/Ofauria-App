import { PERMISSIONS, type PermissionKey } from '@ofauria/shared';
import { db, withTransaction } from '../config/database.js';
import { userRoleContext } from './access-rights.js';

/**
 * Permissions par action (M2-04, mig 547).
 *
 * Décision : l'utilisateur détient la clé si une exception utilisateur l'accorde, ou,
 * sans exception, si l'un de ses rôles (rôles propres et délégations en cours) la détient.
 *
 * Amorçage : une clé du référentiel encore absente de permission_seeded_keys est donnée
 * à chaque rôle dont le rôle de base figure dans ses defaultRoles (= les rôles que la
 * garde authorize(...) d'origine acceptait), puis marquée amorcée et plus jamais réécrite.
 *
 * Caches courts (30 s) ; invalidés par l'écran des rôles.
 */
const TTL_MS = 30_000;
const DEFS = PERMISSIONS as Record<string, { module: string; label: string; defaultRoles: readonly string[] }>;

let roleCache: { at: number; byRole: Map<string, Set<string>> } | null = null;
const userCache = new Map<string, { at: number; roles: string[]; overrides: Map<string, boolean> }>();
let tablesReady: boolean | null = null;

async function tablesExist(): Promise<boolean> {
  if (tablesReady !== null) return tablesReady;
  tablesReady = !!(await db.query(`SELECT to_regclass('public.role_action_permissions') AS t`)).rows[0]?.t;
  return tablesReady;
}

/** Amorce les clés du référentiel pas encore amorcées. Rend le nombre de clés amorcées. */
export async function seedPermissions(): Promise<number> {
  if (!(await tablesExist())) return 0;
  const seeded = new Set((await db.query(`SELECT permission_key FROM permission_seeded_keys`)).rows.map(r => r.permission_key as string));
  const todo = Object.keys(DEFS).filter(k => !seeded.has(k));
  if (!todo.length) return 0;
  await withTransaction(async () => {
    await db.query(
      `INSERT INTO role_action_permissions (role_code, permission_key)
       SELECT r.code, k.key
         FROM jsonb_to_recordset($1::jsonb) AS k(key text, roles text[])
         JOIN roles r ON r.base_role = ANY(k.roles)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(todo.map(key => ({ key, roles: DEFS[key].defaultRoles })))]);
    await db.query(
      `INSERT INTO permission_seeded_keys (permission_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [todo]);
  });
  roleCache = null;
  return todo.length;
}

async function rolePermissions(): Promise<Map<string, Set<string>>> {
  if (roleCache && Date.now() - roleCache.at < TTL_MS) return roleCache.byRole;
  await seedPermissions();
  const byRole = new Map<string, Set<string>>();
  for (const r of (await db.query(`SELECT role_code, permission_key FROM role_action_permissions`)).rows) {
    if (!byRole.has(r.role_code)) byRole.set(r.role_code, new Set());
    byRole.get(r.role_code)!.add(r.permission_key);
  }
  roleCache = { at: Date.now(), byRole };
  return byRole;
}

async function userContext(userId: string) {
  const c = userCache.get(userId);
  if (c && Date.now() - c.at < TTL_MS) return c;
  const { roleCodes } = await userRoleContext(userId);
  const overrides = new Map<string, boolean>(
    (await db.query(`SELECT permission_key, granted FROM user_action_permissions WHERE user_id = $1`, [userId])).rows
      .map(r => [r.permission_key as string, r.granted as boolean]));
  const out = { at: Date.now(), roles: roleCodes, overrides };
  userCache.set(userId, out);
  return out;
}

/**
 * Vrai si l'utilisateur détient la clé. `baseRoles` (jeton) ne sert que de repli si la
 * migration 547 n'est pas appliquée : décision d'origine (defaultRoles).
 */
export async function hasPermission(user: { userId: string; baseRoles?: string[]; role?: string }, key: string): Promise<boolean> {
  if (!(await tablesExist())) {
    const have = user.baseRoles?.length ? user.baseRoles : user.role ? [user.role] : [];
    return have.some(r => DEFS[key]?.defaultRoles.includes(r));
  }
  const ctx = await userContext(user.userId);
  const o = ctx.overrides.get(key);
  if (o !== undefined) return o;
  const byRole = await rolePermissions();
  return ctx.roles.some(r => byRole.get(r)?.has(key));
}

/** Clés détenues par l'utilisateur (aperçu « ce que voit cet utilisateur »). */
export async function permissionsOfUser(userId: string): Promise<string[]> {
  const ctx = await userContext(userId);
  const byRole = await rolePermissions();
  return Object.keys(DEFS).filter(k => {
    const o = ctx.overrides.get(k);
    return o !== undefined ? o : ctx.roles.some(r => byRole.get(r)?.has(k));
  });
}

/** Clés d'un rôle. */
export async function permissionsOfRole(roleCode: string): Promise<string[]> {
  return [...((await rolePermissions()).get(roleCode) ?? [])].sort();
}

/** Remplace les clés d'un rôle (écran des rôles). Les clés inconnues du référentiel sont refusées. */
export async function setRolePermissions(roleCode: string, keys: string[], userId: string): Promise<{ added: number; removed: number }> {
  const unknown = keys.filter(k => !DEFS[k]);
  if (unknown.length) throw new Error(`Permission(s) inconnue(s) : ${unknown.slice(0, 5).join(', ')}`);
  await seedPermissions();
  const out = await withTransaction(async () => {
    const role = (await db.query(`SELECT code FROM roles WHERE code = $1`, [roleCode])).rows[0];
    if (!role) throw new Error('Rôle introuvable');
    const removed = (await db.query(
      `DELETE FROM role_action_permissions WHERE role_code = $1 AND NOT (permission_key = ANY($2::text[]))`, [roleCode, keys])).rowCount ?? 0;
    const added = (await db.query(
      `INSERT INTO role_action_permissions (role_code, permission_key, granted_by)
       SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`, [roleCode, keys, userId])).rowCount ?? 0;
    return { added, removed };
  });
  invalidatePermissionCaches();
  return out;
}

/** Copie les clés d'un rôle vers un autre (duplication d'un rôle). */
export async function copyRolePermissions(fromRole: string, toRole: string, userId: string): Promise<number> {
  await seedPermissions();
  const r = await db.query(
    `INSERT INTO role_action_permissions (role_code, permission_key, granted_by)
     SELECT $2, permission_key, $3 FROM role_action_permissions WHERE role_code = $1
     ON CONFLICT DO NOTHING`, [fromRole, toRole, userId]);
  invalidatePermissionCaches();
  return r.rowCount ?? 0;
}

/** Les clés du rôle deviennent celles d'un autre rôle (changement de rôle de base). */
export async function replaceRolePermissionsFrom(roleCode: string, fromRole: string, userId: string | null): Promise<void> {
  await seedPermissions();
  await withTransaction(async () => {
    await db.query(`DELETE FROM role_action_permissions WHERE role_code = $1`, [roleCode]);
    await db.query(
      `INSERT INTO role_action_permissions (role_code, permission_key, granted_by)
       SELECT $1, permission_key, $3 FROM role_action_permissions WHERE role_code = $2 ON CONFLICT DO NOTHING`,
      [roleCode, fromRole, userId]);
  });
  invalidatePermissionCaches();
}

export function invalidatePermissionCaches() {
  roleCache = null;
  userCache.clear();
}

export type { PermissionKey };
