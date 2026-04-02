import { db } from '../config/database.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
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

  async findAll(): Promise<UserRow[]> {
    const result = await db.query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
  },
};
