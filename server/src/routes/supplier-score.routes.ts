import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { supplierScoreRepository as repo, loadWeights, computeScore } from '../repositories/supplier-score.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

/** Évaluation des fournisseurs (mig 362). Admin et gérant. */
export const supplierScoreRouter = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/** Période par défaut : les N derniers mois du paramètre, jusqu'à aujourd'hui. */
async function period(q: { from?: string; to?: string }) {
  const w = await loadWeights();
  const to = q.to ?? getLocalISODate();
  if (q.from) return { from: q.from, to };
  const d = new Date(to); d.setMonth(d.getMonth() - (Number(w.months) || 12));
  return { from: d.toISOString().slice(0, 10), to };
}

supplierScoreRouter.get('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate.optional(), to: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const p = await period(r.data);
  ok(res, { ...(await repo.board({ ...p, storeId: storeOf(req) })), ...p });
}));

supplierScoreRouter.get('/latest', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => ok(res, await repo.latest())));

supplierScoreRouter.post('/snapshot', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate.optional(), to: isoDate.optional(), note: z.string().trim().max(500).nullish() }).safeParse(req.body ?? {});
  if (!r.success) { bad(res); return; }
  const p = await period(r.data);
  const n = await repo.snapshot({ ...p, storeId: storeOf(req), userId: req.user!.userId, note: r.data.note });
  ok(res, { ...p, count: n });
}));

supplierScoreRouter.get('/:supplierId', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.supplierId).success) { bad(res); return; }
  const r = z.object({ from: isoDate.optional(), to: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const p = await period(r.data);
  const [w, m, facts, history] = await Promise.all([
    loadWeights(), repo.metrics({ ...p, storeId: storeOf(req), supplierId: req.params.supplierId }),
    repo.facts({ supplierId: req.params.supplierId, ...p }), repo.history(req.params.supplierId),
  ]);
  const metrics = m.get(req.params.supplierId) ?? null;
  ok(res, { ...p, weights: w, metrics, score: metrics ? computeScore(metrics, w) : null, facts, history });
}));
