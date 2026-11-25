import { db } from '../config/database.js';
import { auditedQuery } from '../utils/audit-context.js';

/**
 * Exceptions individuelles d'un compte (refonte Utilisateurs, lot 6, mig 706) :
 *  - sur un module (user_permissions) : remplace les droits des rôles pour ce module ;
 *  - sur une action précise (user_action_permissions) : accordée ou retirée.
 * Toutes portent un motif et une date de fin facultative (incluse). `active` = encore en cours.
 */

export interface ModuleExceptionRow {
  module: string;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean;
  config: Record<string, unknown>;
  reason: string | null;
  ends_on: string | null;
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

export interface ActionExceptionRow {
  permission_key: string;
  granted: boolean;
  reason: string | null;
  ends_on: string | null;
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

export interface ModuleExceptionInput {
  module: string;
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  config: Record<string, unknown>;
  reason: string;
  endsOn: string | null;
}

export const userExceptionRepository = {
  async list(userId: string): Promise<{ modules: ModuleExceptionRow[]; actions: ActionExceptionRow[] }> {
    const [modules, actions] = await Promise.all([
      db.query(
        `SELECT p.module, p.can_view, p.can_create, p.can_edit, p.can_delete, p.config, p.reason,
                p.ends_on::text AS ends_on, (p.ends_on IS NULL OR p.ends_on >= current_date) AS active,
                p.updated_at, NULLIF(concat_ws(' ', a.first_name, a.last_name), '') AS updated_by_name
           FROM user_permissions p LEFT JOIN users a ON a.id = p.updated_by
          WHERE p.user_id = $1
          ORDER BY active DESC, p.module`, [userId]),
      db.query(
        `SELECT o.permission_key, o.granted, o.reason,
                o.ends_on::text AS ends_on, (o.ends_on IS NULL OR o.ends_on >= current_date) AS active,
                o.updated_at, NULLIF(concat_ws(' ', a.first_name, a.last_name), '') AS updated_by_name
           FROM user_action_permissions o LEFT JOIN users a ON a.id = o.updated_by
          WHERE o.user_id = $1
          ORDER BY active DESC, o.permission_key`, [userId]),
    ]);
    return { modules: modules.rows, actions: actions.rows };
  },

  async setModule(userId: string, e: ModuleExceptionInput, actorId: string | undefined): Promise<void> {
    await auditedQuery(actorId,
      `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config, reason, ends_on, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (user_id, module) DO UPDATE SET
         can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete, config = EXCLUDED.config, reason = EXCLUDED.reason,
         ends_on = EXCLUDED.ends_on, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [userId, e.module, e.canView, e.canCreate, e.canEdit, e.canDelete, JSON.stringify(e.config), e.reason, e.endsOn, actorId ?? null]);
  },

  async removeModule(userId: string, module: string, actorId: string | undefined): Promise<boolean> {
    const r = await auditedQuery(actorId, `DELETE FROM user_permissions WHERE user_id = $1 AND module = $2`, [userId, module]);
    return (r.rowCount ?? 0) > 0;
  },

  async setAction(userId: string, key: string, granted: boolean, reason: string, endsOn: string | null, actorId: string | undefined): Promise<void> {
    await auditedQuery(actorId,
      `INSERT INTO user_action_permissions (user_id, permission_key, granted, reason, ends_on, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, permission_key) DO UPDATE SET
         granted = EXCLUDED.granted, reason = EXCLUDED.reason, ends_on = EXCLUDED.ends_on,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [userId, key, granted, reason, endsOn, actorId ?? null]);
  },

  async removeAction(userId: string, key: string, actorId: string | undefined): Promise<boolean> {
    const r = await auditedQuery(actorId, `DELETE FROM user_action_permissions WHERE user_id = $1 AND permission_key = $2`, [userId, key]);
    return (r.rowCount ?? 0) > 0;
  },

  /** Nombre d'exceptions en cours par compte (revue des accès). */
  async activeCounts(): Promise<Map<string, number>> {
    const r = await db.query(
      `SELECT user_id, count(*)::int AS n FROM (
         SELECT user_id FROM user_permissions WHERE ends_on IS NULL OR ends_on >= current_date
         UNION ALL
         SELECT user_id FROM user_action_permissions WHERE ends_on IS NULL OR ends_on >= current_date
       ) x GROUP BY user_id`);
    return new Map(r.rows.map(x => [x.user_id as string, x.n as number]));
  },
};
