import { db } from '../config/database.js';
import { comparePin } from '../utils/hash.js';
import { auditedQuery, setAuditUser } from '../utils/audit-context.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  pin_code: string | null;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  store_id: string | null;
  token_version: number;
  created_at: Date;
  updated_at: Date;
}

export const userRepository = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async findById(id: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: string;
    storeId?: string | null;
  }, actorId?: string): Promise<UserRow> {
    const result = await auditedQuery(actorId,
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.email, data.passwordHash, data.firstName, data.lastName, data.role, data.storeId || null]
    );
    return result.rows[0];
  },

  async findByPinCode(pinCode: string): Promise<UserRow | null> {
    // PINs are hashed — load all active users with a PIN and compare via bcrypt
    const result = await db.query(
      'SELECT * FROM users WHERE pin_code IS NOT NULL AND is_active = true'
    );
    for (const user of result.rows) {
      const match = await comparePin(pinCode, user.pin_code);
      if (match) return user;
    }
    return null;
  },

  async findAllActive(): Promise<Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'role'>[]> {
    const result = await db.query(
      `SELECT id, first_name, last_name, role FROM users WHERE is_active = true ORDER BY first_name`
    );
    return result.rows;
  },

  async findAll(): Promise<UserRow[]> {
    const result = await db.query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
  },

  async update(id: string, data: {
    email?: string; firstName?: string; lastName?: string;
    role?: string; isActive?: boolean; passwordHash?: string; pinCode?: string | null; storeId?: string | null;
  }, actorId?: string): Promise<UserRow> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.email !== undefined) { fields.push(`email = $${i++}`); values.push(data.email); }
    if (data.firstName !== undefined) { fields.push(`first_name = $${i++}`); values.push(data.firstName); }
    if (data.lastName !== undefined) { fields.push(`last_name = $${i++}`); values.push(data.lastName); }
    if (data.role !== undefined) { fields.push(`role = $${i++}`); values.push(data.role); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); values.push(data.isActive); }
    if (data.passwordHash !== undefined) { fields.push(`password_hash = $${i++}`); values.push(data.passwordHash); }
    if (data.pinCode !== undefined) { fields.push(`pin_code = $${i++}`); values.push(data.pinCode); }
    if (data.storeId !== undefined) { fields.push(`store_id = $${i++}`); values.push(data.storeId); }
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await auditedQuery(actorId,
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    return result.rows[0];
  },

  async delete(id: string, actorId?: string): Promise<void> {
    await auditedQuery(actorId, 'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
  },

  // ─── Account lockout (OWASP A04-2) ────────────────────────
  // Increments failed counter. Si seuil atteint, verrouille pour `lockDurationMs`.
  async recordFailedLogin(id: string, threshold: number, lockDurationMs: number): Promise<{ count: number; lockedUntil: Date | null }> {
    const result = await db.query(
      `UPDATE users
       SET failed_login_count = failed_login_count + 1,
           last_failed_login_at = NOW(),
           locked_until = CASE
             WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3 || ' milliseconds')::interval
             ELSE locked_until
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING failed_login_count, locked_until`,
      [id, threshold, lockDurationMs]
    );
    const row = result.rows[0];
    return { count: row?.failed_login_count ?? 0, lockedUntil: row?.locked_until ?? null };
  },

  async resetFailedLogins(id: string): Promise<void> {
    await db.query(
      `UPDATE users
       SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  },

  async isLocked(id: string): Promise<Date | null> {
    const result = await db.query(
      'SELECT locked_until FROM users WHERE id = $1 AND locked_until > NOW()',
      [id]
    );
    return result.rows[0]?.locked_until ?? null;
  },

  // OWASP A07-5 : invalidation de tous les tokens existants d'un user.
  // Incrementer la version force les tokens JWT existants a etre rejetes
  // par le middleware (comparaison version token vs version DB).
  async bumpTokenVersion(id: string): Promise<number> {
    const result = await db.query(
      'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1 RETURNING token_version',
      [id]
    );
    return result.rows[0]?.token_version ?? 0;
  },

  async getTokenVersion(id: string): Promise<number | null> {
    const result = await db.query('SELECT token_version FROM users WHERE id = $1', [id]);
    return result.rows[0]?.token_version ?? null;
  },

  // ─── Rôles multiples (mig 335) ────────────────────────────
  async userRolesTableExists(): Promise<boolean> {
    const r = await db.query(`SELECT to_regclass('public.user_roles') IS NOT NULL AS ok`);
    return !!r.rows[0]?.ok;
  },

  /** Codes de rôle d'un utilisateur (principal d'abord). Repli sur users.role. */
  async getRoleCodes(id: string): Promise<string[]> {
    if (!(await this.userRolesTableExists())) {
      const u = await db.query('SELECT role FROM users WHERE id = $1', [id]);
      return u.rows[0]?.role ? [u.rows[0].role] : [];
    }
    const r = await db.query(
      'SELECT role_code FROM user_roles WHERE user_id = $1 ORDER BY is_primary DESC, role_code', [id]);
    return r.rows.map((x: { role_code: string }) => x.role_code);
  },

  /** Rôles de tous les utilisateurs (pour enrichir la liste des comptes). */
  async allUserRoles(): Promise<{ user_id: string; role_code: string; is_primary: boolean }[]> {
    if (!(await this.userRolesTableExists())) return [];
    const r = await db.query('SELECT user_id, role_code, is_primary FROM user_roles');
    return r.rows;
  },

  /**
   * Remplace les rôles d'un utilisateur. `primary` devient users.role (rôle
   * principal du jeton) et le rôle marqué is_primary. Synchronisation
   * différentielle pour ne pas gonfler le journal d'audit (mig 328).
   */
  async setRoleCodes(id: string, codes: string[], primary: string, actorId?: string): Promise<void> {
    const hasTable = await this.userRolesTableExists();
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, actorId);
      await client.query('UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1', [id, primary]);
      if (hasTable) {
        await client.query(
          'DELETE FROM user_roles WHERE user_id = $1 AND NOT (role_code = ANY($2::varchar[]))',
          [id, codes]);
        // Rétrograder l'ancien principal AVANT de promouvoir le nouveau : l'index
        // unique partiel (un seul is_primary par utilisateur) interdit un doublon transitoire.
        await client.query(
          'UPDATE user_roles SET is_primary = false WHERE user_id = $1 AND is_primary AND role_code <> $2',
          [id, primary]);
        for (const code of codes) {
          await client.query(
            `INSERT INTO user_roles (user_id, role_code, is_primary, assigned_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, role_code) DO UPDATE SET is_primary = EXCLUDED.is_primary
             WHERE user_roles.is_primary IS DISTINCT FROM EXCLUDED.is_primary`,
            [id, code, code === primary, actorId ?? null]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
