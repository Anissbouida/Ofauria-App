import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';

export const purchaseRequestController = {
  async list(req: AuthRequest, res: Response) {
    const { status, supplierId, requestedBy } = req.query as Record<string, string>;
    const requests = await purchaseRequestRepository.findAll({
      status,
      supplierId,
      requestedBy,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: requests });
  },

  async grouped(req: AuthRequest, res: Response) {
    const groups = await purchaseRequestRepository.findGroupedBySupplier(req.user!.storeId);
    res.json({ success: true, data: groups });
  },

  async create(req: AuthRequest, res: Response) {
    const { ingredientId, supplierId, quantity, unit, reason, note } = req.body;
    if (!ingredientId || !quantity || quantity <= 0 || !unit) {
      res.status(400).json({ success: false, error: { message: 'Ingredient, quantite et unite requis' } });
      return;
    }
    const request = await purchaseRequestRepository.create({
      ingredientId,
      supplierId: supplierId || null,
      quantity,
      unit,
      reason,
      note,
      requestedBy: req.user!.userId,
      storeId: req.user!.storeId,
    });
    res.status(201).json({ success: true, data: request });
  },

  async updateQuantity(req: AuthRequest, res: Response) {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0) {
      res.status(400).json({ success: false, error: { message: 'Quantite invalide' } });
      return;
    }
    const updated = await purchaseRequestRepository.updateQuantity(req.params.id, quantity);
    if (!updated) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee ou deja traitee' } });
      return;
    }
    res.json({ success: true, data: updated });
  },

  async cancel(req: AuthRequest, res: Response) {
    const { note } = req.body;
    const cancelled = await purchaseRequestRepository.cancel(req.params.id, note);
    if (!cancelled) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee ou deja traitee' } });
      return;
    }
    res.json({ success: true, data: cancelled });
  },

  async generatePO(req: AuthRequest, res: Response) {
    const { supplierId, requestIds, expectedDeliveryDate, notes, quantityOverrides } = req.body;
    if (!supplierId || !requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Fournisseur et demandes requis' } });
      return;
    }
    const po = await purchaseRequestRepository.generatePurchaseOrder({
      supplierId,
      requestIds,
      expectedDeliveryDate,
      notes,
      createdBy: req.user!.userId,
      storeId: req.user!.storeId,
      quantityOverrides,
    });
    res.status(201).json({ success: true, data: po });
  },

  async count(req: AuthRequest, res: Response) {
    const count = await purchaseRequestRepository.countPending(req.user!.storeId);
    res.json({ success: true, data: { count } });
  },
};
