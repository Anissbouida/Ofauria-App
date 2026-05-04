import { db } from '../config/database.js';

export const stockFrigoRepository = {

  // ─── List stock frigo entries for a store ───
  async findByStore(storeId: string, includeExpired = false) {
    const expiredFilter = includeExpired ? '' : `AND (sf.expires_at IS NULL OR sf.expires_at > NOW())`;
    const result = await db.query(
      `SELECT sf.*, p.name as product_name, p.price as product_price,
              pc.nom as contenant_nom, pc.type_production,
              COALESCE(pp.plan_date::text, '') as plan_date
       FROM stock_semifini_frigo sf
       JOIN products p ON p.id = sf.product_id
       LEFT JOIN production_contenants pc ON pc.id = sf.source_contenant_id
       LEFT JOIN production_plans pp ON pp.id = sf.source_plan_id
       WHERE sf.store_id = $1 AND sf.is_active = true AND sf.quantity > 0
         ${expiredFilter}
       ORDER BY sf.expires_at ASC NULLS LAST, sf.produced_at ASC`,
      [storeId]
    );
    return result.rows;
  },

  // ─── Get available quantity for a product (FEFO order) ───
  async getAvailableForProduct(productId: string, storeId: string): Promise<number> {
    const result = await db.query(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM stock_semifini_frigo
       WHERE product_id = $1 AND store_id = $2
         AND is_active = true AND quantity > 0
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [productId, storeId]
    );
    return parseFloat(result.rows[0].total);
  },

  // ─── Consume from frigo using FEFO (First Expiry First Out) ───
  // Returns the actual quantity consumed and the lots used
  async consumeFEFO(
    productId: string,
    storeId: string,
    quantity: number,
    performedBy: string,
    referenceId?: string,
    referenceType?: string
  ): Promise<{ consumed: number; lots: { stockFrigoId: string; quantity: number; lotNumber: string | null }[] }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get available lots in FEFO order
      const lotsResult = await client.query(
        `SELECT id, quantity, lot_number, expires_at
         FROM stock_semifini_frigo
         WHERE product_id = $1 AND store_id = $2
           AND is_active = true AND quantity > 0
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY expires_at ASC NULLS LAST, produced_at ASC
         FOR UPDATE`,
        [productId, storeId]
      );

      let remaining = quantity;
      const lots: { stockFrigoId: string; quantity: number; lotNumber: string | null }[] = [];

      for (const lot of lotsResult.rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, parseFloat(lot.quantity));

        await client.query(
          `UPDATE stock_semifini_frigo SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2`,
          [take, lot.id]
        );

        await client.query(
          `INSERT INTO stock_frigo_transactions (stock_frigo_id, type, quantity, reference_id, reference_type, performed_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [lot.id, referenceType === 'replenishment' ? 'replenishment_out' : 'sale_out', -take, referenceId || null, referenceType || null, performedBy]
        );

        lots.push({ stockFrigoId: lot.id, quantity: take, lotNumber: lot.lot_number });
        remaining -= take;
      }

      await client.query('COMMIT');
      return { consumed: quantity - remaining, lots };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Add surplus to frigo after production ───
  async addSurplus(data: {
    productId: string;
    storeId: string;
    quantity: number;
    lotNumber?: string;
    expiresAt?: string;
    sourcePlanId?: string;
    sourceContenantId?: string;
    performedBy: string;
    notes?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO stock_semifini_frigo (product_id, store_id, quantity, lot_number, expires_at, source_plan_id, source_contenant_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [data.productId, data.storeId, data.quantity, data.lotNumber || null,
         data.expiresAt || null, data.sourcePlanId || null, data.sourceContenantId || null, data.notes || null]
      );

      await client.query(
        `INSERT INTO stock_frigo_transactions (stock_frigo_id, type, quantity, reference_id, reference_type, performed_by, notes)
         VALUES ($1, 'production_in', $2, $3, 'production_plan', $4, $5)`,
        [result.rows[0].id, data.quantity, data.sourcePlanId || null, data.performedBy, data.notes || null]
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

  // ─── Record loss/expired ───
  async recordLoss(stockFrigoId: string, quantity: number, type: 'loss' | 'expired', performedBy: string, notes?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE stock_semifini_frigo SET quantity = GREATEST(quantity - $1, 0), updated_at = NOW() WHERE id = $2`,
        [quantity, stockFrigoId]
      );

      await client.query(
        `INSERT INTO stock_frigo_transactions (stock_frigo_id, type, quantity, performed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [stockFrigoId, type, -quantity, performedBy, notes || null]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Adjust quantity ───
  async adjust(stockFrigoId: string, newQuantity: number, performedBy: string, notes?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const current = await client.query(`SELECT quantity FROM stock_semifini_frigo WHERE id = $1`, [stockFrigoId]);
      const diff = newQuantity - parseFloat(current.rows[0].quantity);

      await client.query(
        `UPDATE stock_semifini_frigo SET quantity = $1, updated_at = NOW() WHERE id = $2`,
        [newQuantity, stockFrigoId]
      );

      await client.query(
        `INSERT INTO stock_frigo_transactions (stock_frigo_id, type, quantity, performed_by, notes)
         VALUES ($1, 'adjustment', $2, $3, $4)`,
        [stockFrigoId, diff, performedBy, notes || `Ajustement: ${diff > 0 ? '+' : ''}${diff}`]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Get transaction history for a stock entry ───
  async getTransactions(stockFrigoId: string) {
    const result = await db.query(
      `SELECT sft.*, u.first_name as performed_by_name
       FROM stock_frigo_transactions sft
       LEFT JOIN users u ON u.id = sft.performed_by
       WHERE sft.stock_frigo_id = $1
       ORDER BY sft.created_at DESC`,
      [stockFrigoId]
    );
    return result.rows;
  },

  // ─── Summary per base recipe (semi-finis) ───
  // Unifies the two data sources:
  //   * semi_finished_stock (legacy, fed by the production dependency resolver,
  //     keyed by recipe_id)
  //   * stock_semifini_frigo (newer lot tracking, keyed by product_id)
  // Returned rows are always keyed by recipe_id so the products module can
  // display the authoritative sellable quantity for each base recipe.
  async getBaseRecipesStock(storeId: string) {
    const result = await db.query(
      `SELECT
         r.id                               as recipe_id,
         r.name                             as recipe_name,
         r.product_id,
         COALESCE(sfs.quantity_available, 0)::numeric
           + COALESCE(frigo.total_quantity, 0)::numeric   as total_quantity,
         COALESCE(frigo.nb_lots, 0)::int    as nb_lots,
         frigo.earliest_expiry              as earliest_expiry,
         COALESCE(reserved.total, 0)::numeric as reserved_quantity
       FROM recipes r
       LEFT JOIN semi_finished_stock sfs
         ON sfs.recipe_id = r.id AND sfs.store_id = $1
       LEFT JOIN LATERAL (
         SELECT SUM(sf.quantity) as total_quantity,
                COUNT(*)          as nb_lots,
                MIN(sf.expires_at) as earliest_expiry
         FROM stock_semifini_frigo sf
         WHERE sf.product_id = r.product_id
           AND sf.store_id = $1
           AND sf.is_active = true
           AND sf.quantity > 0
           AND (sf.expires_at IS NULL OR sf.expires_at > NOW())
       ) frigo ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(ppd.quantity_from_stock) as total
         FROM production_plan_dependencies ppd
         JOIN production_plans pp ON pp.id = ppd.parent_plan_id
         WHERE ppd.sub_recipe_id = r.id
           AND ppd.status = 'fulfilled'
           AND pp.store_id = $1
           AND pp.status NOT IN ('completed', 'cancelled')
       ) reserved ON TRUE
       WHERE r.is_base = true`,
      [storeId]
    );
    return result.rows;
  },

  // ─── Detailed lineage for one base recipe ───
  // Returns: recent production runs, current reservations, and last transactions.
  // Used by the Semi-finis tab expanded panel so the user can see *why* stock
  // is reserved and *who* produced it.
  async getRecipeLineage(recipeId: string, storeId: string) {
    const [productions, reservations, transactions, current] = await Promise.all([
      // Production runs feeding this recipe (completed or in progress)
      db.query(
        `SELECT pp.id, pp.plan_date, pp.status, pp.notes, pp.completed_at,
                ppi.planned_quantity, ppi.actual_quantity, ppi.status as item_status
         FROM production_plans pp
         JOIN production_plan_items ppi ON ppi.plan_id = pp.id
         WHERE ppi.base_recipe_id = $1 AND pp.store_id = $2
         ORDER BY pp.plan_date DESC, pp.created_at DESC
         LIMIT 10`,
        [recipeId, storeId],
      ),
      // Active reservations by parent plans (not yet completed/cancelled)
      db.query(
        `SELECT ppd.id, ppd.parent_plan_id, ppd.quantity_from_stock, ppd.quantity_needed,
                ppd.status as dep_status, ppd.created_at,
                pp.plan_date, pp.status as plan_status, pp.notes as plan_notes,
                pp.target_role
         FROM production_plan_dependencies ppd
         JOIN production_plans pp ON pp.id = ppd.parent_plan_id
         WHERE ppd.sub_recipe_id = $1
           AND pp.store_id = $2
           AND ppd.status = 'fulfilled'
           AND ppd.quantity_from_stock > 0
           AND pp.status NOT IN ('completed', 'cancelled')
         ORDER BY pp.plan_date DESC, ppd.created_at DESC`,
        [recipeId, storeId],
      ),
      // Last 20 movements on the stock (production / reservation / release)
      db.query(
        `SELECT sft.type, sft.quantity_change, sft.created_at, sft.notes,
                sft.production_plan_id,
                pp.plan_date as plan_date, pp.status as plan_status, pp.notes as plan_notes
         FROM semi_finished_transactions sft
         LEFT JOIN production_plans pp ON pp.id = sft.production_plan_id
         WHERE sft.recipe_id = $1 AND sft.store_id = $2
         ORDER BY sft.created_at DESC
         LIMIT 20`,
        [recipeId, storeId],
      ),
      // Current stock snapshot
      db.query(
        `SELECT quantity_available, unit, last_produced_at
         FROM semi_finished_stock
         WHERE recipe_id = $1 AND store_id = $2`,
        [recipeId, storeId],
      ),
    ]);

    return {
      current: current.rows[0] || null,
      productions: productions.rows,
      reservations: reservations.rows,
      transactions: transactions.rows,
    };
  },

  // ─── Dashboard: summary per product ───
  async getSummary(storeId: string) {
    const result = await db.query(
      `SELECT sf.product_id, p.name as product_name, p.price as product_price,
              SUM(sf.quantity) as total_quantity,
              COUNT(*) as nb_lots,
              MIN(sf.expires_at) as earliest_expiry
       FROM stock_semifini_frigo sf
       JOIN products p ON p.id = sf.product_id
       WHERE sf.store_id = $1 AND sf.is_active = true AND sf.quantity > 0
         AND (sf.expires_at IS NULL OR sf.expires_at > NOW())
       GROUP BY sf.product_id, p.name, p.price
       ORDER BY p.name`,
      [storeId]
    );
    return result.rows;
  },
};
