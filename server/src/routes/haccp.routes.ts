import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { haccpRepository as repo } from '../repositories/haccp.repository.js';

/**
 * Plan de maîtrise sanitaire (mig 315).
 * Saisie (relevés, nettoyage, actions) : chefs + gérant (PRODUCTION).
 * Validation, registres, configuration, contrôle à réception : admin et gérant.
 */
export const haccpRouter = Router();

const ENTRY = [authenticate, authorize(...ROLE_GROUPS.PRODUCTION)];
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const range = z.object({ from: isoDate, to: isoDate });

// Magasin de l'utilisateur ; l'admin global (sans magasin) voit et saisit en commun.
const storeOf = (req: AuthRequest) => req.user!.storeId ?? null;

function bad(res: Response, message = 'Paramètres invalides') {
  res.status(400).json({ success: false, error: { message } });
}
function notFound(res: Response, message = 'Introuvable') {
  res.status(404).json({ success: false, error: { message } });
}

// ─── Feuille du jour ────────────────────────────────────────────────────
haccpRouter.get('/today', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.today(storeOf(req)) });
}));

// ─── Relevés de température ─────────────────────────────────────────────
haccpRouter.post('/readings', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    equipmentId: uuid,
    value: z.number().min(-60).max(60),
    note: text(500).nullish(),
    actionTaken: text(1000).nullish(),
  }).safeParse(req.body);
  if (!r.success) return bad(res, 'Température invalide');
  const data = await repo.addReading({ ...r.data, storeId: storeOf(req), userId: req.user!.userId });
  res.status(201).json({ success: true, data });
}));

haccpRouter.get('/readings', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = range.extend({ equipmentId: uuid.optional(), outOfRange: z.enum(['true', 'false']).optional() }).safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.readingsRegister({ ...r.data, outOfRangeOnly: r.data.outOfRange === 'true', storeId: storeOf(req) }) });
}));

// ─── Nettoyage ──────────────────────────────────────────────────────────
haccpRouter.post('/cleaning-logs', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    taskId: uuid,
    conforme: z.boolean(),
    note: text(500).nullish(),
    actionTaken: text(1000).nullish(),
  }).safeParse(req.body);
  if (!r.success) return bad(res);
  if (!r.data.conforme && !r.data.note?.trim()) return bad(res, 'Décrivez ce qui n\'est pas conforme');
  const data = await repo.logCleaning({ ...r.data, storeId: storeOf(req), userId: req.user!.userId });
  res.status(201).json({ success: true, data });
}));

haccpRouter.get('/cleaning-logs', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = range.safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.cleaningRegister({ ...r.data, storeId: storeOf(req) }) });
}));

// ─── Actions correctives ────────────────────────────────────────────────
haccpRouter.get('/actions', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    status: z.string().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }).safeParse(req.query);
  if (!r.success) return bad(res);
  const statuses = r.data.status?.split(',').filter(s => ['open', 'done', 'validated'].includes(s)) as ('open' | 'done' | 'validated')[] | undefined;
  res.json({ success: true, data: await repo.listActions({ storeId: storeOf(req), statuses: statuses?.length ? statuses : undefined, from: r.data.from, to: r.data.to }) });
}));

haccpRouter.post('/actions', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ problem: text(1000).min(3), actionTaken: text(1000).nullish() }).safeParse(req.body);
  if (!r.success) return bad(res, 'Décrivez le problème');
  const data = await repo.createAction({ ...r.data, storeId: storeOf(req), userId: req.user!.userId });
  res.status(201).json({ success: true, data });
}));

haccpRouter.post('/actions/:id/complete', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ actionTaken: text(1000).min(3) }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res, 'Décrivez l\'action réalisée');
  const data = await repo.completeAction(req.params.id, r.data.actionTaken, req.user!.userId);
  if (!data) return notFound(res, 'Action introuvable ou déjà validée');
  res.json({ success: true, data });
}));

