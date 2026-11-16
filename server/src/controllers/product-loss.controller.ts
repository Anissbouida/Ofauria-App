import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productLossRepository } from '../repositories/product-loss.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { db } from '../config/database.js';
import { declareProductLoss } from '../services/product-loss.service.js';

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

    try {
      const loss = await declareProductLoss(
        { productId, quantity, lossType, reason, reasonNote, productionPlanId, planItemId, photoUrl },
        { userId: req.user!.userId, storeId: req.user!.storeId });
      res.status(201).json({ success: true, data: loss });
    } catch (err) {
      const st = (err as { status?: number })?.status;
      if (st === 400 || st === 404) {
        res.status(st).json({ success: false, error: { message: (err as Error).message } });
        return;
      }
      throw err;
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
