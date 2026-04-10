import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { receptionVoucherRepository } from '../repositories/reception-voucher.repository.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';

export const receptionVoucherController = {
  async list(req: AuthRequest, res: Response) {
    const { purchaseOrderId } = req.query as Record<string, string>;
    const data = await receptionVoucherRepository.findAll({
      purchaseOrderId, storeId: req.user!.storeId,
    });
    res.json({ success: true, data });
  },

  async getById(req: AuthRequest, res: Response) {
    const rv = await receptionVoucherRepository.findById(req.params.id);
    if (!rv) { res.status(404).json({ success: false, error: { message: 'Bon de reception non trouve' } }); return; }
    res.json({ success: true, data: rv });
  },

  async create(req: AuthRequest, res: Response) {
    const { purchaseOrderId, notes, items } = req.body;
    if (!purchaseOrderId || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Bon de commande et articles requis' } });
      return;
    }

    // Check PO exists and is in valid status
    const po = await purchaseOrderRepository.findById(purchaseOrderId);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (!['envoye', 'livre_partiel', 'en_attente'].includes(po.status)) {
      res.status(409).json({ success: false, error: { message: 'Le bon de commande n\'est pas en attente de livraison' } });
      return;
    }

    const result = await receptionVoucherRepository.create({
      purchaseOrderId, notes,
      receivedBy: req.user!.userId,
      storeId: req.user!.storeId,
      items,
    });

    res.status(201).json({ success: true, data: result });
  },

  async findByPurchaseOrder(req: AuthRequest, res: Response) {
    const data = await receptionVoucherRepository.findByPurchaseOrder(req.params.poId);
    res.json({ success: true, data });
  },
};
