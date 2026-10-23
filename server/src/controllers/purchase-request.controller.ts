import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { toOrderRepository } from '../repositories/to-order.repository.js';
import { recordAction, listActions } from '../services/document-actions.service.js';
import { db } from '../config/database.js';

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

  /** GET /purchase-requests/to-order : besoins d'achat fusionnés par ingrédient. */
  async toOrder(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await toOrderRepository.board(req.user!.storeId) });
  },

  /** POST /purchase-requests/order-direct : un BC brouillon par fournisseur, depuis À commander. */
  async orderDirect(req: AuthRequest, res: Response) {
    const { lines, expectedDeliveryDate } = req.body;
    const result = await toOrderRepository.orderDirect({
      lines, expectedDeliveryDate, createdBy: req.user!.userId, storeId: req.user!.storeId,
    });
    for (const po of result.orders) {
      await recordAction(db, { documentType: 'purchase_order', documentId: po.id, action: 'created', actorId: req.user!.userId, note: 'depuis Stock › À commander' });
    }
    for (const id of new Set<string>(result.requestIds)) {
      await recordAction(db, { documentType: 'purchase_request', documentId: id, action: 'approved', actorId: req.user!.userId, note: 'commandé depuis À commander', channel: 'web' });
    }
    res.status(201).json({ success: true, data: result.orders });
  },

  async grouped(req: AuthRequest, res: Response) {
    const groups = await purchaseRequestRepository.findGroupedBySupplier(req.user!.storeId);
    res.json({ success: true, data: groups });
  },

  async create(req: AuthRequest, res: Response) {
    // Corps validé par createPurchaseRequestSchema (zod) dans la route.
    const { ingredientId, supplierId, quantity, unit, reason, note } = req.body;
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
    await recordAction(db, { documentType: 'purchase_request', documentId: request.id, action: 'created', actorId: req.user!.userId });
    res.status(201).json({ success: true, data: request });
  },

  async updateQuantity(req: AuthRequest, res: Response) {
    const updated = await purchaseRequestRepository.updateQuantity(req.params.id, req.body.quantity, req.user!.userId, req.user!.storeId);
    if (!updated) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee ou deja traitee' } });
      return;
    }
    res.json({ success: true, data: updated });
  },

  async assignSupplier(req: AuthRequest, res: Response) {
    const { supplierId } = req.body;
    const updated = await purchaseRequestRepository.updateSupplier(req.params.id, supplierId || null, req.user!.userId, req.user!.storeId);
    if (!updated) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvee ou deja traitee' } });
      return;
    }
    res.json({ success: true, data: updated });
  },

  async bulkAssignSupplier(req: AuthRequest, res: Response) {
    const { requestIds, supplierId } = req.body;
    const updated = await purchaseRequestRepository.bulkUpdateSupplier(requestIds, supplierId || null, req.user!.userId, req.user!.storeId);
    res.json({ success: true, data: updated });
  },

  async cancel(req: AuthRequest, res: Response) {
    const cancelled = await purchaseRequestRepository.cancel(req.params.id, req.body.reason, req.user!.userId, req.user!.storeId);
    if (!cancelled) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvée ou déjà commandée : seule une demande en attente peut être annulée' } });
      return;
    }
    await recordAction(db, { documentType: 'purchase_request', documentId: req.params.id, action: 'cancelled', actorId: req.user!.userId, note: req.body.reason });
    res.json({ success: true, data: cancelled });
  },

  /** Clôture du reliquat d'une demande commandée (on renonce au manquant). */
  async close(req: AuthRequest, res: Response) {
    const closed = await purchaseRequestRepository.close(req.params.id, req.body.reason, req.user!.userId, req.user!.storeId);
    if (!closed) {
      res.status(404).json({ success: false, error: { message: 'Demande non trouvée ou non commandée : seule une demande commandée peut être clôturée' } });
      return;
    }
    await recordAction(db, { documentType: 'purchase_request', documentId: req.params.id, action: 'force_closed', actorId: req.user!.userId, note: req.body.reason });
    res.json({ success: true, data: closed });
  },

  async history(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await purchaseRequestRepository.history(req.params.id) });
  },

  async actions(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await listActions('purchase_request', req.params.id) });
  },

  async generatePO(req: AuthRequest, res: Response) {
    const { supplierId, requestIds, expectedDeliveryDate, notes, quantityOverrides } = req.body;
    const po = await purchaseRequestRepository.generatePurchaseOrder({
      supplierId,
      requestIds,
      expectedDeliveryDate,
      notes,
      createdBy: req.user!.userId,
      storeId: req.user!.storeId,
      quantityOverrides,
    });
    for (const id of new Set<string>(requestIds)) {
      await recordAction(db, { documentType: 'purchase_request', documentId: id, action: 'approved', actorId: req.user!.userId, note: `converti en ${po.order_number}`, channel: 'web' });
    }
    await recordAction(db, { documentType: 'purchase_order', documentId: po.id, action: 'created', actorId: req.user!.userId, note: `depuis ${new Set(requestIds).size} demande(s)` });
    res.status(201).json({ success: true, data: po });
  },

  async count(req: AuthRequest, res: Response) {
    const count = await purchaseRequestRepository.countPending(req.user!.storeId);
    res.json({ success: true, data: { count } });
  },
};
