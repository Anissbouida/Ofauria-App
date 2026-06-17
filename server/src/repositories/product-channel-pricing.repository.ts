import { db } from '../config/database.js';

export interface ChannelPricing {
  id: string;
  product_id: string;
  channel_id: string;
  channel_code?: string;
  channel_label?: string;
  price_override: string | null;
  price_per_kg_override: string | null;
  created_at: string;
  updated_at: string;
}

export const channelPricingRepository = {
  /** Liste les overrides d'un produit avec join sur sales_channels pour l'UI. */
  async listByProduct(productId: string): Promise<ChannelPricing[]> {
    const result = await db.query(
      `SELECT pcp.*, sc.code AS channel_code, sc.label AS channel_label
       FROM product_channel_pricing pcp
       JOIN sales_channels sc ON sc.id = pcp.channel_id
       WHERE pcp.product_id = $1
       ORDER BY sc.display_order, sc.label`,
      [productId],
    );
    return result.rows;
  },

  /** Resout l'override pour un (product, channel). Null si pas d'override. */
  async findOverride(productId: string, channelId: string | null): Promise<ChannelPricing | null> {
    if (!channelId) return null;
    const result = await db.query(
      `SELECT * FROM product_channel_pricing
       WHERE product_id = $1 AND channel_id = $2
       LIMIT 1`,
      [productId, channelId],
    );
    return result.rows[0] || null;
  },

  /** Remplace tous les overrides d'un produit. */
  async replaceForProduct(productId: string, items: Array<{
    channel_id: string;
    price_override: number | null;
    price_per_kg_override: number | null;
  }>): Promise<ChannelPricing[]> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM product_channel_pricing WHERE product_id = $1`, [productId]);
      for (const it of items) {
        // skip si les 2 sont null (contrainte CHECK SQL le refuserait)
        if (it.price_override === null && it.price_per_kg_override === null) continue;
        await client.query(
          `INSERT INTO product_channel_pricing (product_id, channel_id, price_override, price_per_kg_override)
           VALUES ($1, $2, $3, $4)`,
          [productId, it.channel_id, it.price_override, it.price_per_kg_override],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listByProduct(productId);
  },
};
