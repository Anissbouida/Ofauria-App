import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { managementRepository as repo } from '../repositories/management.repository.js';

/**
 * Contrôle de gestion (mig 317) : budget vs réel, résultat par magasin, marges.
 * Admin et gérant. Périmètre magasin : celui de l'utilisateur ; l'admin global
 * choisit un magasin (?storeId) ou l'ensemble (sans paramètre).
 */
export const managementRouter = Router();

const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const year = z.coerce.number().int().min(2000).max(2100);

function storeOf(req: AuthRequest): string | null {
  if (req.user!.storeId && req.user!.role !== 'admin') return req.user!.storeId;
  const q = req.query.storeId ?? req.body?.storeId;
  return typeof q === 'string' && uuid.safeParse(q).success ? q : null;
}

function bad(res: Response, message = 'Paramètres invalides') {
  res.status(400).json({ success: false, error: { message } });
}

managementRouter.get('/accounts', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.accounts() });
}));

managementRouter.get('/budget', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ year }).safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.comparison(r.data.year, storeOf(req)) });
}));

managementRouter.post('/budget', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    year,
    name: z.string().trim().min(1).max(120),
    init: z.enum(['empty', 'previous_actual']).default('empty'),
    revenuePct: z.number().min(-100).max(500).default(0),
    chargesPct: z.number().min(-100).max(500).default(0),
  }).safeParse(req.body);
  if (!r.success) return bad(res);
  const data = await repo.createBudget({ ...r.data, storeId: storeOf(req), userId: req.user!.userId });
  res.status(201).json({ success: true, data });
}));

managementRouter.put('/budget/:id/lines', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    lines: z.array(z.object({ account_id: uuid, month: z.number().int().min(1).max(12), amount: z.number().min(-1e9).max(1e9) })).max(2000),
  }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res);
  await repo.saveLines(req.params.id, r.data.lines);
  res.json({ success: true });
}));

managementRouter.post('/budget/:id/status', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ status: z.enum(['draft', 'approved']) }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res);
  const data = await repo.setStatus(req.params.id, r.data.status, req.user!.userId);
  if (!data) { res.status(404).json({ success: false, error: { message: 'Budget introuvable' } }); return; }
  res.json({ success: true, data });
}));

managementRouter.delete('/budget/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  const ok = await repo.deleteBudget(req.params.id);
  if (!ok) { res.status(409).json({ success: false, error: { message: 'Seul un budget brouillon peut être supprimé' } }); return; }
  res.json({ success: true });
}));

managementRouter.get('/result-by-store', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ year }).safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.resultByStore(r.data.year) });
}));

managementRouter.get('/margins', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate, to: isoDate, groupBy: z.enum(['category', 'channel', 'product']).default('category') }).safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.margins({ ...r.data, storeId: storeOf(req) }) });
}));
