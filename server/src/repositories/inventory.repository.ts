import { db } from '../config/database.js';
import { recipeRepository } from './recipe.repository.js';

export const inventoryRepository = {
  async findAll(storeId?: string) {
    const where = storeId ? 'WHERE inv.store_id = $1' : '';
    const lotStoreFilter = storeId ? 'AND il.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.unit_cost, ing.supplier, ing.category,
              -- Lot traceability summary
              (SELECT COUNT(*) FROM ingredient_lots il WHERE il.ingredient_id = inv.ingredient_id AND il.status = 'active' AND il.quantity_remaining > 0 ${lotStoreFilter}) as active_lots_count,
              (SELECT MIN(il.expiration_date) FROM ingredient_lots il WHERE il.ingredient_id = inv.ingredient_id AND il.status = 'active' AND il.quantity_remaining > 0 AND il.expiration_date IS NOT NULL ${lotStoreFilter}) as nearest_dlc,
              (SELECT COUNT(*) FROM ingredient_lots il WHERE il.ingredient_id = inv.ingredient_id AND il.status = 'active' AND il.quantity_remaining > 0 AND il.expiration_date < CURRENT_DATE ${lotStoreFilter}) as expired_lots_count,
              (SELECT COUNT(*) FROM ingredient_lots il WHERE il.ingredient_id = inv.ingredient_id AND il.status = 'active' AND il.quantity_remaining > 0 AND il.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 ${lotStoreFilter}) as expiring_soon_count,
              (SELECT string_agg(DISTINCT il.supplier_lot_number, ', ' ORDER BY il.supplier_lot_number) FROM ingredient_lots il WHERE il.ingredient_id = inv.ingredient_id AND il.status = 'active' AND il.quantity_remaining > 0 AND il.supplier_lot_number IS NOT NULL ${lotStoreFilter}) as active_lot_numbers,
              -- Average daily consumption over last 30 days (negative transactions = consumption)
              (SELECT COALESCE(ABS(SUM(it.quantity_change)) / NULLIF(GREATEST(
                EXTRACT(DAY FROM (NOW() - MIN(it.created_at)))::int, 1
              ), 0), 0)
               FROM inventory_transactions it
               WHERE it.ingredient_id = inv.ingredient_id
                 AND it.quantity_change < 0
                 AND it.created_at >= NOW() - INTERVAL '30 days'
                 ${storeId ? 'AND it.store_id = $1' : ''}
              ) as avg_daily_consumption
       FROM inventory inv JOIN ingredients ing ON ing.id = inv.ingredient_id
       ${where}
       ORDER BY ing.category, ing.name`,
      params
    );
    return result.rows;
  },

  async findAlerts(storeId?: string) {
    const storeFilter = storeId ? ' AND inv.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.category
       FROM inventory inv JOIN ingredients ing ON ing.id = inv.ingredient_id
       WHERE inv.current_quantity <= inv.minimum_threshold${storeFilter}
       ORDER BY (inv.current_quantity / NULLIF(inv.minimum_threshold, 0))`,
      params
    );
    return result.rows;
  },

  async restock(ingredientId: string, quantity: number, performedBy: string, note?: string, storeId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const storeFilter = storeId ? ' AND store_id = $3' : '';
      const updateParams: unknown[] = [quantity, ingredientId];
      if (storeId) updateParams.push(storeId);
      await client.query(
        `UPDATE inventory SET current_quantity = current_quantity + $1, last_restocked_at = NOW(), updated_at = NOW()
         WHERE ingredient_id = $2${storeFilter}`,
        updateParams
      );
      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
         VALUES ($1, 'restock', $2, $3, $4, $5)`,
        [ingredientId, quantity, note || null, performedBy, storeId || null]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getTransactions(ingredientId?: string, limit = 50, storeId?: string) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (ingredientId) { conditions.push(`it.ingredient_id = $${idx++}`); values.push(ingredientId); }
    if (storeId) { conditions.push(`it.store_id = $${idx++}`); values.push(storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit);
    const result = await db.query(
      `SELECT it.*, ing.name as ingredient_name, ing.unit as ingredient_unit,
              u.first_name as performed_by_first, u.last_name as performed_by_last, u.role as performed_by_role,
              COALESCE(u.first_name || ' ' || u.last_name, 'Système') as performed_by_name
       FROM inventory_transactions it
       JOIN ingredients ing ON ing.id = it.ingredient_id
       LEFT JOIN users u ON u.id = it.performed_by
       ${where}
       ORDER BY it.created_at DESC
       LIMIT $${idx}`,
      values
    );
    return result.rows;
  },
};

export const ingredientRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM ingredients ORDER BY name');
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM ingredients WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: { name: string; unit: string; unitCost: number; supplier?: string; allergens?: string[]; category?: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO ingredients (name, unit, unit_cost, supplier, allergens, category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.name, data.unit, data.unitCost, data.supplier || null, data.allergens || [], data.category || 'autre']
      );
      // Create inventory entry
      await client.query(
        `INSERT INTO inventory (ingredient_id) VALUES ($1)`,
        [result.rows[0].id]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', unit: 'unit', unitCost: 'unit_cost', supplier: 'supplier', allergens: 'allergens', category: 'category',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);

    // When unit cost changes, cascade to all recipes using this ingredient
    if (data.unitCost !== undefined) {
      const recipes = await db.query(
        `SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = $1`,
        [id]
      );
      for (const row of recipes.rows) {
        const recipe = await recipeRepository.findById(row.recipe_id);
        if (!recipe) continue;
        let totalCost = 0;
        for (const ing of recipe.ingredients) {
          totalCost += parseFloat(ing.quantity) * parseFloat(ing.unit_cost || '0');
        }
        for (const sr of recipe.sub_recipes) {
          const costPerUnit = parseFloat(sr.sub_total_cost) / (sr.sub_yield_quantity || 1);
          totalCost += costPerUnit * parseFloat(sr.quantity);
        }
        await db.query('UPDATE recipes SET total_cost = $1, updated_at = NOW() WHERE id = $2', [totalCost, row.recipe_id]);
        // Cascade up to parent recipes
        await recipeRepository.recalcParents(row.recipe_id);
      }
    }

    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM ingredients WHERE id = $1', [id]);
  },
};
