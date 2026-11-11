import crypto from 'crypto';
import { db } from '../config/database.js';

// Listes de prix (phase 6.1–6.3) : CRUD des listes et de leurs lignes (paliers). La
// résolution du prix applicable est dans services/pricing.service.ts.
// Mise à jour en masse + historique des prix : phase 6.5.

export interface PriceListInput {
  name: string;
  currency?: string;
  channelId?: string | null;
  customerType?: string | null;
  priceGroup?: string | null;
  customerId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  priority?: number;
  isActive?: boolean;
}

export interface PriceListItemInput {
  productId: string;
  minQuantity?: number;
  unitPrice: number;
}

export const priceListRepository = {
  async list() {
    return (await db.query(
      `SELECT pl.*, ch.label AS channel_name,
              (SELECT count(*) FROM price_list_items i WHERE i.price_list_id = pl.id) AS item_count
         FROM price_lists pl
         LEFT JOIN sales_channels ch ON ch.id = pl.channel_id
        ORDER BY pl.is_active DESC, pl.priority DESC, pl.created_at DESC`
    )).rows;
  },

  async get(id: string) {
    const list = (await db.query(`SELECT * FROM price_lists WHERE id = $1`, [id])).rows[0];
    if (!list) return null;
    const items = (await db.query(
      `SELECT i.*, p.name AS product_name FROM price_list_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.price_list_id = $1 ORDER BY p.name, i.min_quantity`, [id])).rows;
    return { ...list, items };
  },

  async create(data: PriceListInput, userId?: string) {
    return (await db.query(
      `INSERT INTO price_lists (name, currency, channel_id, customer_type, price_group, customer_id,
         valid_from, valid_to, priority, is_active, created_by)
       VALUES ($1, COALESCE($2,'MAD'), $3, $4, $5, $6, $7, $8, COALESCE($9,0), COALESCE($10,true), $11) RETURNING *`,
      [data.name, data.currency ?? null, data.channelId ?? null, data.customerType ?? null,
       data.priceGroup ?? null, data.customerId ?? null, data.validFrom ?? null, data.validTo ?? null,
       data.priority ?? null, data.isActive ?? null, userId ?? null]
    )).rows[0];
  },

  async update(id: string, data: PriceListInput) {
    return (await db.query(
      `UPDATE price_lists SET
         name = COALESCE($2, name), currency = COALESCE($3, currency),
         channel_id = $4, customer_type = $5, price_group = $6, customer_id = $7,
         valid_from = $8, valid_to = $9, priority = COALESCE($10, priority),
         is_active = COALESCE($11, is_active), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, data.name ?? null, data.currency ?? null, data.channelId ?? null, data.customerType ?? null,
       data.priceGroup ?? null, data.customerId ?? null, data.validFrom ?? null, data.validTo ?? null,
       data.priority ?? null, data.isActive ?? null]
    )).rows[0] ?? null;
  },

  async remove(id: string) {
    return (await db.query(`DELETE FROM price_lists WHERE id = $1 RETURNING id`, [id])).rows[0] ?? null;
  },

  async setItem(listId: string, data: PriceListItemInput) {
    return (await db.query(
      `INSERT INTO price_list_items (price_list_id, product_id, min_quantity, unit_price)
       VALUES ($1, $2, COALESCE($3,0), $4)
       ON CONFLICT (price_list_id, product_id, min_quantity)
       DO UPDATE SET unit_price = EXCLUDED.unit_price RETURNING *`,
      [listId, data.productId, data.minQuantity ?? null, data.unitPrice]
    )).rows[0];
  },

  async removeItem(listId: string, itemId: string) {
    return (await db.query(
      `DELETE FROM price_list_items WHERE id = $1 AND price_list_id = $2 RETURNING id`, [itemId, listId]
    )).rows[0] ?? null;
  },

  /**
   * Mise à jour en masse du prix catalogue (phase 6.5) : hausse en % ou valeur fixe sur
   * une famille, une catégorie ou une liste d'articles. Le trigger journalise chaque
   * ligne (motif/lot/auteur posés en variables de session). Renvoie le nombre modifié
   * et l'identifiant du lot.
   */
  async bulkUpdatePrices(
    input: { categoryId?: number; family?: string; productIds?: string[]; mode: 'increase_pct' | 'set'; value: number; reason: string },
    userId: string,
  ): Promise<{ count: number; batchId: string }> {
    const client = await db.getClient();
    const batchId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.price_change_reason', $1, true)`, [input.reason || '']);
      await client.query(`SELECT set_config('app.price_change_batch', $1, true)`, [batchId]);
      await client.query(`SELECT set_config('app.price_change_user', $1, true)`, [userId || '']);
      const conds: string[] = ['price IS NOT NULL', 'price > 0'];
      const params: unknown[] = [];
      if (input.productIds?.length) { params.push(input.productIds); conds.push(`id = ANY($${params.length})`); }
      if (input.categoryId != null) { params.push(input.categoryId); conds.push(`category_id = $${params.length}`); }
      if (input.family) { params.push(input.family); conds.push(`category_id IN (SELECT id FROM categories WHERE family = $${params.length})`); }
      let expr: string;
      if (input.mode === 'set') { params.push(input.value); expr = `$${params.length}`; }
      else { params.push(input.value); expr = `ROUND(price * (1 + $${params.length}::numeric / 100), 2)`; }
      const res = await client.query(`UPDATE products SET price = ${expr} WHERE ${conds.join(' AND ')} RETURNING id`, params);
      await client.query('COMMIT');
      return { count: res.rowCount ?? 0, batchId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async priceHistory(productId?: string) {
    const where = productId ? 'WHERE l.product_id = $1' : '';
    const params = productId ? [productId] : [];
    return (await db.query(
      `SELECT l.*, p.name AS product_name, u.first_name, u.last_name
         FROM price_change_log l
         JOIN products p ON p.id = l.product_id
         LEFT JOIN users u ON u.id = l.changed_by
        ${where}
        ORDER BY l.changed_at DESC LIMIT 200`, params)).rows;
  },
};
