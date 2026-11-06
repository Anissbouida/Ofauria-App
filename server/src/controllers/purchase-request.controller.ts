import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseRequestRepository } from '../repositories/purchase-request.repository.js';
import { toOrderRepository } from '../repositories/to-order.repository.js';
import { recordAction, listActions } from '../services/document-actions.service.js';
import { approvalService } from '../services/approval.service.js';
import { db } from '../config/database.js';

/**
 * Flux procure-to-pay (mig 465) : l'approbation des achats se fait désormais sur le
 * BON DE COMMANDE chiffré (le devis retenu à l'attribution), AVANT envoi au
 * fournisseur — plus sur la demande d'achat. Approuver une DA sur un montant
 * *estimé*, avant de connaître les prix, n'avait pas de sens.
 *
 * Une demande d'achat est donc un besoin directement sourçable : on la marque
 * « approuvée » (approval_status 'approved' = prête à sourcer, le filtre de
 * createFromRequests s'appuie dessus), sans aucun circuit d'approbation. Le
 * contrôle réel (engagement TTC + cumul fournisseur du jour, barème mig 350)
 * s'applique à l'envoi du BC (purchase-order.controller).
 */
async function markRequestSourceable(requestId: string) {
  await purchaseRequestRepository.setApprovalStatus(requestId, 'approved');
  return { approvalStatus: 'approved' as const, approval: null };
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
    // Flux procure-to-pay (mig 465) : la DA est un besoin directement sourçable,
    // sans approbation (celle-ci se fait sur le BC chiffré, à l'envoi fournisseur).
    const { approvalStatus, approval } = await markRequestSourceable(request.id);
    res.status(201).json({ success: true, data: { ...request, approval_status: approvalStatus }, approval });
  },

  /**
   * Active une DA « proposée » (approval_status 'draft', générée par le MRP, L6) :
   * un humain a revu la proposition et la valide comme besoin réel. Elle devient
   * alors directement sourçable (pas d'approbation de DA, mig 465) ; l'approbation
   * des achats se fera sur le BC chiffré issu de l'attribution.
   */
  async submit(req: AuthRequest, res: Response) {
    const { rows } = await db.query(
      `SELECT id, ingredient_id, quantity, supplier_id, approval_status FROM purchase_requests WHERE id = $1`, [req.params.id]);
    const request = rows[0];
    if (!request) { res.status(404).json({ success: false, error: { message: 'Demande non trouvée' } }); return; }
    if (request.approval_status !== 'draft') {
      res.status(409).json({ success: false, error: { message: 'Seule une proposition (brouillon) peut être activée.' } });
      return;
    }
    const { approvalStatus, approval } = await markRequestSourceable(request.id as string);
    await recordAction(db, { documentType: 'purchase_request', documentId: request.id as string, action: 'submitted', actorId: req.user!.userId, note: 'proposition activée (besoin validé)' });
    res.json({ success: true, data: { ...request, approval_status: approvalStatus }, approval });
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
