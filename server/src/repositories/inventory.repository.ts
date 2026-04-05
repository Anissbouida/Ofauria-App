import { db } from '../config/database.js';

export const inventoryRepository = {
  async findAll(storeId?: string) {
    const where = storeId ? 'WHERE inv.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.unit_cost, ing.supplier, ing.category
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
      `SELECT it.*, ing.name as ingredient_name, u.first_name as performed_by_name
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
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM ingredients WHERE id = $1', [id]);
  },
};
