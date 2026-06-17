import { db } from '../config/database.js';

export interface SalesChannel {
  id: string;
  code: string;
  label: string;
  color: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export const salesChannelRepository = {
  async list(includeInactive = false): Promise<SalesChannel[]> {
    const where = includeInactive ? '' : 'WHERE is_active = true';
    const result = await db.query(
      `SELECT * FROM sales_channels ${where} ORDER BY display_order, label`,
    );
    return result.rows;
  },

  async findById(id: string): Promise<SalesChannel | null> {
    const result = await db.query(`SELECT * FROM sales_channels WHERE id = $1`, [id]);
    return result.rows[0] || null;
  },

  async findDefault(): Promise<SalesChannel | null> {
    const result = await db.query(
      `SELECT * FROM sales_channels WHERE is_default = true AND is_active = true LIMIT 1`,
    );
    return result.rows[0] || null;
  },

  async create(data: { code: string; label: string; color?: string; displayOrder?: number; isDefault?: boolean }): Promise<SalesChannel> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (data.isDefault) {
        await client.query(`UPDATE sales_channels SET is_default = false WHERE is_default = true`);
      }
      const result = await client.query(
        `INSERT INTO sales_channels (code, label, color, display_order, is_default)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.code, data.label, data.color || '#64748b', data.displayOrder ?? 0, data.isDefault || false],
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

  async update(id: string, data: { label?: string; color?: string; displayOrder?: number; isDefault?: boolean; isActive?: boolean }): Promise<SalesChannel | null> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (data.isDefault) {
        // Un seul defaut a la fois
        await client.query(`UPDATE sales_channels SET is_default = false WHERE is_default = true AND id != $1`, [id]);
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const map: Record<string, string> = {
        label: 'label', color: 'color',
        displayOrder: 'display_order', isDefault: 'is_default', isActive: 'is_active',
      };
      for (const [k, col] of Object.entries(map)) {
        if ((data as Record<string, unknown>)[k] !== undefined) {
          fields.push(`${col} = $${i++}`);
          values.push((data as Record<string, unknown>)[k]);
        }
      }
      if (fields.length === 0) {
        await client.query('ROLLBACK');
        return this.findById(id);
      }
      fields.push(`updated_at = NOW()`);
      values.push(id);
      const result = await client.query(
        `UPDATE sales_channels SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
        values,
      );
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async deactivate(id: string): Promise<void> {
    // Garde-fou : refuser la desactivation du canal par defaut.
    const channel = await this.findById(id);
    if (channel?.is_default) {
      throw new Error("Impossible de desactiver le canal par defaut. Promouvez d'abord un autre canal.");
    }
    await db.query(`UPDATE sales_channels SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]);
  },
};
