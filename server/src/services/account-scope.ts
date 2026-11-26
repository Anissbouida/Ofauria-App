import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { effectiveRights } from './access-rights.js';
import { permissionsOfUser } from './permissions.js';

/**
 * Administration déléguée (refonte Utilisateurs, lot 10). Les droits « Utilisateurs » se donnent
 * par rôle ; une personne qui n'est pas administrateur :
 *  - ne voit et ne gère que les comptes rattachés à l'un de ses établissements ;
 *  - ne modifie ni un administrateur ni un autre gestionnaire de comptes, ni son propre compte ;
 *  - n'attribue ni le rôle Administrateur ni un rôle qui donne la gestion des comptes, et seulement
 *    ses propres établissements.
 */
export const ACCOUNT_ADMIN_KEYS = ['users.create', 'users.edit', 'users.delete', 'users.permissions', 'users.roles'];

export class ScopeError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

export async function isAdminUser(userId: string): Promise<boolean> {
  return (await effectiveRights(userId)).isAdmin;
}

/** Gestionnaire de comptes : administrateur, ou détient une clé de gestion des comptes. */
export async function managesAccounts(userId: string): Promise<boolean> {
  if (await isAdminUser(userId)) return true;
  const keys = await permissionsOfUser(userId);
  return ACCOUNT_ADMIN_KEYS.some(k => keys.includes(k));
}

/** Rôle réservé à l'administrateur : base Administrateur, ou donne la gestion des comptes. */
export async function roleGrantsAccountAdmin(code: string): Promise<boolean> {
  const r = await db.query(
    `SELECT (r.base_role = 'admin') OR EXISTS (
              SELECT 1 FROM role_action_permissions p WHERE p.role_code = r.code AND p.permission_key = ANY($2::text[])) AS reserved
       FROM roles r WHERE r.code = $1`, [code, ACCOUNT_ADMIN_KEYS]);
  return r.rows[0]?.reserved ?? code === 'admin';
}

export async function storesOfUser(userId: string): Promise<string[]> {
  return (await db.query(`SELECT store_id::text FROM user_stores WHERE user_id = $1`, [userId])).rows.map(r => r.store_id as string);
}

/** Comptes dans le périmètre d'une personne : ceux qui partagent l'un de ses établissements. */
export async function accountsInScope(actorId: string): Promise<Set<string>> {
  const r = await db.query(
    `SELECT DISTINCT t.user_id FROM user_stores t
      WHERE t.store_id IN (SELECT store_id FROM user_stores WHERE user_id = $1)`, [actorId]);
  return new Set(r.rows.map(x => x.user_id as string));
}

/** Contrôle d'accès à un compte. `write` : en plus, ni administrateur, ni gestionnaire, ni soi-même. */
export async function assertCanManage(actorId: string, targetId: string, write: boolean): Promise<void> {
  if (await isAdminUser(actorId)) return;
  if (targetId === actorId) {
    if (write) throw new ScopeError('Votre propre compte se règle par un administrateur (ou depuis Mon espace).');
    return;
  }
  if (!(await accountsInScope(actorId)).has(targetId)) throw new ScopeError('Ce compte n\'est pas rattaché à l\'un de vos établissements.');
  if (write && (await managesAccounts(targetId))) throw new ScopeError('Ce compte est géré par un administrateur.');
}

/** Rôles et établissements qu'une personne qui n'est pas administrateur peut attribuer. */
export async function assertAssignable(actorId: string, roles: string[] | undefined, storeIds: string[] | undefined): Promise<void> {
  if (await isAdminUser(actorId)) return;
  for (const c of roles ?? []) {
    if (await roleGrantsAccountAdmin(c)) throw new ScopeError(`Le rôle « ${c} » est attribué par un administrateur.`);
  }
  if (storeIds !== undefined) {
    const mine = new Set(await storesOfUser(actorId));
    if (!storeIds.length) throw new ScopeError('Choisissez au moins un de vos établissements.');
    if (storeIds.some(s => !mine.has(s))) throw new ScopeError('Vous ne pouvez rattacher un compte qu\'à vos établissements.');
  }
}

/** Garde de route sur /users/:id (lot 10). */
export function accountScope(mode: 'read' | 'write') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await assertCanManage(req.user!.userId, String(req.params.id), mode === 'write');
      next();
    } catch (e) {
      if (e instanceof ScopeError) { res.status(e.status).json({ success: false, error: { message: e.message } }); return; }
      next(e);
    }
  };
}
