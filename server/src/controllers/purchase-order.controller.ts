import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';

export const purchaseOrderController = {
  async list(req: AuthRequest, res: Response) {
    const { supplierId, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const data = await purchaseOrderRepository.findAll({
      supplierId, status, dateFrom, dateTo, storeId: req.user!.storeId,
    });
    res.json({ success: true, data });
  },

  async eligible(req: AuthRequest, res: Response) {
    const data = await purchaseOrderRepository.findEligibleForExpense(req.user!.storeId);
    res.json({ success: true, data });
  },

  async getById(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    res.json({ success: true, data: po });
  },

  async create(req: AuthRequest, res: Response) {
    const { supplierId, expectedDeliveryDate, notes, items } = req.body;
    if (!supplierId || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Fournisseur et articles requis' } });
      return;
    }
    const po = await purchaseOrderRepository.create({
      supplierId, expectedDeliveryDate, notes,
      createdBy: req.user!.userId, storeId: req.user!.storeId,
      items,
    });
    res.status(201).json({ success: true, data: po });
  },

  async send(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (po.status !== 'en_attente') {
      res.status(409).json({ success: false, error: { message: 'Le bon doit etre en attente pour etre envoye' } });
      return;
    }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'envoye');
    res.json({ success: true, data: updated });
  },

  async confirmDelivery(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (!['envoye', 'livre_partiel'].includes(po.status)) {
      res.status(409).json({ success: false, error: { message: 'Le bon doit etre envoye ou en livraison partielle' } });
      return;
    }
    const { items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Articles livres requis' } });
      return;
    }
    const result = await purchaseOrderRepository.confirmDelivery(
      req.params.id, items, req.user!.userId, req.user!.storeId
    );
    res.json({ success: true, data: result });
  },

  async markNotDelivered(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'non_livre');
    res.json({ success: true, data: updated });
  },

  async cancel(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (['livre_complet', 'annule'].includes(po.status)) {
      res.status(409).json({ success: false, error: { message: 'Impossible d\'annuler ce bon de commande' } });
      return;
    }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'annule');
    res.json({ success: true, data: updated });
  },

  async remove(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (po.status !== 'en_attente') {
      res.status(409).json({ success: false, error: { message: 'Seuls les bons en attente peuvent etre supprimes' } });
      return;
    }
    await purchaseOrderRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },

  async overdue(req: AuthRequest, res: Response) {
    const days = parseInt((req.query as Record<string, string>).days || '3');
    const data = await purchaseOrderRepository.findOverdue(days);
    res.json({ success: true, data });
  },
};
