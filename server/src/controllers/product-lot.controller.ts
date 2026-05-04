import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productLotRepository } from '../repositories/product-lot.repository.js';

export const productLotController = {
  /** GET /product-lots/expired-active — lots expires + stock orphelin (sans lot) */
  async expiredActive(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    const [lots, orphans] = await Promise.all([
      productLotRepository.findExpiredActiveLots(storeId),
      productLotRepository.findOrphanStockProducts(storeId),
    ]);
    const data = [
      ...lots.map((l: Record<string, unknown>) => ({ ...l, kind: 'lot' })),
      ...orphans.map((o: Record<string, unknown>) => ({ ...o, kind: 'orphan' })),
    ];
    res.json({ success: true, data });
  },

  /** POST /product-lots/:id/send-to-losses — envoyer un lot produit aux pertes */
  async sendToLosses(req: AuthRequest, res: Response) {
    const { reason, note } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: { message: 'Motif requis' } });
      return;
    }
    try {
      const result = await productLotRepository.sendToLosses(
        req.params.id, reason, req.user!.userId, note
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /** POST /product-lots/send-orphan-to-losses — envoyer le stock orphelin (sans lot) aux pertes */
  async sendOrphanToLosses(req: AuthRequest, res: Response) {
    const { productId, reason, note } = req.body;
    if (!productId || !reason) {
      res.status(400).json({ success: false, error: { message: 'productId et motif requis' } });
      return;
    }
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'storeId manquant dans la session' } });
      return;
    }
    try {
      const result = await productLotRepository.sendOrphanStockToLosses(
        productId, req.user!.storeId, reason, req.user!.userId, note
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },
};
