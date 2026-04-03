import { db } from '../config/database.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  pin_code: string | null;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
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
    const result = await db.query('SELECT * FROM users WHERE pin_code = $1', [pinCode]);
    return result.rows[0] || null;
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
    role?: string; isActive?: boolean; passwordHash?: string; pinCode?: string | null;
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
};
