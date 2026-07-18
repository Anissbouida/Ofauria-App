import { db } from '../config/database.js';

export const productRepository = {
  async findAll(params: { categoryId?: number; search?: string; isAvailable?: boolean; limit: number; offset: number; storeId?: string; useVitrine?: boolean }) {
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

    // useVitrine: POS mode → stock_quantity = vitrine_quantity (ce qui est sellable).
    // Mode admin (non-POS) : stock_quantity = backroom + vitrine (le total reel detenu
    // par le store). Ainsi un produit avec 0 en backroom mais 10 en vitrine n'apparait
    // plus en "Rupture" dans la liste produits.
    // Les colonnes stock_quantity et vitrine_quantity restent exposees individuellement
    // pour les ecrans qui ont besoin de la decomposition (admin stock, KPIs).
    const stockColumns = params.storeId
      ? (params.useVitrine
          ? `COALESCE(pss.vitrine_quantity, 0) as stock_quantity, COALESCE(pss.stock_quantity, 0) as backroom_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold,`
          : `(COALESCE(pss.stock_quantity, 0) + COALESCE(pss.vitrine_quantity, 0)) as stock_quantity, COALESCE(pss.stock_quantity, 0) as backroom_quantity, COALESCE(pss.vitrine_quantity, 0) as vitrine_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold,`)
      : `p.stock_quantity, p.stock_min_threshold,`;

    // Phase D — pour chaque produit en vitrine, calcule la deadline effective
    // (MIN entre DLV des lots et DDE des lots) + un flag is_expired si plus
    // aucun lot vendable. Sert au POS pour griser les produits non vendables.
    const lotMetricsJoin = params.storeId
      ? `LEFT JOIN LATERAL (
           SELECT
             MIN(LEAST(
               COALESCE(pl.expires_at::timestamptz, 'infinity'::timestamptz),
               COALESCE(pl.display_expires_at, 'infinity'::timestamptz)
             )) as effective_deadline,
             MIN(pl.expires_at) FILTER (WHERE pl.expires_at IS NOT NULL) as nearest_dlv,
             MIN(pl.display_expires_at) FILTER (WHERE pl.display_expires_at IS NOT NULL) as nearest_dde,
             BOOL_OR(
               (pl.expires_at IS NULL OR pl.expires_at > CURRENT_DATE)
               AND (pl.display_expires_at IS NULL OR pl.display_expires_at > NOW())
             ) as has_valid_lot
           FROM product_lots pl
           WHERE pl.product_id = p.id AND pl.store_id = pss.store_id
             AND pl.status = 'active' AND pl.vitrine_qty > 0
         ) lot_metrics ON true`
      : '';
    const lotMetricsCols = params.storeId
      ? `lot_metrics.effective_deadline, lot_metrics.nearest_dlv, lot_metrics.nearest_dde,
         (lot_metrics.has_valid_lot IS NOT NULL AND lot_metrics.has_valid_lot = false) as is_expired,`
      : '';

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT p.id, p.name, p.slug, p.category_id, p.description, p.price, p.cost_price,
              p.image_url, p.is_available, p.is_custom_orderable, p.preparation_time_min,
              p.responsible_user_id, p.min_production_quantity,
              p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.is_recyclable,
              p.recycle_ingredient_id, p.max_reexpositions, p.sale_type,
              p.sale_unit, p.price_per_kg,
              p.created_at, p.updated_at,
              ${stockColumns}
              ${lotMetricsCols}
              c.name as category_name, c.slug as category_slug,
              u.first_name as responsible_first_name, u.last_name as responsible_last_name, u.role as responsible_role
       FROM products p
       ${storeStockJoin}
       ${lotMetricsJoin}
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.responsible_user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findTopSelling(params: { storeId?: string; limit: number; days: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    // Only count sales from the last N days
    conditions.push(`s.created_at >= NOW() - INTERVAL '1 day' * $${i++}`);
    values.push(params.days);

    if (params.storeId) {
      conditions.push(`s.store_id = $${i++}`);
      values.push(params.storeId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const storeStockJoin = params.storeId
      ? `LEFT JOIN product_store_stock pss ON pss.product_id = p.id AND pss.store_id = $${i++}`
      : '';
    if (params.storeId) values.push(params.storeId);

    const stockColumns = params.storeId
      ? `COALESCE(pss.vitrine_quantity, 0) as stock_quantity, COALESCE(pss.stock_quantity, 0) as backroom_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold,`
      : `p.stock_quantity, p.stock_min_threshold,`;

    // Meme LATERAL que findByCategory pour aligner la DLV/DDE affichee au POS
    // (indispensable pour ne pas vendre un produit expire depuis Top Ventes).
    const lotMetricsJoin = params.storeId
      ? `LEFT JOIN LATERAL (
           SELECT
             MIN(pl.expires_at) FILTER (WHERE pl.expires_at IS NOT NULL) as nearest_dlv,
             MIN(pl.display_expires_at) FILTER (WHERE pl.display_expires_at IS NOT NULL) as nearest_dde,
             BOOL_OR(
               (pl.expires_at IS NULL OR pl.expires_at > CURRENT_DATE)
               AND (pl.display_expires_at IS NULL OR pl.display_expires_at > NOW())
             ) as has_valid_lot
           FROM product_lots pl
           WHERE pl.product_id = p.id AND pl.store_id = pss.store_id
             AND pl.status = 'active' AND pl.vitrine_qty > 0
         ) lot_metrics ON true`
      : '';
    const lotMetricsCols = params.storeId
      ? `lot_metrics.nearest_dlv, lot_metrics.nearest_dde,
         (lot_metrics.has_valid_lot IS NOT NULL AND lot_metrics.has_valid_lot = false) as is_expired,`
      : '';

    values.push(params.limit);
    // AUDIT V1 : ajout de sale_unit + price_per_kg (sinon les produits au poids
    // etaient traites comme unitaires cote client -> facturés a ~0 DH), plus les
    // champs vitrine/DLV/reexposition/recyclage pour aligner sur findByCategory.
    const result = await db.query(
      `SELECT p.id, p.name, p.slug, p.category_id, p.description, p.price, p.cost_price,
              p.image_url, p.is_available, p.is_custom_orderable, p.preparation_time_min,
              p.responsible_user_id, p.min_production_quantity,
              p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.is_recyclable,
              p.recycle_ingredient_id, p.max_reexpositions, p.sale_type,
              p.sale_unit, p.price_per_kg,
              ${stockColumns}
              ${lotMetricsCols}
              c.name as category_name,
              SUM(si.quantity) as total_sold
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       ${storeStockJoin}
       ${lotMetricsJoin}
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       AND p.is_available = true
       GROUP BY p.id, p.name, p.slug, p.category_id, p.description, p.price, p.cost_price,
                p.image_url, p.is_available, p.is_custom_orderable, p.preparation_time_min,
                p.responsible_user_id, p.min_production_quantity,
                p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.is_recyclable,
                p.recycle_ingredient_id, p.max_reexpositions, p.sale_type,
                p.sale_unit, p.price_per_kg,
                p.stock_quantity, p.stock_min_threshold,
                ${params.storeId ? 'pss.vitrine_quantity, pss.stock_quantity, pss.stock_min_threshold, lot_metrics.nearest_dlv, lot_metrics.nearest_dde, lot_metrics.has_valid_lot,' : ''}
                c.name
       ORDER BY total_sold DESC
       LIMIT $${i}`,
      values
    );

    return result.rows;
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
    saleUnit?: 'unit' | 'weight'; pricePerKg?: number;
  }) {
    const result = await db.query(
      `INSERT INTO products (name, slug, category_id, description, price, cost_price, is_available, is_custom_orderable, preparation_time_min, responsible_user_id, sale_unit, price_per_kg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [data.name, data.slug, data.categoryId, data.description || null, data.price,
       data.costPrice || null, data.isAvailable ?? true, data.isCustomOrderable ?? false,
       data.preparationTimeMin || null, data.responsibleUserId || null,
       data.saleUnit || 'unit', data.pricePerKg ?? null]
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
      saleUnit: 'sale_unit',
      pricePerKg: 'price_per_kg',
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
    // sale_return_items porte aussi une FK directe product_id (lignes sans sale_item_id)
    await db.query('DELETE FROM sale_return_items WHERE product_id = $1', [id]);
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
    await db.query('DELETE FROM unsold_decisions WHERE product_id = $1', [id]);
    await db.query('DELETE FROM product_pipeline WHERE product_id = $1', [id]);
    await db.query('DELETE FROM stock_semifini_frigo WHERE product_id = $1', [id]);
    // Les lignes de facture sont des pieces comptables : on delie sans supprimer
    // (product_id nullable), la facture reste intacte.
    await db.query('UPDATE invoice_items SET product_id = NULL WHERE product_id = $1', [id]);
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
