import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';

export const productLossRepository = {
  async findAll(filters: { month?: number; year?: number; lossType?: string; productId?: string; storeId?: string }) {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (filters.month && filters.year) {
      conditions.push(`EXTRACT(MONTH FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $${idx++} AND EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $${idx++}`);
      params.push(filters.month, filters.year);
    } else if (filters.year) {
      conditions.push(`EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $${idx++}`);
      params.push(filters.year);
    }

    if (filters.lossType) {
      conditions.push(`pl.loss_type = $${idx++}`);
      params.push(filters.lossType);
    }
    if (filters.productId) {
      conditions.push(`pl.product_id = $${idx++}`);
      params.push(filters.productId);
    }
    if (filters.storeId) {
      conditions.push(`pl.store_id = $${idx++}`);
      params.push(filters.storeId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT pl.*, p.name as product_name, p.image_url as product_image, p.price as product_price,
              c.name as category_name,
              u.first_name as declared_by_first_name, u.last_name as declared_by_last_name
       FROM product_losses pl
       JOIN products p ON p.id = pl.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = pl.declared_by
       ${where}
       ORDER BY pl.created_at DESC`,
      params
    );
    return result.rows;
  },

  async create(data: {
    productId: string;
    quantity: number;
    lossType: string;
    reason: string;
    reasonNote?: string;
    unitCost: number;
    totalCost: number;
    productionPlanId?: string;
    ingredientsConsumed: boolean;
    declaredBy?: string;
    storeId?: string;
  }) {
    const result = await db.query(
      `INSERT INTO product_losses
        (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost,
         production_plan_id, ingredients_consumed, declared_by, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.productId, data.quantity, data.lossType, data.reason,
        data.reasonNote || null, data.unitCost, data.totalCost,
        data.productionPlanId || null, data.ingredientsConsumed,
        data.declaredBy || null, data.storeId || null,
      ]
    );
    return result.rows[0];
  },

  async remove(id: string) {
    await db.query('DELETE FROM product_losses WHERE id = $1', [id]);
  },

  async stats(filters: { month: number; year: number; storeId?: string }) {
    const storeCondition = filters.storeId ? `AND pl.store_id = $3` : '';
    const params: (string | number)[] = [filters.month, filters.year];
    if (filters.storeId) params.push(filters.storeId);

    // Summary by type
    const byType = await db.query(
      `SELECT pl.loss_type,
              COUNT(*) as count,
              SUM(pl.quantity) as total_quantity,
              SUM(pl.total_cost) as total_cost
       FROM product_losses pl
       WHERE EXTRACT(MONTH FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $1 AND EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $2
       ${storeCondition}
       GROUP BY pl.loss_type`,
      params
    );

    // Top products with most losses
    const topProducts = await db.query(
      `SELECT p.id, p.name, p.image_url,
              COUNT(*) as loss_count,
              SUM(pl.quantity) as total_quantity,
              SUM(pl.total_cost) as total_cost
       FROM product_losses pl
       JOIN products p ON p.id = pl.product_id
       WHERE EXTRACT(MONTH FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $1 AND EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $2
       ${storeCondition}
       GROUP BY p.id, p.name, p.image_url
       ORDER BY SUM(pl.total_cost) DESC
       LIMIT 10`,
      params
    );

    // Top reasons
    const topReasons = await db.query(
      `SELECT pl.reason, pl.loss_type,
              COUNT(*) as count,
              SUM(pl.total_cost) as total_cost
       FROM product_losses pl
       WHERE EXTRACT(MONTH FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $1 AND EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $2
       ${storeCondition}
       GROUP BY pl.reason, pl.loss_type
       ORDER BY count DESC`,
      params
    );

    // Daily totals
    const daily = await db.query(
      `SELECT DATE(pl.created_at) as date,
              SUM(pl.total_cost) as total_cost,
              SUM(pl.quantity) as total_quantity,
              COUNT(*) as count
       FROM product_losses pl
       WHERE EXTRACT(MONTH FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $1 AND EXTRACT(YEAR FROM pl.created_at AT TIME ZONE '${getUserTimezone()}') = $2
       ${storeCondition}
       GROUP BY DATE(pl.created_at)
       ORDER BY date`,
      params
    );

    return {
      byType: byType.rows,
      topProducts: topProducts.rows,
      topReasons: topReasons.rows,
      daily: daily.rows,
    };
  },
};
