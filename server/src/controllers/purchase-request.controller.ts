import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { toOrderRepository } from '../repositories/to-order.repository.js';
import { recordAction, listActions } from '../services/document-actions.service.js';
import { approvalService } from '../services/approval.service.js';
import { db } from '../config/database.js';

/**
 * Soumet une demande d'achat au circuit d'approbation (flux procure-to-pay, mig 456).
 * Valeurs confrontées aux règles (approval_rules, mig 350) :
 *   - amount     : montant estimé = quantité × coût unitaire de l'article ;
 *   - buyer_role : rôle du demandeur ;
 *   - category   : catégorie d'achat de l'article (valeur-liste) ;
 *   - supplier   : fournisseur pressenti (valeur-liste, facultatif).
 * Aucune règle applicable → approuvée d'emblée (approval_status = 'approved'),
 * donc immédiatement commandable. Une règle a matché → 'pending', le BC est
 * bloqué jusqu'à la décision d'un approbateur (approval-handlers.ts).
 */
async function submitRequestForApproval(
  request: { id: string; ingredient_id: string; supplier_id: string | null; quantity: string | number; store_id: string | null },
  actor: { userId: string; role: string; storeId?: string | null },
) {
  const ing = (await db.query(
    `SELECT name, category_id, unit_cost FROM ingredients WHERE id = $1`, [request.ingredient_id])).rows[0];
  const qty = parseFloat(String(request.quantity)) || 0;
  const unitCost = ing?.unit_cost != null ? parseFloat(String(ing.unit_cost)) : 0;
  const amount = Math.round(qty * unitCost * 100) / 100;
  const result = await approvalService.submit({
    docType: 'purchase_request',
    docId: request.id,
    docLabel: `DA ${ing?.name ?? ''}`.trim(),
    amount,
    values: {
      amount,
      buyer_role: actor.role,
      // Valeurs-listes : approvalConditionMatches traite eq comme « contient ».
      category: ing?.category_id ? [String(ing.category_id)] : [],
      supplier: request.supplier_id ? [String(request.supplier_id)] : [],
    },
    storeId: request.store_id ?? actor.storeId ?? null,
    requestedBy: actor.userId,
  });
  const approvalStatus = result.outcome === 'not_required' ? 'approved' : 'pending';
  await purchaseRequestRepository.setApprovalStatus(request.id, approvalStatus);
  return { approvalStatus, approval: 'request' in result ? result.request : null };
}

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
    // Flux procure-to-pay (mig 456) : la DA passe par l'approbation selon les
    // règles. Sans règle applicable → approuvée d'emblée, commandable.
    const { approvalStatus, approval } = await submitRequestForApproval(request, req.user!);
    if (approvalStatus === 'pending') {
      await recordAction(db, { documentType: 'purchase_request', documentId: request.id, action: 'submitted', actorId: req.user!.userId, note: 'soumise à approbation' });
    }
    res.status(201).json({ success: true, data: { ...request, approval_status: approvalStatus }, approval });
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
    // Une demande d'approbation en attente sur cette DA n'a plus d'objet (mig 456).
    await approvalService.cancelPending('purchase_request', req.params.id, req.user!.userId, 'Demande d\'achat annulée');
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

  // Flux procure-to-pay (mig 457) : plus de « Générer le BC » depuis une DA. Une DA
  // approuvée passe par un appel d'offres (POST /rfqs/from-requests) ; le BC naît de
  // l'attribution de l'AO.

  async count(req: AuthRequest, res: Response) {
    const count = await purchaseRequestRepository.countPending(req.user!.storeId);
    res.json({ success: true, data: { count } });
  },
};
