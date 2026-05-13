import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { unsoldDecisionRepository } from '../repositories/unsold-decision.repository.js';

export const cashRegisterController = {
  async list(req: AuthRequest, res: Response) {
    const { userId, status, dateFrom, dateTo, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await cashRegisterRepository.findAll({
      userId, status, dateFrom, dateTo, storeId: req.user!.storeId, limit: l, offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },

  async getById(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findById(req.params.id);
    if (!session) { res.status(404).json({ success: false, error: { message: 'Session non trouvee' } }); return; }
    // Verification store (multi-tenant)
    if (req.user!.storeId && session.store_id && session.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    // Verification ownership : admin/manager voient tout dans leur store,
    // cashier/saleswoman uniquement leur propre session
    const isPrivileged = req.user!.role === 'admin' || req.user!.role === 'manager';
    if (!isPrivileged && session.user_id !== req.user!.userId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse a la session d\'un autre utilisateur' } });
      return;
    }
    res.json({ success: true, data: session });
  },

  async getInventoryItems(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findById(req.params.id);
    if (!session) { res.status(404).json({ success: false, error: { message: 'Session non trouvee' } }); return; }
    if (req.user!.storeId && session.store_id && session.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const isPrivileged = req.user!.role === 'admin' || req.user!.role === 'manager';
    if (!isPrivileged && session.user_id !== req.user!.userId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    const items = await cashRegisterRepository.getInventoryItems(req.params.id);
    res.json({ success: true, data: items });
  },

  async currentSession(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findOpenSession(req.user!.userId);
    res.json({ success: true, data: session });
  },

  async lastClosedAmount(req: AuthRequest, res: Response) {
    const last = await cashRegisterRepository.findLastClosedSession(req.user!.storeId);
    const amount = last ? parseFloat(last.actual_amount) : 0;
    res.json({ success: true, data: { amount } });
  },

  async open(req: AuthRequest, res: Response) {
    // Check for existing open session
    const existing = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (existing) {
      res.status(400).json({ success: false, error: { message: 'Vous avez deja une caisse ouverte' } });
      return;
    }

    const { openingAmount = 0 } = req.body;
    try {
      const session = await cashRegisterRepository.open(req.user!.userId, openingAmount, req.user!.storeId);
      res.status(201).json({ success: true, data: session });
    } catch (err) {
      // Trigger SQL `check_opening_inventory_required` bloque l'ouverture si le contrôle
      // d'inventaire matinal n'a pas été validé. On expose un code dédié au front pour
      // rediriger vers la page de contrôle.
      const message = err instanceof Error ? err.message : '';
      if (message.includes('opening_inventory_check_required')) {
        res.status(409).json({
          success: false,
          error: {
            code: 'OPENING_INVENTORY_CHECK_REQUIRED',
            message: 'Contrôle d\'inventaire d\'ouverture requis avant d\'ouvrir la caisse.',
          },
        });
        return;
      }
      throw err;
    }
  },

  async close(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!session) {
      res.status(400).json({ success: false, error: { message: 'Aucune caisse ouverte' } });
      return;
    }

    const closeType = req.body?.closeType || 'fin_journee';

    // Phase 3 — En fin de journee, on rejette si des items vitrine sont
    // expires (DLC ou DLV depassee) et n'ont pas encore ete detruits.
    // Le client doit appeler GET /unsold-decisions/expired puis
    // POST /unsold-decisions/destroy-expired AVANT de pouvoir cloturer.
    const storeId = req.user!.storeId;
    if (closeType === 'fin_journee' && storeId) {
      const expired = await unsoldDecisionRepository.getExpiredItems(storeId);
      if (expired.length > 0) {
        res.status(409).json({
          success: false,
          error: {
            code: 'EXPIRED_ITEMS_PENDING',
            message: `${expired.length} produit(s) avec DLC/DLV depassee doivent etre detruits avant la fermeture journee`,
            details: { count: expired.length, items: expired },
          },
        });
        return;
      }
    }

    // Calculate totals but don't close yet - wait for actual amount
    const updated = await cashRegisterRepository.close(session.id, closeType);
    res.json({ success: true, data: updated });
  },

  async submitAmount(req: AuthRequest, res: Response) {
    const { actualAmount, notes } = req.body;

    if (actualAmount === undefined || actualAmount === null) {
      res.status(400).json({ success: false, error: { message: 'Montant reel requis' } });
      return;
    }

    // Verify session belongs to the authenticated user
    const session = await cashRegisterRepository.findById(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: { message: 'Session non trouvee' } });
      return;
    }
    if (session.user_id !== req.user!.userId) {
      res.status(403).json({ success: false, error: { message: 'Vous ne pouvez fermer que votre propre caisse' } });
      return;
    }

    const result = await cashRegisterRepository.submitActualAmount(req.params.id, parseFloat(actualAmount), notes);
    if (!result) {
      res.status(404).json({ success: false, error: { message: 'Session non trouvee' } });
      return;
    }

    res.json({ success: true, data: result });
  },
};
