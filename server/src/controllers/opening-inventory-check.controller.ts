import type { Response } from 'express';
import { approvalService } from '../services/approval.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import {
  openingInventoryCheckRepository,
  type OpeningCheckItemInput,
  type MissingReason,
} from '../repositories/opening-inventory-check.repository.js';

export const openingInventoryCheckController = {
  /**
   * GET /api/v1/inventory-checks/opening/pending
   * Liste des invendus de la veille à recontrôler ce matin pour le store de l'utilisateur.
   */
  async getPending(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'storeId requis' } });
      return;
    }
    const data = await openingInventoryCheckRepository.getPendingOpeningCheck(storeId);
    res.json({ success: true, data });
  },

  /**
   * POST /api/v1/inventory-checks/opening
   * Soumission par la caissière du recomptage matinal.
   * Body: { previousCheckId, items: [{ productId, expectedQty, foundQty, missingReason? }], notes? }
   */
  async create(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'storeId requis' } });
      return;
    }
    const { previousCheckId, items, notes } = req.body as {
      previousCheckId: string | null;
      items: OpeningCheckItemInput[];
      notes?: string;
    };

    if (!Array.isArray(items)) {
      res.status(400).json({ success: false, error: { message: 'items doit être un tableau' } });
      return;
    }

    // Validation: si écart sans raison -> erreur
    for (const it of items) {
      if (it.foundQty !== it.expectedQty && !it.missingReason) {
        res.status(400).json({
          success: false,
          error: { message: `Raison requise pour le produit ${it.productId} (écart détecté)` },
        });
        return;
      }
    }

    const check = await openingInventoryCheckRepository.createOpeningCheck({
      storeId,
      checkedBy: req.user!.userId,
      previousCheckId,
      items,
      notes,
    });

    // Circuit d'approbation (lot 8) : au-dessus du seuil d'écart paramétré, la
    // validation passe par les approbateurs désignés (gérant puis admin).
    let approval = null;
    if (check.status === 'awaiting_validation') {
      const expected = items.reduce((s, it) => s + it.expectedQty, 0);
      const gapQty = Math.abs(Number(check.total_discrepancy ?? 0));
      const gapPct = expected > 0 ? Math.round((gapQty / expected) * 10000) / 100 : (gapQty > 0 ? 100 : 0);
      const lines = items.filter((it) => it.foundQty !== it.expectedQty).length;
      const r = await approvalService.submit({
        docType: 'inventory_count', docId: check.id,
        docLabel: `Contrôle d'ouverture du ${new Date(check.created_at ?? Date.now()).toLocaleDateString('fr-FR')}`,
        amount: null, values: { gap_pct: gapPct, gap_qty: gapQty, lines },
        storeId, requestedBy: req.user!.userId,
      });
      if (r.outcome !== 'not_required') approval = r.request;
    }

    res.status(201).json({ success: true, data: check, approval });
  },

  /**
   * POST /api/v1/inventory-checks/opening/:id/validate
   * Validation par admin/manager d'un check en attente.
   * Body: { action: 'approve' | 'reject', rejectionReason? }
   */
  async validate(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { action, rejectionReason } = req.body as {
      action: 'approve' | 'reject';
      rejectionReason?: string;
    };

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({
        success: false,
        error: { message: 'action doit être "approve" ou "reject"' },
      });
      return;
    }

    if (action === 'reject' && !rejectionReason) {
      res.status(400).json({
        success: false,
        error: { message: 'rejectionReason requis pour un rejet' },
      });
      return;
    }

    // Contrôle sous circuit d'approbation (lot 8) : la décision est celle de
    // l'étape en cours ; la validation du contrôle est faite par le moteur à
    // la dernière étape.
    const pending = await approvalService.forDocument('inventory_count', id);
    if (pending && pending.status === 'pending') {
      const request = await approvalService.decide(pending.id, { userId: req.user!.userId, role: req.user!.role, storeId: req.user!.storeId ?? null }, action, rejectionReason);
      const check = await openingInventoryCheckRepository.findById(id);
      res.json({ success: true, data: check, approval: request });
      return;
    }

    try {
      const check = await openingInventoryCheckRepository.validateOpeningCheck({
        checkId: id,
        validatedBy: req.user!.userId,
        action,
        rejectionReason,
      });
      res.json({ success: true, data: check });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de validation';
      res.status(409).json({ success: false, error: { message } });
    }
  },

  /**
   * GET /api/v1/inventory-checks/opening/awaiting-validation
   * Liste des checks en attente de validation pour le store du manager.
   */
  async listAwaitingValidation(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    const checks = await openingInventoryCheckRepository.listAwaitingValidation(storeId);
    res.json({ success: true, data: checks });
  },

  /**
   * GET /api/v1/inventory-checks/opening/:id
   * Détail d'un check (avec items).
   */
  async getById(req: AuthRequest, res: Response) {
    const check = await openingInventoryCheckRepository.findById(req.params.id);
    if (!check) {
      res.status(404).json({ success: false, error: { message: 'Check introuvable' } });
      return;
    }
    res.json({ success: true, data: check });
  },
};
