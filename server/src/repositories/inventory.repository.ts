import { db } from '../config/database.js';

export const inventoryRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.unit_cost, ing.supplier
       FROM inventory inv JOIN ingredients ing ON ing.id = inv.ingredient_id
       ORDER BY ing.name`
    );
    return result.rows;
  },

  async findAlerts() {
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit
       FROM inventory inv JOIN ingredients ing ON ing.id = inv.ingredient_id
       WHERE inv.current_quantity <= inv.minimum_threshold
       ORDER BY (inv.current_quantity / NULLIF(inv.minimum_threshold, 0))`
    );
    return result.rows;
  },

  async restock(ingredientId: string, quantity: number, performedBy: string, note?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE inventory SET current_quantity = current_quantity + $1, last_restocked_at = NOW(), updated_at = NOW()
         WHERE ingredient_id = $2`,
        [quantity, ingredientId]
      );
      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by)
         VALUES ($1, 'restock', $2, $3, $4)`,
        [ingredientId, quantity, note || null, performedBy]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getTransactions(ingredientId?: string, limit = 50) {
    const where = ingredientId ? 'WHERE it.ingredient_id = $1' : '';
    const params = ingredientId ? [ingredientId, limit] : [limit];
    const result = await db.query(
      `SELECT it.*, ing.name as ingredient_name, u.first_name as performed_by_name
       FROM inventory_transactions it
       JOIN ingredients ing ON ing.id = it.ingredient_id
       LEFT JOIN users u ON u.id = it.performed_by
       ${where}
       ORDER BY it.created_at DESC
       LIMIT $${ingredientId ? 2 : 1}`,
      params
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

  async create(data: { name: string; unit: string; unitCost: number; supplier?: string; allergens?: string[] }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO ingredients (name, unit, unit_cost, supplier, allergens) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.name, data.unit, data.unitCost, data.supplier || null, data.allergens || []]
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
      name: 'name', unit: 'unit', unitCost: 'unit_cost', supplier: 'supplier', allergens: 'allergens',
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
