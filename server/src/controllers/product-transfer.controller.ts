import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productTransferRepository } from '../repositories/product-transfer.repository.js';

// Transferts de produits finis entre sites (phase 7.4).
export const productTransferController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await productTransferRepository.list({ storeId: (req.query.storeId as string) || null }) });
  },
  async get(req: AuthRequest, res: Response) {
    const t = await productTransferRepository.get(req.params.id);
    if (!t) { res.status(404).json({ success: false, error: { message: 'Transfert introuvable' } }); return; }
    res.json({ success: true, data: t });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, any>;
    if (!b.fromStoreId || !b.toStoreId) { res.status(400).json({ success: false, error: { message: 'Site source et destination requis' } }); return; }
    try {
      const t = await productTransferRepository.create({
        fromStoreId: b.fromStoreId, toStoreId: b.toStoreId,
        items: Array.isArray(b.items) ? b.items.map((i: Record<string, any>) => ({ productId: i.productId, quantity: Number(i.quantity) })) : [],
        notes: b.notes ?? null, transferDate: b.transferDate ?? null, createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: t });
    } catch (e) {
      res.status((e as { statusCode?: number }).statusCode ?? 400).json({ success: false, error: { message: (e as Error).message } });
    }
  },
};
