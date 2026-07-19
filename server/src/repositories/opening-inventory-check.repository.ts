import { db } from '../config/database.js';
import { productLotRepository } from './product-lot.repository.js';

export type OpeningCheckStatus = 'pending' | 'awaiting_validation' | 'validated' | 'rejected';
export type MissingReason =
  | 'theft'
  | 'breakage'
  | 'forgotten_recycle'
  | 'undeclared_loss'
  | 'measurement_error'
  | 'other';

export interface OpeningCheckItemInput {
  productId: string;
  expectedQty: number;
  foundQty: number;
  missingReason?: MissingReason;
}

export const openingInventoryCheckRepository = {
  /**
   * Liste des invendus réexposés à recontrôler ce matin pour un store donné.
   * Source: dernier closing du store, lignes destination='reexpose' avec remaining_qty > 0.
   * Retourne aussi le check opening déjà ouvert pour la journée s'il existe.
   */
  async getPendingOpeningCheck(storeId: string) {
    const lastClosing = await db.query(
      `SELECT id, created_at
       FROM daily_inventory_checks
       WHERE store_id = $1 AND check_type = 'closing'
       ORDER BY created_at DESC
       LIMIT 1`,
      [storeId]
    );

    if (lastClosing.rows.length === 0) {
      return { items: [], previousCheckId: null, existingCheck: null };
    }

    const previousCheckId: string = lastClosing.rows[0].id;
    const lastClosingAt: Date = lastClosing.rows[0].created_at;

    const existing = await db.query(
      `SELECT id, status, validated_by, validated_at, rejection_reason
       FROM daily_inventory_checks
       WHERE store_id = $1 AND check_type = 'opening'
         AND created_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [storeId, lastClosingAt]
    );

    const itemsResult = await db.query(
      `SELECT dici.product_id, dici.product_name, dici.remaining_qty AS expected_qty,
              p.is_reexposable, p.is_recyclable, p.shelf_life_days, p.display_life_hours,
              p.image_url
       FROM daily_inventory_check_items dici
       JOIN products p ON p.id = dici.product_id
       WHERE dici.check_id = $1
         AND dici.destination = 'reexpose'
         AND dici.remaining_qty > 0
       ORDER BY dici.product_name`,
      [previousCheckId]
    );

    return {
      previousCheckId,
      lastClosingAt,
      items: itemsResult.rows,
      existingCheck: existing.rows[0] || null,
    };
  },

  /**
   * Crée un check opening pour un store. Si tous les écarts sont nuls,
   * passe directement en 'validated'. Sinon en 'awaiting_validation' et
   * exige la validation d'un manager/admin avant l'ouverture caisse.
   */
  async createOpeningCheck(params: {
    storeId: string;
    sessionId?: string | null;
    checkedBy: string;
    previousCheckId: string | null;
    items: OpeningCheckItemInput[];
    notes?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const totalExpected = params.items.reduce((s, it) => s + it.expectedQty, 0);
      const totalFound = params.items.reduce((s, it) => s + it.foundQty, 0);
      const totalDiscrepancy = totalFound - totalExpected;
      const hasDiscrepancy = params.items.some((it) => it.foundQty !== it.expectedQty);
      const initialStatus: OpeningCheckStatus = hasDiscrepancy ? 'awaiting_validation' : 'validated';

      const checkResult = await client.query(
        `INSERT INTO daily_inventory_checks
           (store_id, session_id, checked_by, total_replenished, total_sold,
            total_remaining, total_discrepancy, notes, check_type, previous_check_id, status,
            validated_by, validated_at)
         VALUES ($1, $2, $3, 0, 0, $4, $5, $6, 'opening', $7, $8, $9, $10)
         RETURNING *`,
        [
          params.storeId,
          params.sessionId || null,
          params.checkedBy,
          totalFound,
          totalDiscrepancy,
          params.notes || null,
          params.previousCheckId,
          initialStatus,
          initialStatus === 'validated' ? params.checkedBy : null,
          initialStatus === 'validated' ? new Date() : null,
        ]
      );

      const check = checkResult.rows[0];

      for (const item of params.items) {
        const productNameRow = await client.query(
          'SELECT name FROM products WHERE id = $1',
          [item.productId]
        );
        const productName = productNameRow.rows[0]?.name || '';
        const discrepancy = item.foundQty - item.expectedQty;

        await client.query(
          `INSERT INTO daily_inventory_check_items
             (check_id, product_id, product_name, replenished_qty, sold_qty,
              remaining_qty, discrepancy, expected_qty, found_qty, missing_reason)
           VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8)`,
          [
            check.id,
            item.productId,
            productName,
            item.foundQty,
            discrepancy,
            item.expectedQty,
            item.foundQty,
            item.missingReason || null,
          ]
        );
      }

      await client.query('COMMIT');
      return check;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Validation par un responsable (manager/admin) d'un check en attente.
   * action='approve' -> status validated. action='reject' -> status rejected.
   */
  async validateOpeningCheck(params: {
    checkId: string;
    validatedBy: string;
    action: 'approve' | 'reject';
    rejectionReason?: string;
  }) {
    const newStatus: OpeningCheckStatus = params.action === 'approve' ? 'validated' : 'rejected';

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE daily_inventory_checks
         SET status = $1, validated_by = $2, validated_at = NOW(),
             rejection_reason = $3
         WHERE id = $4 AND check_type = 'opening' AND status = 'awaiting_validation'
         RETURNING *`,
        [newStatus, params.validatedBy, params.rejectionReason || null, params.checkId]
      );

      if (result.rows.length === 0) {
        throw new Error('Check opening introuvable ou déjà validé/rejeté.');
      }
      const check = result.rows[0];

      // N5 — Repercuter l'ecart approuve sur le stock. Avant ce fix un « 5
      // manquants (vol) » approuve restait invisible : ni vitrine, ni lots,
      // ni perte -> le manquant reapparaissait en ecart chaque fermeture.
      // Sur 'reject' on ne touche a rien (le stock reste tel quel, la
      // situation devra etre re-traitee).
      if (params.action === 'approve') {
        const items = await client.query(
          `SELECT dici.product_id, dici.product_name, dici.expected_qty, dici.found_qty,
                  dici.missing_reason, p.cost_price
             FROM daily_inventory_check_items dici
             JOIN products p ON p.id = dici.product_id
            WHERE dici.check_id = $1 AND dici.discrepancy IS DISTINCT FROM 0`,
          [params.checkId]
        );
        for (const item of items.rows) {
          const expected = parseInt(item.expected_qty) || 0;
          const found = parseInt(item.found_qty) || 0;
          const missing = expected - found; // > 0 = manquant, < 0 = surplus
          if (missing === 0) continue;
          const unitCost = parseFloat(String(item.cost_price)) || 0;

          if (missing > 0) {
            // Manquant : consommer les lots FEFO (includeExpired car ces
            // reexposes ont potentiellement une DLV limite) puis passer en
            // perte 'vitrine' avec le motif rempli par le controleur matinal.
            const fefo = await productLotRepository.planFefoVitrineConsumption(
              client, item.product_id, check.store_id, missing, { includeExpired: true }
            );
            for (const step of fefo) {
              await productLotRepository.consumeVitrineWaste(client, step.lotId, step.qty);
            }
            await client.query(
              `UPDATE product_store_stock
                  SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
                WHERE product_id = $2 AND store_id = $3`,
              [missing, item.product_id, check.store_id]
            );
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
              [item.product_id, -missing,
               `Ecart controle ouverture: ${item.product_name} -${missing} (motif ${item.missing_reason || 'non_precise'})`,
               params.validatedBy, check.store_id]
            );
            await client.query(
              `INSERT INTO product_losses
                 (product_id, quantity, loss_type, reason, reason_note,
                  unit_cost, total_cost, ingredients_consumed,
                  declared_by, store_id, source_product_lot_id)
               VALUES ($1, $2, 'vitrine', 'ecart_ouverture', $3, $4, $5, true, $6, $7, $8)`,
              [item.product_id, missing,
               `Controle d'ouverture: ${item.missing_reason || 'motif non precise'} (${item.product_name})`,
               unitCost, unitCost * missing,
               params.validatedBy, check.store_id, fefo[0]?.lotId ?? null]
            );
          } else {
            // Surplus (found > expected) : on regularise a la hausse cote
            // vitrine, on trace en transaction 'adjust'. Pas d'impact lots
            // (impossible de savoir de quel lot vient le surplus) — la
            // divergence est absorbee par un correctif manuel si besoin.
            const surplus = -missing;
            await client.query(
              `UPDATE product_store_stock
                  SET vitrine_quantity = vitrine_quantity + $1, updated_at = NOW()
                WHERE product_id = $2 AND store_id = $3`,
              [surplus, item.product_id, check.store_id]
            );
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'adjust', $2, 0, $3, $4, $5)`,
              [item.product_id, surplus,
               `Surplus controle ouverture: ${item.product_name} +${surplus}`,
               params.validatedBy, check.store_id]
            );
          }
        }
      }

      await client.query('COMMIT');
      return check;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findById(id: string) {
    const checkResult = await db.query(
      `SELECT dic.*,
              cu.first_name AS checked_by_first, cu.last_name AS checked_by_last,
              vu.first_name AS validated_by_first, vu.last_name AS validated_by_last
       FROM daily_inventory_checks dic
       LEFT JOIN users cu ON cu.id = dic.checked_by
       LEFT JOIN users vu ON vu.id = dic.validated_by
       WHERE dic.id = $1 AND dic.check_type = 'opening'`,
      [id]
    );
    if (checkResult.rows.length === 0) return null;

    const itemsResult = await db.query(
      `SELECT * FROM daily_inventory_check_items WHERE check_id = $1 ORDER BY product_name`,
      [id]
    );

    return { ...checkResult.rows[0], items: itemsResult.rows };
  },

  async listAwaitingValidation(storeId?: string) {
    const where = storeId ? 'AND dic.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT dic.*,
              u.first_name AS checked_by_first, u.last_name AS checked_by_last,
              (SELECT COUNT(*) FROM daily_inventory_check_items dici
               WHERE dici.check_id = dic.id AND dici.discrepancy != 0) AS discrepancy_lines
       FROM daily_inventory_checks dic
       JOIN users u ON u.id = dic.checked_by
       WHERE dic.check_type = 'opening' AND dic.status = 'awaiting_validation' ${where}
       ORDER BY dic.created_at DESC`,
      params
    );
    return result.rows;
  },
};
