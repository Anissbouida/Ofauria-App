import { db } from '../config/database.js';

export interface PricingTier {
  id: string;
  product_id: string;
  min_grammes: number;
  max_grammes: number | null;
  prix_per_kg: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export const pricingTierRepository = {
  /** Liste les paliers d'un produit, tries par min_grammes croissant. */
  async listByProduct(productId: string): Promise<PricingTier[]> {
    const result = await db.query(
      `SELECT * FROM product_pricing_tiers
       WHERE product_id = $1
       ORDER BY min_grammes ASC`,
      [productId],
    );
    return result.rows;
  },

  /** Resout le palier applicable pour un poids donne (en grammes).
   *  Retourne null si aucun palier ne matche. */
  async findMatchingTier(productId: string, grammes: number): Promise<PricingTier | null> {
    const result = await db.query(
      `SELECT * FROM product_pricing_tiers
       WHERE product_id = $1
         AND $2 >= min_grammes
         AND ($2 < max_grammes OR max_grammes IS NULL)
       ORDER BY min_grammes DESC
       LIMIT 1`,
      [productId, grammes],
    );
    return result.rows[0] || null;
  },

  /** Remplace tous les paliers d'un produit en une transaction. */
  async replaceForProduct(productId: string, tiers: Array<{
    min_grammes: number;
    max_grammes: number | null;
    prix_per_kg: number;
    display_order: number;
  }>): Promise<PricingTier[]> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM product_pricing_tiers WHERE product_id = $1`,
        [productId],
      );
      for (const tier of tiers) {
        await client.query(
          `INSERT INTO product_pricing_tiers (product_id, min_grammes, max_grammes, prix_per_kg, display_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [productId, tier.min_grammes, tier.max_grammes, tier.prix_per_kg, tier.display_order],
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
