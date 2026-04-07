import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';

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
    res.json({ success: true, data: session });
  },

  async getInventoryItems(req: AuthRequest, res: Response) {
    const items = await cashRegisterRepository.getInventoryItems(req.params.id);
    res.json({ success: true, data: items });
  },

  async currentSession(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findOpenSession(req.user!.userId);
    res.json({ success: true, data: session });
  },

  async open(req: AuthRequest, res: Response) {
    // Check for existing open session
    const existing = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (existing) {
      res.status(400).json({ success: false, error: { message: 'Vous avez deja une caisse ouverte' } });
      return;
    }

    const { openingAmount = 0 } = req.body;
    const session = await cashRegisterRepository.open(req.user!.userId, openingAmount, req.user!.storeId);
    res.status(201).json({ success: true, data: session });
  },

  async close(req: AuthRequest, res: Response) {
    const session = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!session) {
      res.status(400).json({ success: false, error: { message: 'Aucune caisse ouverte' } });
      return;
    }

    // Calculate totals but don't close yet - wait for actual amount
    const updated = await cashRegisterRepository.close(session.id);
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
