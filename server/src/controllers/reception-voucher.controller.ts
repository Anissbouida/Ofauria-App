import type { Response } from 'express';
import { approvalService } from '../services/approval.service.js';
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
    if (req.user!.storeId && rv.store_id && rv.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
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
    // L4 (P2P, 2/5) — une approbation pendante bloque la réception quel que soit
    // le statut : couvre la soumission initiale (BC en_attente) ET la
    // ré-approbation d'un avenant sur un BC déjà envoyé.
    if (await approvalService.hasPending('purchase_order', purchaseOrderId)) {
      res.status(409).json({ success: false, error: { message: 'Ce bon attend une approbation : il ne peut pas être réceptionné' } });
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

  /** Écarts de prix à la réception à décider / décidés (lot L3 P2P, incrément 2/5). */
  async priceVariances(req: AuthRequest, res: Response) {
    const data = await receptionVoucherRepository.listPriceVariances(req.user!.storeId);
    res.json({ success: true, data });
  },

  /** Décision d'un responsable sur un écart de prix de réception : approuvé ou rejeté. */
  async decidePrice(req: AuthRequest, res: Response) {
    const { decision, note } = req.body as { decision?: string; note?: string };
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ success: false, error: { message: 'Décision invalide (approved ou rejected)' } });
      return;
    }
    try {
      const r = await receptionVoucherRepository.decidePrice(req.params.id, decision, note?.trim() || null, req.user!.userId);
      res.json({ success: true, data: r });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e?.statusCode ?? 400).json({ success: false, error: { message: e?.message ?? 'Erreur lors de la décision' } });
    }
  },

  /** Factures reçues dont la réévaluation déplacerait un montant (simulation, lot L3 P2P 3/5). */
  async revaluationCandidates(req: AuthRequest, res: Response) {
    const data = await receptionVoucherRepository.revaluationCandidates(req.user!.storeId);
    res.json({ success: true, data });
  },

  /** Simulation détaillée (par lot) de la réévaluation d'une facture. Aucune écriture. */
  async revaluationPreview(req: AuthRequest, res: Response) {
    const data = await receptionVoucherRepository.revaluationPreview(req.params.invoiceId);
    res.json({ success: true, data });
  },
};
