import { db } from '../config/database.js';

export const storeRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM users WHERE store_id = s.id AND is_active = true) as user_count
       FROM stores s ORDER BY s.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM stores WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: { name: string; city?: string; address?: string; phone?: string }) {
    const result = await db.query(
      `INSERT INTO stores (name, city, address, phone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.name, data.city || null, data.address || null, data.phone || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: { name?: string; city?: string; address?: string; phone?: string; isActive?: boolean }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.city !== undefined) { fields.push(`city = $${i++}`); values.push(data.city); }
    if (data.address !== undefined) { fields.push(`address = $${i++}`); values.push(data.address); }
    if (data.phone !== undefined) { fields.push(`phone = $${i++}`); values.push(data.phone); }
    if (data.isActive !== undefined) { fields.push(`is_active = $${i++}`); values.push(data.isActive); }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const result = await db.query(
      `UPDATE stores SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async remove(id: string) {
    await db.query('DELETE FROM stores WHERE id = $1', [id]);
  },
};
