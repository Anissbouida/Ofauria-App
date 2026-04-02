import { db } from '../config/database.js';

export const categoryRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM categories ORDER BY display_order');
    return result.rows;
  },

  async findById(id: number) {
    const result = await db.query('SELECT * FROM categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: { name: string; slug: string; description?: string; displayOrder?: number }) {
    const result = await db.query(
      `INSERT INTO categories (name, slug, description, display_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.name, data.slug, data.description || null, data.displayOrder || 0]
    );
    return result.rows[0];
  },

  async update(id: number, data: { name?: string; slug?: string; description?: string; displayOrder?: number }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.slug !== undefined) { fields.push(`slug = $${i++}`); values.push(data.slug); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (data.displayOrder !== undefined) { fields.push(`display_order = $${i++}`); values.push(data.displayOrder); }

    if (fields.length === 0) return this.findById(id);
    values.push(id);

    const result = await db.query(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async delete(id: number) {
    await db.query('DELETE FROM categories WHERE id = $1', [id]);
  },
};
