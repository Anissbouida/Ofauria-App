import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { crmRepository, type Stage } from '../repositories/crm.repository.js';

/** CRM (mig 371) : droit « crm » (gérant par défaut, l'admin a tout). */
export const crmRouter = Router();
function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }
const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const body = z.object({
  title: z.string().trim().min(2).max(200),
  customerId: z.string().uuid().nullish(),
  prospectName: z.string().trim().max(160).nullish(),
  prospectCompany: z.string().trim().max(200).nullish(),
  prospectPhone: z.string().trim().max(30).nullish(),
  prospectEmail: z.string().trim().email().max(255).nullish().or(z.literal('')),
  prospectCity: z.string().trim().max(100).nullish(),
  sourceCode: z.string().trim().max(40).nullish(),
  expectedAmount: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  probability: z.coerce.number().int().min(0).max(100).nullish(),
  expectedCloseDate: isoDate.nullish(),
  ownerId: z.string().uuid().nullish(),
  description: z.string().trim().max(4000).nullish(),
}).refine(b => b.customerId || b.prospectName || b.prospectCompany, { message: 'Choisissez un client ou saisissez le prospect' });

crmRouter.get('/overview', authenticate, authorizeModule('crm'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const mine = req.query.mine === 'true';
  res.json({ success: true, data: await crmRepository.overview({ storeId: req.user!.storeId ?? undefined, ownerId: mine ? req.user!.userId : undefined }) });
}));

crmRouter.get('/owners', authenticate, authorizeModule('crm'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await crmRepository.owners() });
}));

crmRouter.get('/activities', authenticate, authorizeModule('crm'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const all = req.query.all === 'true';
  res.json({ success: true, data: await crmRepository.todo({ userId: all ? undefined : req.user!.userId, limit: 100 }) });
}));

crmRouter.get('/opportunities', authenticate, authorizeModule('crm'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({
    stage: z.enum(STAGES).optional(), open: z.string().optional(), mine: z.string().optional(), search: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(200),
  }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const r = await crmRepository.list({
    stage: q.data.stage, open: q.data.open === 'true', search: q.data.search, ownerId: q.data.mine === 'true' ? req.user!.userId : undefined,
    storeId: req.user!.storeId ?? undefined, limit: q.data.limit, offset: (q.data.page - 1) * q.data.limit,
  });
  res.json({ success: true, data: r.rows, total: r.total });
}));

crmRouter.get('/opportunities/:id', authenticate, authorizeModule('crm'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const o = await crmRepository.findById(req.params.id);
  if (!o) { bad(res, 'Opportunité introuvable', 404); return; }
  res.json({ success: true, data: o });
}));

crmRouter.post('/opportunities', authenticate, authorizeModule('crm', 'create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = body.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await crmRepository.create({ ...b.data, prospectEmail: b.data.prospectEmail || null }, { userId: req.user!.userId, storeId: req.user!.storeId ?? null }) });
}));

crmRouter.put('/opportunities/:id', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = body.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const o = await crmRepository.update(req.params.id, { ...b.data, prospectEmail: b.data.prospectEmail || null }, req.user!.userId);
  if (!o) { bad(res, 'Opportunité introuvable', 404); return; }
  res.json({ success: true, data: o });
}));

crmRouter.post('/opportunities/:id/stage', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ stage: z.enum(STAGES), lostReasonCode: z.string().max(40).nullish(), lostNote: z.string().max(1000).nullish() }).safeParse(req.body);
  if (!b.success) { bad(res); return; }
  const r = await crmRepository.moveStage(req.params.id, b.data.stage as Stage, { ...b.data, userId: req.user!.userId });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Opportunité introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

crmRouter.post('/opportunities/:id/customer', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await crmRepository.createCustomer(req.params.id, req.user!.userId);
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Opportunité introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

crmRouter.post('/opportunities/:id/activities', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({
    kind: z.enum(['call', 'meeting', 'email', 'task', 'note']), subject: z.string().trim().min(2).max(200),
    dueAt: z.string().max(40).nullish(), assignedTo: z.string().uuid().nullish(), outcome: z.string().max(4000).nullish(), done: z.boolean().optional(),
  }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  if (!(await crmRepository.findById(req.params.id))) { bad(res, 'Opportunité introuvable', 404); return; }
  res.status(201).json({ success: true, data: await crmRepository.addActivity(req.params.id, b.data, req.user!.userId) });
}));

crmRouter.post('/activities/:id/done', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ outcome: z.string().max(4000).nullish() }).safeParse(req.body ?? {});
  if (!b.success) { bad(res); return; }
  const r = await crmRepository.completeActivity(req.params.id, b.data.outcome ?? null);
  if (!r) { bad(res, 'Activité introuvable ou déjà faite', 404); return; }
  res.json({ success: true, data: r });
}));

crmRouter.delete('/activities/:id', authenticate, authorizeModule('crm', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await crmRepository.deleteActivity(req.params.id);
  if (!r) { bad(res, 'Activité introuvable ou déjà faite', 404); return; }
  res.json({ success: true });
}));
