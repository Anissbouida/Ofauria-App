import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productLossRepository } from '../repositories/product-loss.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { db } from '../config/database.js';
import { adjustProductStock } from '../repositories/product-stock.helper.js';

export const productLossController = {
  async list(req: AuthRequest, res: Response) {
    const { month, year, lossType, productId } = req.query as Record<string, string>;
    const losses = await productLossRepository.findAll({
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
      lossType: lossType || undefined,
      productId: productId || undefined,
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
    const { productId, quantity, lossType, reason, reasonNote, productionPlanId } = req.body;

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

    // Calculate cost: use cost_price if available, otherwise use selling price
    const costPrice = product.cost_price ? parseFloat(product.cost_price) : 0;
    const sellingPrice = product.price ? parseFloat(product.price) : 0;
    const unitCost = (costPrice > 0) ? costPrice : sellingPrice;
    const totalCost = unitCost * quantity;

    // For production losses, ingredients were consumed but product failed
    // For casse/non_vendu/perime/recyclage losses, product stock needs to be decremented
    const ingredientsConsumed = lossType === 'production';

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Create the loss record
      const lossResult = await client.query(
        `INSERT INTO product_losses
          (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost,
           production_plan_id, ingredients_consumed, declared_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          productId, quantity, lossType, reason,
          reasonNote || null, unitCost, totalCost,
          productionPlanId || null, ingredientsConsumed,
          req.user!.userId, req.user!.storeId || null,
        ]
      );

      // For vitrine/perime/recyclage: decrement product stock (product was already produced)
      if (['vitrine', 'perime', 'recyclage'].includes(lossType)) {
        const stockAfter = await adjustProductStock(client, productId, -quantity, req.user!.storeId);

        // Log stock transaction
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'loss', $2, $3, $4, $5, $6)`,
          [productId, -quantity, stockAfter, `Perte ${lossType}: ${reason}`, req.user!.userId, req.user!.storeId || null]
        );
      }

      // For production losses: ingredients were consumed but no product was made
      // The ingredient deduction is already handled by the production process itself
      // We just record the loss for accounting purposes

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: lossResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async remove(req: AuthRequest, res: Response) {
    await productLossRepository.remove(req.params.id);
    res.json({ success: true, data: null });
  },
};
