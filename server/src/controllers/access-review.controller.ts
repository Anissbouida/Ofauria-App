import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { accessReview, accessHistory, accessOverview } from '../services/access-review.js';

/** Outils admin de revue des accès (Phase 3), lecture seule. Réservé à l'administrateur. */
export const accessReviewController = {
  async review(req: AuthRequest, res: Response) {
    const data = await accessReview(req.params.id);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Utilisateur non trouvé' } }); return; }
    res.json({ success: true, data });
  },
  async history(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await accessHistory(req.params.id) });
  },
  async overview(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await accessOverview() });
  },
};
