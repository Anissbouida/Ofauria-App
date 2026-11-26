import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { accessReview, accessHistory, accessOverview } from '../services/access-review.js';
import { listCampaigns, openCampaign, campaignDetail, decide, resetDecision, confirmClean, closeCampaign, ReviewError, type Decision } from '../services/access-review-campaigns.js';

/** Refus métier de la revue en campagnes (lot 9) rendus tels quels. */
async function reviewCall(res: Response, fn: () => Promise<unknown>) {
  try {
    res.json({ success: true, data: (await fn()) ?? null });
  } catch (e) {
    if (e instanceof ReviewError) { res.status(e.status).json({ success: false, error: { message: e.message } }); return; }
    throw e;
  }
}

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

  // ─── Revue en campagnes (refonte Utilisateurs, lot 9, mig 709) ───
  async campaigns(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await listCampaigns() });
  },
  async openCampaign(req: AuthRequest, res: Response) {
    await reviewCall(res, async () => ({ id: await openCampaign(String(req.body.label), req.body.dueOn ?? null, req.user!.userId) }));
  },
  async campaign(req: AuthRequest, res: Response) {
    const data = await campaignDetail(req.params.id, req.user?.userId);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Revue introuvable' } }); return; }
    res.json({ success: true, data });
  },
  async decide(req: AuthRequest, res: Response) {
    await reviewCall(res, () => decide(req.params.id, req.params.userId, req.body.decision as Decision, req.body.comment ?? null, req.user!.userId));
  },
  async resetDecision(req: AuthRequest, res: Response) {
    await reviewCall(res, () => resetDecision(req.params.id, req.params.userId));
  },
  async confirmClean(req: AuthRequest, res: Response) {
    await reviewCall(res, async () => ({ confirmed: await confirmClean(req.params.id, req.user!.userId) }));
  },
  async closeCampaign(req: AuthRequest, res: Response) {
    await reviewCall(res, () => closeCampaign(req.params.id, req.user!.userId));
  },
};
