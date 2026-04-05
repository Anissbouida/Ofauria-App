import { db } from '../config/database.js';

export const customerRepository = {
  async findAll(params: { search?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.search) {
      conditions.push(`(first_name ILIKE $${i} OR last_name ILIKE $${i} OR email ILIKE $${i})`);
      values.push(`%${params.search}%`);
      i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM customers ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByPhone(phone: string) {
    const result = await db.query('SELECT * FROM customers WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  },

  async create(data: { firstName: string; lastName: string; email?: string; phone?: string; notes?: string }) {
    const result = await db.query(
      `INSERT INTO customers (first_name, last_name, email, phone, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.firstName, data.lastName, data.email || null, data.phone || null, data.notes || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', notes: 'notes',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);

    const result = await db.query(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM customers WHERE id = $1', [id]);
  },
};
