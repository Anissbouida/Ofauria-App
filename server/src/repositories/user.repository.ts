import { db } from '../config/database.js';
import { comparePin } from '../utils/hash.js';

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
  }): Promise<UserRow> {
    const result = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.email, data.passwordHash, data.firstName, data.lastName, data.role]
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
  }): Promise<UserRow> {
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
    const result = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    return result.rows[0];
  },

  async delete(id: string): Promise<void> {
    await db.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
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
};
