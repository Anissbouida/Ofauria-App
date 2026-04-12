import { db } from '../config/database.js';

export const productRepository = {
  async findAll(params: { categoryId?: number; search?: string; isAvailable?: boolean; limit: number; offset: number; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.categoryId) { conditions.push(`p.category_id = $${i++}`); values.push(params.categoryId); }
    if (params.isAvailable !== undefined) { conditions.push(`p.is_available = $${i++}`); values.push(params.isAvailable); }
    if (params.search) { conditions.push(`p.name ILIKE $${i++}`); values.push(`%${params.search}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM products p ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const storeStockJoin = params.storeId
      ? `LEFT JOIN product_store_stock pss ON pss.product_id = p.id AND pss.store_id = $${i++}`
      : '';
    if (params.storeId) values.push(params.storeId);

    const stockColumns = params.storeId
      ? `COALESCE(pss.stock_quantity, 0) as stock_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold,`
      : `p.stock_quantity, p.stock_min_threshold,`;

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT p.id, p.name, p.slug, p.category_id, p.description, p.price, p.cost_price,
              p.image_url, p.is_available, p.is_custom_orderable, p.preparation_time_min,
              p.responsible_user_id, p.min_production_quantity,
              p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.is_recyclable,
              p.recycle_ingredient_id, p.max_reexpositions, p.sale_type,
              p.created_at, p.updated_at,
              ${stockColumns}
              c.name as category_name, c.slug as category_slug,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name, u.role as responsible_role
       FROM products p
       ${storeStockJoin}
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
      minProductionQuantity: 'min_production_quantity',
      shelfLifeDays: 'shelf_life_days',
      displayLifeHours: 'display_life_hours',
      isReexposable: 'is_reexposable',
      isRecyclable: 'is_recyclable',
      recycleIngredientId: 'recycle_ingredient_id',
      maxReexpositions: 'max_reexpositions',
      saleType: 'sale_type',
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
    // Clean up all related records before hard delete
    await db.query('DELETE FROM sale_return_items WHERE sale_item_id IN (SELECT id FROM sale_items WHERE product_id = $1)', [id]);
    await db.query('DELETE FROM sale_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM order_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM daily_inventory_check_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM product_display_tracking WHERE product_id = $1', [id]);
    await db.query('DELETE FROM product_losses WHERE product_id = $1', [id]);
    await db.query('DELETE FROM production_ingredient_needs WHERE product_id = $1', [id]);
    await db.query('DELETE FROM production_plan_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM production_transfer_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM replenishment_request_items WHERE product_id = $1', [id]);
    await db.query('DELETE FROM stock_deliveries WHERE product_id = $1', [id]);
    await db.query('UPDATE recipes SET product_id = NULL WHERE product_id = $1', [id]);
    const result = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) throw new Error('Produit introuvable');
  },

  async toggleAvailability(id: string) {
    const result = await db.query(
      'UPDATE products SET is_available = NOT is_available, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  },
};
