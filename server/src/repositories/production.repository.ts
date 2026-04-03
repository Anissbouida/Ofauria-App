import { db } from '../config/database.js';

export const productionRepository = {
  async findAll(params: { status?: string; type?: string; dateFrom?: string; dateTo?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.status) { conditions.push(`pp.status = $${i++}`); values.push(params.status); }
    if (params.type) { conditions.push(`pp.type = $${i++}`); values.push(params.type); }
    if (params.dateFrom) { conditions.push(`pp.plan_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`pp.plan_date <= $${i++}`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM production_plans pp ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count
       FROM production_plans pp
       JOIN users u ON u.id = pp.created_by
       ${where}
       ORDER BY pp.plan_date DESC, pp.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const planResult = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM production_plans pp JOIN users u ON u.id = pp.created_by
       WHERE pp.id = $1`,
      [id]
    );
    if (!planResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT ppi.*, p.name as product_name, p.image_url as product_image
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       WHERE ppi.plan_id = $1
       ORDER BY p.name`,
      [id]
    );

    const needsResult = await db.query(
      `SELECT pin.*, ing.name as ingredient_name, ing.unit
       FROM production_ingredient_needs pin
       JOIN ingredients ing ON ing.id = pin.ingredient_id
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
    planDate: string; type: string; notes?: string; createdBy: string;
    items: { productId: string; plannedQuantity: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const weekNumber = data.type === 'weekly' ? getISOWeek(new Date(data.planDate)) : null;
      const planResult = await client.query(
        `INSERT INTO production_plans (plan_date, type, week_number, notes, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.planDate, data.type, weekNumber, data.notes || null, data.createdBy]
      );
      const planId = planResult.rows[0].id;

      for (const item of data.items) {
        await client.query(
          `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
           VALUES ($1, $2, $3, $4)`,
          [planId, item.productId, item.plannedQuantity, item.notes || null]
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

      // Calculate ingredient needs per ingredient
      const needsMap = new Map<string, number>();

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
          const current = needsMap.get(ri.ingredient_id) || 0;
          needsMap.set(ri.ingredient_id, current + needed);
        }
      }

      // Delete any previous needs (in case of re-confirmation)
      await client.query('DELETE FROM production_ingredient_needs WHERE plan_id = $1', [planId]);

      // Insert ingredient needs with availability snapshot
      for (const [ingredientId, neededQuantity] of needsMap) {
        const invResult = await client.query(
          `SELECT current_quantity FROM inventory WHERE ingredient_id = $1`,
          [ingredientId]
        );
        const available = invResult.rows[0] ? parseFloat(invResult.rows[0].current_quantity) : 0;

        await client.query(
          `INSERT INTO production_ingredient_needs (plan_id, ingredient_id, needed_quantity, available_quantity)
           VALUES ($1, $2, $3, $4)`,
          [planId, ingredientId, neededQuantity, available]
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

      // Update plan status
      await client.query(
        `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [planId]
      );

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
