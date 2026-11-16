/**
 * Déclaration d'une perte de produit (extrait du contrôleur, G0-24) : une seule
 * implémentation, appelée par POST /product-losses et par la déclaration de production.
 *
 * Elle ouvre sa propre transaction ; appelée dans `withTransaction`, celle-ci devient
 * un point de sauvegarde de la transaction ambiante : une perte qui échoue annule alors
 * la déclaration de production qui l'accompagne.
 */
import { db } from '../config/database.js';
import { productMaterialsUnitCost } from '../repositories/product-cost.helper.js';
import { adjustProductStock, adjustVitrineStock } from '../repositories/product-stock.helper.js';

export interface ProductLossInput {
  productId: string;
  quantity: number;
  lossType: string;
  reason: string;
  reasonNote?: string | null;
  productionPlanId?: string | null;
  planItemId?: string | null;
  photoUrl?: string | null;
  /** Manque constaté à la déclaration de production (prévu − produit) : jamais entré en stock. */
  atDeclaration?: boolean;
}

export async function declareProductLoss(input: ProductLossInput, actor: { userId: string; storeId?: string | null }) {
  const { productId, quantity, lossType, reason, reasonNote, productionPlanId, planItemId, photoUrl } = input;
    // F-020 — Valorisation au cout MATIERES reel (recette/plan), et non 0 :
    // products.cost_price = 0 sur tout le catalogue, et valoriser au prix de
    // vente surevaluerait la perte de la marge. On prend le cout matieres via
    // v_product_unit_cost (helper), avec cost_price en dernier filet.
    const unitCost = await productMaterialsUnitCost(db, productId);
    const totalCost = unitCost * quantity;

    // For production losses, ingredients were consumed but product failed
    // For casse/non_vendu/perime/recyclage losses, product stock needs to be decremented
    const ingredientsConsumed = lossType === 'production';

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // ─── Perte de production : plafond + retrait du stock produit (mig 301) ───
      // Avant : simple compteur, sans plafond ni effet sur la reserve. Desormais :
      //  - la quantite ne peut pas depasser « produit − deja declare » pour ce
      //    produit sur ce plan ;
      //  - si l'article a deja ete enregistre comme produit (stock entre), la perte
      //    sort de la reserve et du lot produit correspondant (tracabilite).
      let sourceLotId: string | null = null;
      let effectiveItemId: string | null = null;
      if (lossType === 'production' && productionPlanId && input.atDeclaration) {
        // Manque constaté à la déclaration (prévu − produit) : ces pièces ne sont jamais entrées
        // en stock. Pas de plafond ni de sortie de réserve ; l'article du plan reste tracé.
        effectiveItemId = planItemId ?? null;
      } else if (lossType === 'production' && productionPlanId) {
        await client.query(`SELECT id FROM production_plans WHERE id = $1 FOR UPDATE`, [productionPlanId]);
        let item: Record<string, any> | null = null;
        if (planItemId) {
          const it = await client.query(
            `SELECT id, status, actual_quantity, planned_quantity FROM production_plan_items
              WHERE id = $1 AND plan_id = $2 AND product_id = $3`,
            [planItemId, productionPlanId, productId]
          );
          if (!it.rows[0]) throw Object.assign(new Error('Article du plan introuvable pour ce produit'), { status: 404 });
          item = it.rows[0] as Record<string, any>;
          effectiveItemId = it.rows[0].id as string;
        }
        const itemId: string | null = effectiveItemId;
        const producedRes = await client.query(
          `SELECT COALESCE(SUM(actual_quantity), 0)::numeric AS produced
             FROM production_plan_items
            WHERE plan_id = $1 AND product_id = $2 AND status IN ('produced', 'transferred', 'received')
              ${itemId ? 'AND id = $3' : ''}`,
          itemId ? [productionPlanId, productId, itemId] : [productionPlanId, productId]
        );
        const produced = parseFloat(producedRes.rows[0].produced);
        const alreadyRes = await client.query(
          `SELECT COALESCE(SUM(quantity), 0)::numeric AS already FROM product_losses
            WHERE production_plan_id = $1 AND product_id = $2 AND loss_type = 'production'
              ${itemId ? 'AND (plan_item_id = $3 OR plan_item_id IS NULL)' : ''}`,
          itemId ? [productionPlanId, productId, itemId] : [productionPlanId, productId]
        );
        const already = parseFloat(alreadyRes.rows[0].already);
        if (produced > 0 && quantity > produced - already + 1e-9) {
          const reste = Math.max(0, produced - already);
          throw Object.assign(new Error(
            `Quantité supérieure à la production restante : ${reste} (produit ${produced}, déjà déclaré ${already})`), { status: 400 });
        }
        const itemProduced = item && ['produced', 'transferred', 'received'].includes(item.status);
        if (itemProduced && actor.storeId) {
          const lot = await client.query(
            `SELECT id FROM product_lots WHERE plan_item_id = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [itemId, actor.storeId]
          );
          sourceLotId = lot.rows[0]?.id || null;
          if (sourceLotId) {
            await client.query(
              `UPDATE product_lots
                  SET backroom_qty = GREATEST(backroom_qty - $1, 0),
                      wasted_qty = wasted_qty + $1,
                      status = CASE WHEN GREATEST(backroom_qty - $1, 0) + vitrine_qty <= 0 THEN 'depleted' ELSE status END
                WHERE id = $2`,
              [quantity, sourceLotId]
            );
          }
          const stockAfter = await adjustProductStock(client, productId, -quantity, actor.storeId,
            { origin: { type: 'product_loss' }, userId: actor.userId });
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
             VALUES ($1, 'loss', $2, $3, $4, $5, $6)`,
            [productId, -quantity, stockAfter, `Perte production: ${reason}`, actor.userId, actor.storeId]
          );
        }
      }

      // Create the loss record
      const lossResult = await client.query(
        `INSERT INTO product_losses
          (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost,
           production_plan_id, ingredients_consumed, declared_by, store_id, photo_url, plan_item_id, source_product_lot_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          productId, quantity, lossType, reason,
          reasonNote || null, unitCost, totalCost,
          productionPlanId || null, ingredientsConsumed,
          actor.userId, actor.storeId || null,
          photoUrl || null, effectiveItemId, sourceLotId,
        ]
      );

      // For vitrine/perime/recyclage: these losses happen on the display
      // (the product was already transferred to the vitrine), so we decrement
      // vitrine_quantity, not the backroom reserve.
      if (['vitrine', 'perime', 'recyclage'].includes(lossType)) {
        if (!actor.storeId) {
          throw new Error('storeId requis pour declarer une perte sur la vitrine');
        }
        const stockAfter = await adjustVitrineStock(client, productId, actor.storeId, -quantity);

        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'loss', $2, $3, $4, $5, $6)`,
          [productId, -quantity, stockAfter, `Perte ${lossType}: ${reason}`, actor.userId, actor.storeId]
        );
      }

      // For production losses: ingredients were consumed but no product was made
      // The ingredient deduction is already handled by the production process itself
      // We just record the loss for accounting purposes

      // Mig 311 (G-D8-03) : plus d'écriture de perte produit. L'écriture 6114 D / 3421 C
      // était fausse (compte 6114 absent, 3421 = clients) et le stock de produits finis
      // n'est pas comptabilisé : elle reviendra avec la valorisation des stocks (G-D8-12).

      await client.query('COMMIT');
      return lossResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
}
