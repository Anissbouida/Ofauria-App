import { db } from '../config/database.js';

export const productRepository = {
  async findAll(params: { categoryId?: number; search?: string; isAvailable?: boolean; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.categoryId) { conditions.push(`p.category_id = $${i++}`); values.push(params.categoryId); }
    if (params.isAvailable !== undefined) { conditions.push(`p.is_available = $${i++}`); values.push(params.isAvailable); }
    if (params.search) { conditions.push(`p.name ILIKE $${i++}`); values.push(`%${params.search}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM products p ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name, u.role as responsible_role
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.responsible_user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name, u.role as responsible_role
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.responsible_user_id
       WHERE p.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async create(data: {
    name: string; slug: string; categoryId: number; description?: string;
    price: number; costPrice?: number; isAvailable?: boolean;
    isCustomOrderable?: boolean; preparationTimeMin?: number;
    responsibleUserId?: string;
  }) {
    const result = await db.query(
      `INSERT INTO products (name, slug, category_id, description, price, cost_price, is_available, is_custom_orderable, preparation_time_min, responsible_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [data.name, data.slug, data.categoryId, data.description || null, data.price,
       data.costPrice || null, data.isAvailable ?? true, data.isCustomOrderable ?? false,
       data.preparationTimeMin || null, data.responsibleUserId || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', slug: 'slug', categoryId: 'category_id', description: 'description',
      price: 'price', costPrice: 'cost_price', imageUrl: 'image_url',
      isAvailable: 'is_available', isCustomOrderable: 'is_custom_orderable',
      preparationTimeMin: 'preparation_time_min',
      responsibleUserId: 'responsible_user_id',
      stockQuantity: 'stock_quantity',
      stockMinThreshold: 'stock_min_threshold',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(data[key]);
      }
    }

    fields.push(`updated_at = NOW()`);
    if (fields.length === 1) return this.findById(id);
    values.push(id);

    const result = await db.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('UPDATE products SET is_available = false, updated_at = NOW() WHERE id = $1', [id]);
  },
};
