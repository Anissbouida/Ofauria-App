import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { unsoldDecisionRepository } from '../repositories/unsold-decision.repository.js';

export const unsoldDecisionController = {

  /** GET /unsold-decisions/suggestions — produits invendus avec suggestion auto */
  async suggestions(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun magasin associe a cet utilisateur' } });
      return;
    }
    const items = await unsoldDecisionRepository.getUnsoldWithSuggestions(storeId);
    res.json({ success: true, data: items });
  },

  /** POST /unsold-decisions — enregistrer les decisions invendus */
  async save(req: AuthRequest, res: Response) {
    const { sessionId, decisions, notes } = req.body;
    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Aucune decision a enregistrer' } });
      return;
    }
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun magasin associe' } });
      return;
    }
    const result = await unsoldDecisionRepository.saveDecisions({
      storeId,
      sessionId,
      decidedBy: req.user!.userId,
      decisions,
      notes,
    });
    res.json({ success: true, data: result });
  },

  /** GET /unsold-decisions — historique */
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, destination, productId, page = '1', limit = '50' } = req.query as Record<string, string>;
    const p = parseInt(page);
    const l = parseInt(limit);
    const storeId = req.user!.storeId;

    const result = await unsoldDecisionRepository.findAll({
      storeId: storeId || undefined,
      dateFrom,
      dateTo,
      destination,
      productId,
      limit: l,
      offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l });
  },

  /** GET /unsold-decisions/stats — tableau de bord */
  async stats(req: AuthRequest, res: Response) {
    const { month, year } = req.query as Record<string, string>;
    const now = new Date();
    const m = month ? parseInt(month) : (now.getMonth() + 1);
    const y = year ? parseInt(year) : now.getFullYear();
    const storeId = req.user!.storeId;

    const stats = await unsoldDecisionRepository.stats({
      storeId: storeId || undefined,
      month: m,
      year: y,
    });
    res.json({ success: true, data: stats });
  },

  /** GET /unsold-decisions/session/:sessionId — decisions de la session */
  async bySession(req: AuthRequest, res: Response) {
    const { sessionId } = req.params;
    const decisions = await unsoldDecisionRepository.findBySession(sessionId);
    res.json({ success: true, data: decisions });
  },
};
