import { Router, type Response } from 'express';
import { z } from 'zod';
import { costCenterController } from '../controllers/cost-center.controller.js';
import { analyticRepository } from '../repositories/analytic.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

// Centres de coûts (mig 386) et analytique (mig 428) : admin / gérant (noyau comptable).
const router = Router();

router.get('/', authenticate, can('accounting.cost_centers.view'), costCenterController.list);
router.post('/', authenticate, can('accounting.cost_centers.create'), costCenterController.create);
router.get('/invoices', authenticate, can('accounting.cost_centers.view'), costCenterController.invoices);
router.post('/assign', authenticate, can('accounting.cost_centers.assign'), costCenterController.assign);

// ─── Analytique (mig 428) : axes, clés, ventilation, balance ───
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (res: Response, m?: string) => res.status(400).json({ success: false, error: { message: m ?? 'Paramètres invalides' } });
const period = { axisId: z.string().uuid(), from: z.string().regex(DAY), to: z.string().regex(DAY) };

router.get('/axes', authenticate, can('accounting.cost_centers.view'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await analyticRepository.axes() });
}));
router.post('/axes', authenticate, can('accounting.cost_centers.axes'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(120) }).safeParse(req.body);
  if (!r.success) { bad(res, 'Code et nom requis'); return; }
  res.status(201).json({ success: true, data: await analyticRepository.createAxis(r.data) });
}));
router.get('/keys', authenticate, can('accounting.cost_centers.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const axisId = typeof req.query.axisId === 'string' && z.string().uuid().safeParse(req.query.axisId).success ? req.query.axisId : undefined;
  res.json({ success: true, data: await analyticRepository.keys(axisId) });
}));
router.post('/keys', authenticate, can('accounting.cost_centers.keys'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    axisId: z.string().uuid(), name: z.string().trim().min(1).max(120),
    lines: z.array(z.object({ costCenterId: z.string().uuid(), percent: z.coerce.number().positive().max(100) })).min(2).max(30),
  }).safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await analyticRepository.createKey(r.data, { userId: req.user!.userId }) });
}));
router.delete('/keys/:id', authenticate, can('accounting.cost_centers.delete'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await analyticRepository.deleteKey(req.params.id);
  res.json({ success: true, data: null });
}));
router.get('/ventilation/lines', authenticate, can('accounting.cost_centers.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    ...period, status: z.enum(['open', 'done', 'all']).default('open'),
    search: z.string().max(60).optional(), accountClass: z.coerce.number().refine(v => v === 6 || v === 7).optional(),
  }).safeParse(req.query);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await analyticRepository.lines({ ...r.data, accountClass: r.data.accountClass as 6 | 7 | undefined, storeId: req.user!.storeId ?? null }) });
}));
router.post('/ventilation', authenticate, can('accounting.cost_centers.ventilation'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    lineIds: z.array(z.string().uuid()).min(1).max(200), axisId: z.string().uuid(),
    costCenterId: z.string().uuid().nullish(), keyId: z.string().uuid().nullish(),
    splits: z.array(z.object({ costCenterId: z.string().uuid(), amount: z.coerce.number().positive() })).max(30).nullish(),
  }).safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await analyticRepository.ventilate(r.data, { userId: req.user!.userId }) });
}));
router.post('/ventilation/clear', authenticate, can('accounting.cost_centers.clear'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ lineIds: z.array(z.string().uuid()).min(1).max(200), axisId: z.string().uuid() }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  res.json({ success: true, data: await analyticRepository.clear(r.data, { userId: req.user!.userId }) });
}));
router.get('/balance', authenticate, can('accounting.cost_centers.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object(period).safeParse(req.query);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await analyticRepository.balance({ ...r.data, storeId: req.user!.storeId ?? null }) });
}));
router.get('/balance/lines', authenticate, can('accounting.cost_centers.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ ...period, costCenterId: z.string().uuid().optional() }).safeParse(req.query);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await analyticRepository.sectionLines({ ...r.data, costCenterId: r.data.costCenterId ?? null, storeId: req.user!.storeId ?? null }) });
}));

router.post('/:id/active', authenticate, can('accounting.cost_centers.active'), costCenterController.setActive);

export default router;
