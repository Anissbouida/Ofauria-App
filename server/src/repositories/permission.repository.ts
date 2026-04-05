import { db } from '../config/database.js';

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

  async setPermissions(userId: string, permissions: {
    module: string;
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    config?: Record<string, unknown>;
  }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

      for (const perm of permissions) {
        await client.query(
          `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
