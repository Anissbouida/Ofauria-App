import { db } from '../config/database.js';

// Listes de prix (phase 6.1–6.3) : CRUD des listes et de leurs lignes (paliers). La
// résolution du prix applicable est dans services/pricing.service.ts.

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
};
