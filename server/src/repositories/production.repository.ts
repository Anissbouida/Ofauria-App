import { db } from '../config/database.js';

export const productionRepository = {
  async findAll(params: { status?: string; type?: string; dateFrom?: string; dateTo?: string; targetRole?: string; storeId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`pp.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status) { conditions.push(`pp.status = $${i++}`); values.push(params.status); }
    if (params.type) { conditions.push(`pp.type = $${i++}`); values.push(params.type); }
    if (params.dateFrom) { conditions.push(`pp.plan_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`pp.plan_date <= $${i++}`); values.push(params.dateTo); }
    if (params.targetRole) { conditions.push(`pp.target_role = $${i++}`); values.push(params.targetRole); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM production_plans pp ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              o.order_number, o.status as order_status,
              oc.first_name || ' ' || oc.last_name as order_customer_name,
              (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count
       FROM production_plans pp
       JOIN users u ON u.id = pp.created_by
       LEFT JOIN orders o ON o.id = pp.order_id
       LEFT JOIN customers oc ON oc.id = o.customer_id
       ${where}
       ORDER BY pp.plan_date DESC, pp.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const planResult = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              o.order_number, o.status as order_status,
              oc.first_name as order_customer_first_name, oc.last_name as order_customer_last_name,
              oc.phone as order_customer_phone,
              o.pickup_date as order_pickup_date, o.total as order_total, o.advance_amount as order_advance_amount
       FROM production_plans pp
       JOIN users u ON u.id = pp.created_by
       LEFT JOIN orders o ON o.id = pp.order_id
       LEFT JOIN customers oc ON oc.id = o.customer_id
       WHERE pp.id = $1`,
      [id]
    );
    if (!planResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT ppi.*, p.name as product_name, p.image_url as product_image,
              c.slug as category_slug, c.name as category_name
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ppi.plan_id = $1
       ORDER BY p.name`,
      [id]
    );

    const needsResult = await db.query(
      `SELECT pin.*, ing.name as ingredient_name, ing.unit,
              p.name as product_name, c.slug as category_slug
       FROM production_ingredient_needs pin
       JOIN ingredients ing ON ing.id = pin.ingredient_id
       LEFT JOIN products p ON p.id = pin.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE pin.plan_id = $1
       ORDER BY ing.name`,
      [id]
    );

    return {
      ...planResult.rows[0],
      items: itemsResult.rows,
      ingredient_needs: needsResult.rows,
    };
  },

  async create(data: {
    planDate: string; type: string; notes?: string; createdBy: string; targetRole?: string; storeId?: string;
    orderId?: string;
    items: { productId: string; plannedQuantity: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const weekNumber = data.type === 'weekly' ? getISOWeek(new Date(data.planDate)) : null;
      const planResult = await client.query(
        `INSERT INTO production_plans (plan_date, type, week_number, notes, created_by, target_role, store_id, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.planDate, data.type, weekNumber, data.notes || null, data.createdBy, data.targetRole || null, data.storeId || null, data.orderId || null]
      );
      const planId = planResult.rows[0].id;

      const productIds: string[] = [];
      for (const item of data.items) {
        await client.query(
          `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
           VALUES ($1, $2, $3, $4)`,
          [planId, item.productId, item.plannedQuantity, item.notes || null]
        );
        productIds.push(item.productId);
      }

      // Mark confirmed orders for this date as in_production
      if (productIds.length > 0) {
        await client.query(
          `UPDATE orders SET status = 'in_production'
           WHERE pickup_date::date = $1::date
             AND status = 'confirmed'
             AND id IN (
               SELECT DISTINCT oi.order_id FROM order_items oi
               WHERE oi.product_id = ANY($2)
             )`,
          [data.planDate, productIds]
        );
      }

      await client.query('COMMIT');
      return planResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateItems(planId: string, items: { productId: string; plannedQuantity: number; notes?: string }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM production_plan_items WHERE plan_id = $1', [planId]);
      for (const item of items) {
        await client.query(
          `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
           VALUES ($1, $2, $3, $4)`,
          [planId, item.productId, item.plannedQuantity, item.notes || null]
        );
      }
      await client.query(`UPDATE production_plans SET updated_at = NOW() WHERE id = $1`, [planId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async confirm(planId: string) {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Get plan items
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1`,
        [planId]
      );

      // Calculate ingredient needs per ingredient per product
      const needsMap = new Map<string, { ingredientId: string; productId: string; quantity: number }>();

      for (const item of itemsResult.rows) {
        const recipeResult = await client.query(
          `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
          [item.product_id]
        );

        if (!recipeResult.rows[0]) {
          warnings.push(`Le produit "${item.product_name}" n'a pas de recette, ignore pour les besoins en ingredients.`);
          continue;
        }

        const recipe = recipeResult.rows[0];
        const recipeIngsResult = await client.query(
          `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`,
          [recipe.id]
        );

        for (const ri of recipeIngsResult.rows) {
          const needed = (parseFloat(ri.quantity) / recipe.yield_quantity) * item.planned_quantity;
          const key = `${ri.ingredient_id}::${item.product_id}`;
          const existing = needsMap.get(key);
          if (existing) {
            existing.quantity += needed;
          } else {
            needsMap.set(key, { ingredientId: ri.ingredient_id, productId: item.product_id, quantity: needed });
          }
        }
      }

      // Delete any previous needs (in case of re-confirmation)
      await client.query('DELETE FROM production_ingredient_needs WHERE plan_id = $1', [planId]);

      // Insert ingredient needs with availability snapshot (per product)
      // First, get availability for all ingredients
      const ingredientIds = [...new Set([...needsMap.values()].map(n => n.ingredientId))];
      const availabilityMap = new Map<string, number>();
      for (const ingId of ingredientIds) {
        const invResult = await client.query(
          `SELECT current_quantity FROM inventory WHERE ingredient_id = $1`,
          [ingId]
        );
        availabilityMap.set(ingId, invResult.rows[0] ? parseFloat(invResult.rows[0].current_quantity) : 0);
      }

      for (const entry of needsMap.values()) {
        const available = availabilityMap.get(entry.ingredientId) || 0;
        await client.query(
          `INSERT INTO production_ingredient_needs (plan_id, ingredient_id, needed_quantity, available_quantity, product_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [planId, entry.ingredientId, entry.quantity, available, entry.productId]
        );
      }

      // Update plan status
      await client.query(
        `UPDATE production_plans SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [planId]
      );

      await client.query('COMMIT');
      return { warnings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async start(planId: string) {
    await db.query(
      `UPDATE production_plans SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [planId]
    );
  },

  async complete(planId: string, actualItems: { planItemId: string; actualQuantity: number }[], userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Update actual quantities
      for (const item of actualItems) {
        await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1 WHERE id = $2 AND plan_id = $3`,
          [item.actualQuantity, item.planItemId, planId]
        );
      }

      // Deduct ingredients based on actual production
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1`,
        [planId]
      );

      for (const item of itemsResult.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        const recipeResult = await client.query(
          `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) continue;

        const recipe = recipeResult.rows[0];
        const recipeIngsResult = await client.query(
          `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`,
          [recipe.id]
        );

        for (const ri of recipeIngsResult.rows) {
          const consumption = (parseFloat(ri.quantity) / recipe.yield_quantity) * item.actual_quantity;

          await client.query(
            `UPDATE inventory SET current_quantity = current_quantity - $1, updated_at = NOW()
             WHERE ingredient_id = $2`,
            [consumption, ri.ingredient_id]
          );

          await client.query(
            `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id)
             VALUES ($1, 'production', $2, $3, $4, $5)`,
            [ri.ingredient_id, -consumption, `Production: ${item.product_name} x${item.actual_quantity}`, userId, planId]
          );
        }
      }

      // Update product stock (finished goods) based on actual production
      for (const item of itemsResult.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        const stockResult = await client.query(
          `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2 RETURNING stock_quantity`,
          [item.actual_quantity, item.product_id]
        );

        const stockAfter = stockResult.rows[0]?.stock_quantity ?? 0;
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by)
           VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
          [item.product_id, item.actual_quantity, stockAfter,
           `Production: ${item.product_name} x${item.actual_quantity}`, planId, userId]
        );
      }

      // Update plan status
      await client.query(
        `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [planId]
      );

      // Mark related pre-orders as 'ready' (orders for this plan date with produced products)
      const planResult = await client.query(`SELECT plan_date FROM production_plans WHERE id = $1`, [planId]);
      if (planResult.rows[0]) {
        const planDate = planResult.rows[0].plan_date;
        const productIds = itemsResult.rows.map((it: Record<string, unknown>) => it.product_id);
        if (productIds.length > 0) {
          await client.query(
            `UPDATE orders SET status = 'ready'
             WHERE pickup_date::date = $1::date
               AND status = 'in_production'
               AND id IN (
                 SELECT DISTINCT oi.order_id FROM order_items oi
                 WHERE oi.product_id = ANY($2)
               )`,
            [planDate, productIds]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async remove(planId: string) {
    await db.query('DELETE FROM production_plans WHERE id = $1', [planId]);
  },
};

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
