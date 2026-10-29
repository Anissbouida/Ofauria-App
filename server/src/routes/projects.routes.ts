import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { projectRepository as repo } from '../repositories/project.repository.js';

/**
 * Projets (mig 358) : projets, tâches, temps passé. Droit « Projets » (module
 * projects, mig 330) : voir / créer / modifier / supprimer, gérant par défaut.
 */
export const projectsRouter = Router();

const VIEW = [authenticate, authorizeModule('projects', 'view')];
const CREATE = [authenticate, authorizeModule('projects', 'create')];
const EDIT = [authenticate, authorizeModule('projects', 'edit')];
const DEL = [authenticate, authorizeModule('projects', 'delete')];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const priority = z.enum(['low', 'normal', 'high', 'critical']);
const projectStatus = z.enum(['draft', 'active', 'on_hold', 'completed', 'cancelled']);
const taskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
const money = z.coerce.number().min(0);

const projectBody = z.object({
  name: text(200).min(1),
  description: text(4000).nullish(),
  customerId: uuid.nullish(),
  orderId: uuid.nullish(),
  priority: priority.optional(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  managerId: uuid.nullish(),
  billingType: z.enum(['none', 'fixed', 'time']).optional(),
  hourlyRate: money.nullish(),
  budgetAmount: money.nullish(),
  estimatedHours: money.nullish(),
  notes: text(4000).nullish(),
});
const taskBody = z.object({
  title: text(200).min(1),
  description: text(4000).nullish(),
  parentTaskId: uuid.nullish(),
  priority: priority.optional(),
  assigneeId: uuid.nullish(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  estimatedHours: money.nullish(),
  displayOrder: z.coerce.number().int().optional(),
});
const timeBody = z.object({
  projectId: uuid,
  taskId: uuid.nullish(),
  employeeId: uuid,
  workDate: isoDate,
  hours: z.coerce.number().positive().max(24),
  activityCode: text(60).nullish(),
  note: text(1000).nullish(),
  billable: z.boolean().optional(),
  billingRate: money.nullish(),
});

// Un utilisateur rattaché à un magasin ne voit que le sien ; l'admin global voit tout.
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }
function notFound(res: Response, message = 'Introuvable') { res.status(404).json({ success: false, error: { message } }); }
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/* ─── Projets ─────────────────────────────────────────────────────────────── */
const listQuery = z.object({
  status: projectStatus.optional(), customerId: uuid.optional(), managerId: uuid.optional(),
  search: text(100).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
projectsRouter.get('/', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = listQuery.safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.list({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize });
  ok(res, { ...data, page, pageSize });
}));

projectsRouter.get('/overview', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.overview({ ...r.data, storeId: storeOf(req) }));
}));

projectsRouter.get('/people', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  ok(res, await repo.people(storeOf(req)));
}));

projectsRouter.get('/tasks/open', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ assigneeId: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.openTasks({ ...r.data, storeId: storeOf(req) }));
}));

projectsRouter.post('/', ...CREATE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = projectBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  res.status(201).json({ success: true, data });
}));

projectsRouter.get('/:id', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.findById(req.params.id);
  if (!data) { notFound(res, 'Projet introuvable'); return; }
  ok(res, { ...data, tasks: await repo.listTasks(req.params.id) });
}));

projectsRouter.patch('/:id', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = projectBody.partial().safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.update(req.params.id, r.data, req.user!.userId);
  if (!data) { notFound(res, 'Projet introuvable'); return; }
  ok(res, data);
}));

projectsRouter.post('/:id/status', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ status: projectStatus }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.setStatus(req.params.id, r.data.status);
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res, 'Projet introuvable'); return; }
    res.status(409).json({ success: false, error: { message: `Passage de « ${out.from} » à « ${r.data.status} » impossible` } });
    return;
  }
  ok(res, out.data);
}));

/* ─── Achats & charges rattachés (mig 390) ──────────────────────────────────── */
projectsRouter.get('/:id/invoices', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  ok(res, await repo.listInvoices(req.params.id));
}));

projectsRouter.get('/:id/invoices/linkable', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ search: text(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.linkableInvoices({ projectId: req.params.id, storeId: storeOf(req), search: r.data.search || undefined, limit: r.data.limit }));
}));

projectsRouter.post('/:id/invoices', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ invoiceId: uuid }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  if (!(await repo.findById(req.params.id))) { notFound(res, 'Projet introuvable'); return; }
  const out = await repo.linkInvoice(req.params.id, r.data.invoiceId);
  if (!out) { res.status(409).json({ success: false, error: { message: 'Facture introuvable ou déjà rattachée à un autre projet' } }); return; }
  ok(res, out);
}));

projectsRouter.delete('/:id/invoices/:invoiceId', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.invoiceId).success) { bad(res); return; }
  const out = await repo.unlinkInvoice(req.params.id, req.params.invoiceId);
  if (!out) { notFound(res, 'Facture non rattachée à ce projet'); return; }
  ok(res, out);
}));

/* ─── Tâches ──────────────────────────────────────────────────────────────── */
projectsRouter.post('/:id/tasks', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = taskBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  if (!(await repo.findById(req.params.id))) { notFound(res, 'Projet introuvable'); return; }
  res.status(201).json({ success: true, data: await repo.createTask(req.params.id, r.data, req.user!.userId) });
}));

projectsRouter.patch('/tasks/:taskId', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.taskId).success) { bad(res); return; }
  const r = taskBody.partial().extend({ status: taskStatus.optional() }).safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.updateTask(req.params.taskId, r.data, req.user!.userId);
  if (!data) { notFound(res, 'Tâche introuvable'); return; }
  ok(res, data);
}));

projectsRouter.delete('/tasks/:taskId', ...DEL, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.taskId).success) { bad(res); return; }
  const r = await repo.deleteTask(req.params.taskId);
  if (!r) { notFound(res, 'Tâche introuvable'); return; }
  ok(res, r);
}));

/* ─── Temps ───────────────────────────────────────────────────────────────── */
const timeQuery = z.object({
  projectId: uuid.optional(), employeeId: uuid.optional(), dateFrom: isoDate.optional(), dateTo: isoDate.optional(),
  unbilledOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
projectsRouter.get('/time/entries', ...VIEW, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = timeQuery.safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, ...f } = r.data;
  ok(res, { ...(await repo.listTime({ ...f, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize })), page, pageSize });
}));

projectsRouter.post('/time/entries', ...EDIT, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = timeBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.addTime(r.data, req.user!.userId);
  if (!data) { notFound(res, 'Salarié introuvable'); return; }
  res.status(201).json({ success: true, data });
}));

projectsRouter.delete('/time/entries/:id', ...DEL, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = await repo.deleteTime(req.params.id);
  if (!r) { notFound(res, 'Ligne introuvable ou déjà facturée'); return; }
  ok(res, r);
}));
