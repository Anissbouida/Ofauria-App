import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { proReturnRepository } from '../repositories/pro-return.repository.js';

// Retours clients professionnels (phase 7.5).
export const proReturnController = {
  async list(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await proReturnRepository.list((req.query.customerId as string) || undefined) });
  },
  async get(req: AuthRequest, res: Response) {
    const r = await proReturnRepository.get(req.params.id);
    if (!r) { res.status(404).json({ success: false, error: { message: 'Retour introuvable' } }); return; }
    res.json({ success: true, data: r });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, any>;
    if (!b.customerId) { res.status(400).json({ success: false, error: { message: 'Client requis' } }); return; }
    try {
      const r = await proReturnRepository.create({
        customerId: b.customerId, deliveryNoteId: b.deliveryNoteId ?? null,
        storeId: b.storeId || req.user!.storeId || null, notes: b.notes ?? null, creditedInvoiceId: b.creditedInvoiceId ?? null,
        items: Array.isArray(b.items) ? b.items.map((i: Record<string, any>) => ({
          productId: i.productId, productLotId: i.productLotId ?? null, deliveryNoteItemId: i.deliveryNoteItemId ?? null,
          quantity: Number(i.quantity), unitPrice: Number(i.unitPrice ?? 0), decision: i.decision === 'scrap' ? 'scrap' : 'restock',
        })) : [],
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: r });
    } catch (e) {
      res.status((e as { statusCode?: number }).statusCode ?? 400).json({ success: false, error: { message: (e as Error).message } });
    }
  },
};
