import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { maintenanceRepository as repo } from '../repositories/maintenance.repository.js';

/** Maintenance (mig 359) : plans d'entretien et interventions. Droit « Maintenance » (module maintenance). */
export const maintenanceRouter = Router();

const VIEW = [authenticate, authorizeModule('maintenance', 'view')];
const CREATE = [authenticate, authorizeModule('maintenance', 'create')];
const EDIT = [authenticate, authorizeModule('maintenance', 'edit')];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const money = z.coerce.number().min(0);
const priority = z.enum(['low', 'normal', 'high', 'critical']);
const kind = z.enum(['preventive', 'corrective', 'installation', 'warranty']);
const status = z.enum(['requested', 'scheduled', 'in_progress', 'done', 'cancelled']);

const equipment = {
  fixedAssetId: uuid.nullish(), customerId: uuid.nullish(), equipmentLabel: text(200).nullish(), serialNo: text(80).nullish(),
};
const interventionFields = z.object({
  kind: kind.optional(), priority: priority.optional(), title: text(200).min(1), ...equipment, location: text(200).nullish(),
  planId: uuid.nullish(), complaintId: uuid.nullish(), projectId: uuid.nullish(), reportedProblem: text(4000).nullish(),
  assigneeId: uuid.nullish(), scheduledAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).nullish(),
  underWarranty: z.boolean().optional(), billable: z.boolean().optional(), photoUrl: text(500).nullish(),
  workDone: text(4000).nullish(), downtimeHours: money.nullish(), laborHours: money.nullish(), laborRate: money.nullish(),
  partsCost: money.optional(), billedAmount: money.nullish(),
});
const hasEquipment = (b: { fixedAssetId?: string | null; equipmentLabel?: string | null }) => !!b.fixedAssetId || !!b.equipmentLabel?.trim();
const planBody = z.object({
  label: text(200).min(1), ...equipment, frequencyDays: z.coerce.number().int().min(1).max(3660), checklist: text(4000).nullish(),
  assigneeId: uuid.nullish(), nextDueOn: isoDate, isActive: z.boolean().optional(),
}).refine(hasEquipment, { message: 'Équipement requis (immobilisation ou libellé)' });

const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);
const ctx = (req: AuthRequest) => ({ userId: req.user!.userId, storeId: req.user!.storeId ?? null });
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }
function notFound(res: Response, message = 'Introuvable') { res.status(404).json({ success: false, error: { message } }); }
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/* ─── Interventions ───────────────────────────────────────────────────────── */
const listQuery = z.object({
  status: status.optional(), kind: kind.optional(), assigneeId: uuid.optional(), fixedAssetId: uuid.optional(), customerId: uuid.optional(),
  overdueOnly: z.coerce.boolean().optional(), search: text(100).optional(), dateFrom: isoDate.optional(), dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
maintenanceRouter.get('/', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = listQuery.safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, search, ...f } = r.data;
  ok(res, { ...(await repo.list({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize })), page, pageSize });
}));

maintenanceRouter.get('/overview', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.overview({ ...r.data, storeId: storeOf(req) }));
}));

maintenanceRouter.get('/equipment-report', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.equipmentReport({ ...r.data, storeId: storeOf(req) }));
}));

maintenanceRouter.get('/lookup/assets', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await repo.assets(storeOf(req)))));
maintenanceRouter.get('/lookup/people', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => ok(res, await repo.people(storeOf(req)))));

maintenanceRouter.post('/', ...CREATE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = interventionFields.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  if (!hasEquipment(r.data)) { bad(res, 'Équipement requis (immobilisation ou libellé)'); return; }
  res.status(201).json({ success: true, data: await repo.create(r.data, ctx(req)) });
}));

/* ─── Plans ───────────────────────────────────────────────────────────────── */
maintenanceRouter.get('/plans', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  ok(res, await repo.listPlans({ storeId: storeOf(req), activeOnly: req.query.activeOnly === 'true' }));
}));
maintenanceRouter.post('/plans', ...CREATE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = planBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await repo.savePlan(r.data, ctx(req)) });
}));
maintenanceRouter.put('/plans/:id', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = planBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  if (!(await repo.findPlan(req.params.id))) { notFound(res, 'Plan introuvable'); return; }
  ok(res, await repo.savePlan({ ...r.data, id: req.params.id }, ctx(req)));
}));
maintenanceRouter.post('/plans/:id/create-intervention', ...CREATE, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.createFromPlan(req.params.id, ctx(req));
  if (!data) { notFound(res, 'Plan introuvable'); return; }
  res.status(201).json({ success: true, data });
}));

/* ─── Une intervention ────────────────────────────────────────────────────── */
maintenanceRouter.get('/:id', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.findById(req.params.id);
  if (!data) { notFound(res, 'Intervention introuvable'); return; }
  ok(res, data);
}));

maintenanceRouter.patch('/:id', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = interventionFields.partial().safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.update(req.params.id, r.data, req.user!.userId);
  if (!data) { notFound(res, 'Intervention introuvable'); return; }
  ok(res, data);
}));

maintenanceRouter.post('/:id/status', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({
    status, note: text(2000).nullish(), workDone: text(4000).nullish(), laborHours: money.nullish(), laborRate: money.nullish(),
    partsCost: money.nullish(), downtimeHours: money.nullish(), scheduledAt: z.string().nullish(),
  }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.setStatus(req.params.id, r.data.status, { ...r.data, userId: req.user!.userId });
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res, 'Intervention introuvable'); return; }
    if (out.error === 'work_done_required') { bad(res, 'Indiquer le travail réalisé avant de terminer'); return; }
    res.status(409).json({ success: false, error: { message: `Passage de « ${out.from} » à « ${r.data.status} » impossible` } });
    return;
  }
  ok(res, out.data);
}));

maintenanceRouter.post('/:id/comments', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ note: text(2000).min(1) }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const data = await repo.comment(req.params.id, r.data.note, req.user!.userId);
  if (!data) { notFound(res, 'Intervention introuvable'); return; }
  ok(res, data);
}));
