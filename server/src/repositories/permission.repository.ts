import { db } from '../config/database.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';

export interface PermissionRow {
  id: number;
  user_id: string;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  config: Record<string, unknown>;
}

export const permissionRepository = {
  async findByUserId(userId: string): Promise<PermissionRow[]> {
    const result = await db.query(
      'SELECT * FROM user_permissions WHERE user_id = $1 ORDER BY module',
      [userId]
    );
    return result.rows;
  },

  /** Supprime toutes les permissions custom d'un utilisateur. Le fallback DEFAULT_ROLE_MODULES
   *  prendra alors effet automatiquement. Utilise quand le role change pour eviter que des
   *  permissions configurees sous l'ancien role ne restent actives. */
  async clearByUserId(userId: string, actorId?: string): Promise<void> {
    await auditedQuery(actorId, 'DELETE FROM user_permissions WHERE user_id = $1', [userId]);
  },

  async setPermissions(userId: string, permissions: {
    module: string;
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    config?: Record<string, unknown>;
  }[], actorId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      // Enregistrement differentiel (et non DELETE + INSERT de tout) : le journal
      // d'audit (mig 328) ne trace ainsi que les modules reellement modifies.
      await client.query(
        'DELETE FROM user_permissions WHERE user_id = $1 AND NOT (module = ANY($2::varchar[]))',
        [userId, permissions.map(p => p.module)]
      );

      for (const perm of permissions) {
        await client.query(
          `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, module) DO UPDATE SET
             can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
             can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete, config = EXCLUDED.config
           WHERE (user_permissions.can_view, user_permissions.can_create, user_permissions.can_edit,
                  user_permissions.can_delete, user_permissions.config)
                 IS DISTINCT FROM
                 (EXCLUDED.can_view, EXCLUDED.can_create, EXCLUDED.can_edit, EXCLUDED.can_delete, EXCLUDED.config)`,
          [userId, perm.module, perm.canView, perm.canCreate, perm.canEdit, perm.canDelete, JSON.stringify(perm.config || {})]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