haccpRouter.post('/actions/:id/validate', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ approve: z.boolean(), note: text(1000).nullish() }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res);
  if (!r.data.approve && !r.data.note?.trim()) return bad(res, 'Indiquez pourquoi l\'action est renvoyée');
  const data = await repo.validateAction(req.params.id, r.data.approve, r.data.note ?? null, req.user!.userId);
  if (!data) return notFound(res, 'Action introuvable ou pas en attente de validation');
  res.json({ success: true, data });
}));

// ─── Configuration ──────────────────────────────────────────────────────
haccpRouter.get('/equipment', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.listEquipment(storeOf(req)) });
}));

const equipmentSchema = z.object({
  nom: text(200).min(1),
  type: z.enum(['frigo', 'surgele', 'vitrine', 'autre']).default('frigo'),
  haccp_monitored: z.boolean(),
  temp_min: z.number().min(-60).max(60).nullable(),
  temp_max: z.number().min(-60).max(60).nullable(),
  readings_per_day: z.number().int().min(1).max(12).default(2),
}).refine(e => !e.haccp_monitored || (e.temp_min != null && e.temp_max != null && e.temp_min < e.temp_max),
  { message: 'Plage de température invalide (min < max)' });

async function saveEquipment(req: AuthRequest, res: Response, id?: string) {
  const r = equipmentSchema.safeParse(req.body);
  if (!r.success) return bad(res, r.error.issues[0]?.message);
  const data = await repo.saveEquipment({ ...r.data, id, storeId: storeOf(req) });
  if (!data) return notFound(res, 'Enceinte introuvable');
  res.json({ success: true, data });
}
haccpRouter.post('/equipment', ...AM, asyncHandler((req: AuthRequest, res: Response) => saveEquipment(req, res)));
haccpRouter.put('/equipment/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  await saveEquipment(req, res, req.params.id);
}));

haccpRouter.get('/tasks', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.listTasks(storeOf(req)) });
}));

const taskSchema = z.object({
  zone: text(100).min(1),
  label: text(200).min(1),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  method: text(1000).nullable().default(null),
  is_active: z.boolean().default(true),
  display_order: z.number().int().min(0).max(10000).default(0),
});
async function saveTask(req: AuthRequest, res: Response, id?: string) {
  const r = taskSchema.safeParse(req.body);
  if (!r.success) return bad(res, r.error.issues[0]?.message);
  const data = await repo.saveTask({ ...r.data, id });
  if (!data) return notFound(res, 'Tâche introuvable');
  res.json({ success: true, data });
}
haccpRouter.post('/tasks', ...AM, asyncHandler((req: AuthRequest, res: Response) => saveTask(req, res)));
haccpRouter.put('/tasks/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  await saveTask(req, res, req.params.id);
}));

// ─── Contrôle à réception ───────────────────────────────────────────────
haccpRouter.get('/receptions', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = range.safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.receptions({ ...r.data, storeId: storeOf(req) }) });
}));

haccpRouter.post('/receptions/:id/check', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const ok = z.boolean().nullish();
  const r = z.object({
    temperatureOk: ok, temperatureValue: z.number().min(-60).max(60).nullish(),
    visualOk: ok, packagingOk: ok, labelsOk: ok,
    overallConformity: z.boolean(),
    notes: text(1000).nullish(),
    actionTaken: text(1000).nullish(),
  }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res);
  const data = await repo.saveReceptionCheck({ ...r.data, receptionVoucherId: req.params.id, storeId: storeOf(req), userId: req.user!.userId });
  res.json({ success: true, data });
}));

// ─── Indicateurs ────────────────────────────────────────────────────────
haccpRouter.get('/indicators', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate.optional(), to: isoDate.optional() }).safeParse(req.query);
  if (!r.success) return bad(res);
  res.json({ success: true, data: await repo.indicators(storeOf(req), r.data.from, r.data.to) });
}));
