import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productLossRepository } from '../repositories/product-loss.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { db } from '../config/database.js';
import { productMaterialsUnitCost } from '../repositories/product-cost.helper.js';
import { adjustProductStock, adjustVitrineStock } from '../repositories/product-stock.helper.js';
import { fromProductLoss, persistEntry, reverseEntriesForSource } from '../services/journal-generator.service.js';
import { FLAGS } from '../config/feature-flags.js';

export const productLossController = {
  async list(req: AuthRequest, res: Response) {
    const { month, year, lossType, productId, productionPlanId } = req.query as Record<string, string>;
    const losses = await productLossRepository.findAll({
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
      lossType: lossType || undefined,
      productId: productId || undefined,
      productionPlanId: productionPlanId || undefined,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: losses });
  },

  async stats(req: AuthRequest, res: Response) {
    const { month, year } = req.query as Record<string, string>;
    if (!month || !year) {
      res.status(400).json({ success: false, error: { message: 'month et year sont requis' } });
      return;
    }
    const stats = await productLossRepository.stats({
      month: parseInt(month),
      year: parseInt(year),
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: stats });
  },

  async create(req: AuthRequest, res: Response) {
    const { productId, quantity, lossType, reason, reasonNote, productionPlanId, planItemId, photoUrl } = req.body;

    if (!productId || !quantity || !lossType || !reason) {
      res.status(400).json({ success: false, error: { message: 'productId, quantity, lossType et reason sont requis' } });
      return;
    }

    if (quantity <= 0) {
      res.status(400).json({ success: false, error: { message: 'La quantite doit etre superieure a 0' } });
      return;
    }

    const product = await productRepository.findById(productId);
    if (!product) {
      res.status(404).json({ success: false, error: { message: 'Produit non trouve' } });
      return;
    }

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
      if (lossType === 'production' && productionPlanId) {
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
        if (itemProduced && req.user!.storeId) {
          const lot = await client.query(
            `SELECT id FROM product_lots WHERE plan_item_id = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [itemId, req.user!.storeId]
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
          const stockAfter = await adjustProductStock(client, productId, -quantity, req.user!.storeId);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
             VALUES ($1, 'loss', $2, $3, $4, $5, $6)`,
            [productId, -quantity, stockAfter, `Perte production: ${reason}`, req.user!.userId, req.user!.storeId]
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
          req.user!.userId, req.user!.storeId || null,
          photoUrl || null, effectiveItemId, sourceLotId,
        ]
      );

      // For vitrine/perime/recyclage: these losses happen on the display
      // (the product was already transferred to the vitrine), so we decrement
      // vitrine_quantity, not the backroom reserve.
      if (['vitrine', 'perime', 'recyclage'].includes(lossType)) {
        if (!req.user!.storeId) {
          throw new Error('storeId requis pour declarer une perte sur la vitrine');
        }
        const stockAfter = await adjustVitrineStock(client, productId, req.user!.storeId, -quantity);

        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'loss', $2, $3, $4, $5, $6)`,
          [productId, -quantity, stockAfter, `Perte ${lossType}: ${reason}`, req.user!.userId, req.user!.storeId]
        );
      }

      // For production losses: ingredients were consumed but no product was made
      // The ingredient deduction is already handled by the production process itself
      // We just record the loss for accounting purposes

      // Mig 311 (G-D8-03) : plus d'écriture de perte produit. L'écriture 6114 D / 3421 C
      // était fausse (compte 6114 absent, 3421 = clients) et le stock de produits finis
      // n'est pas comptabilisé : elle reviendra avec la valorisation des stocks (G-D8-12).
      void fromProductLoss; void persistEntry;

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: lossResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      const st = (err as { status?: number })?.status;
      if (st === 400 || st === 404) {
        res.status(st).json({ success: false, error: { message: (err as Error).message } });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  },

  async remove(req: AuthRequest, res: Response) {
    const result = await productLossRepository.remove(req.params.id, req.user!.userId);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ success: false, error: { message: 'Perte non trouvee' } });
        return;
      }
      res.status(400).json({ success: false, error: { message: result.reason || 'Suppression refusee' } });
      return;
    }
    res.json({ success: true, data: null });
  },
};
