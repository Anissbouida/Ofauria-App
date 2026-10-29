import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { commissionRepository as repo } from '../repositories/commission.repository.js';

/** Commissions commerciales (barèmes mig 123 + relevé). Admin / gérant. */
export const commissionsRouter = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bad = (res: Response, m = 'Paramètres invalides') => res.status(400).json({ success: false, error: { message: m } });
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);

const ruleBody = z.object({
  employeeId: uuid,
  ratePercent: z.coerce.number().min(0).max(100),
  appliesTo: z.enum(['all', 'product']),
  appliesId: uuid.nullish(),
  validFrom: isoDate,
  validTo: isoDate.nullish(),
});

commissionsRouter.get('/rules', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined;
  res.json({ success: true, data: await repo.listRules(employeeId) });
}));

commissionsRouter.post('/rules', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = ruleBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.createRule(r.data);
  if ('error' in out) { bad(res, out.error); return; }
  res.status(201).json({ success: true, data: out });
}));

commissionsRouter.put('/rules/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = ruleBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.updateRule(req.params.id, r.data);
  if ('error' in out) { res.status(out.error === 'Barème introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

commissionsRouter.delete('/rules/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  await repo.deleteRule(req.params.id);
  res.json({ success: true, data: null });
}));

commissionsRouter.get('/statement', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate, to: isoDate, employeeId: uuid.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  res.json({ success: true, data: await repo.statement({ ...r.data, storeId: storeOf(req) ?? null }) });
}));

/* ─── Contrats-cadres à paliers (mig 393) ──────────────────────────────── */
const schemeBody = z.object({
  name: z.string().trim().min(1).max(160),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
  tiers: z.array(z.object({ fromAmount: z.coerce.number().min(0), ratePercent: z.coerce.number().min(0).max(100) })).min(1),
});

commissionsRouter.get('/schemes', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.listSchemes() });
}));

commissionsRouter.post('/schemes', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = schemeBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.createScheme({ ...r.data, storeId: storeOf(req) ?? null }, req.user!.userId);
  if ('error' in out) { bad(res, out.error); return; }
  res.status(201).json({ success: true, data: out });
}));

commissionsRouter.put('/schemes/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = schemeBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.updateScheme(req.params.id, r.data);
  if ('error' in out) { res.status(out.error === 'Contrat-cadre introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));

commissionsRouter.delete('/schemes/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  await repo.deleteScheme(req.params.id);
  res.json({ success: true, data: null });
}));

/* ─── Affectation d'un contrat-cadre à un vendeur ──────────────────────── */
commissionsRouter.get('/assignments', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined;
  res.json({ success: true, data: await repo.listAssignments(employeeId) });
}));

commissionsRouter.post('/assignments', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ employeeId: uuid, schemeId: uuid, validFrom: isoDate, validTo: isoDate.nullish() }).safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await repo.assignScheme(r.data) });
}));

commissionsRouter.delete('/assignments/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  await repo.unassignScheme(req.params.id);
  res.json({ success: true, data: null });
}));

/* ─── Versement sur bulletin de paie (mig 393) ─────────────────────────── */
commissionsRouter.post('/payout', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    from: isoDate, to: isoDate,
    payMonth: z.coerce.number().int().min(1).max(12),
    payYear: z.coerce.number().int().min(2000).max(2100),
    employeeId: uuid.optional(),
  }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.payout({ ...r.data, storeId: storeOf(req) ?? null }, req.user!.userId);
  if (out.rubriqueMissing) { bad(res, 'Rubrique de paie « COMMISSION » introuvable'); return; }
  res.json({ success: true, data: out });
}));

commissionsRouter.get('/payouts', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined;
  res.json({ success: true, data: await repo.listPayouts({ employeeId, limit: 100 }) });
}));
