import type { Response } from 'express';
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

    res.status(201).json({ success: true, data: check });
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
