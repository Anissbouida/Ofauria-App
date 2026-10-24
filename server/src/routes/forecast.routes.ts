import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { forecastRepository as repo } from '../repositories/forecast.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Prévision de la demande (mig 314).
 * Lecture : production (chefs) + gérant ; saisie manuelle, calendrier et
 * correspondances : admin et gérant.
 */
export const forecastRouter = Router();

const READ = [authenticate, authorize(...ROLE_GROUPS.PRODUCTION)];
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const MAX_RANGE_DAYS = 31;

function bad(res: Response, message = 'Paramètres invalides') {
  res.status(400).json({ success: false, error: { message } });
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Magasin de travail ; répond 400 et renvoie null si l'admin doit en choisir un. */
async function storeOr400(req: AuthRequest, res: Response): Promise<string | null> {
  const requested = typeof req.query.storeId === 'string' && uuid.safeParse(req.query.storeId).success
    ? req.query.storeId : (typeof req.body?.storeId === 'string' ? req.body.storeId : undefined);
  const storeId = await repo.resolveStore(req.user!.storeId, requested);
  if (!storeId) bad(res, 'Choisissez un magasin');
  return storeId;
}

forecastRouter.get('/stores', ...READ, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.listStores() });
}));

// Grille produit × jour (7 jours à partir de demain par défaut).
forecastRouter.get('/grid', ...READ, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate.optional(), to: isoDate.optional() }).safeParse(req.query);
  if (!r.success) return bad(res);
  const from = r.data.from ?? addDays(getLocalISODate(), 1);
  const to = r.data.to ?? addDays(from, 6);
  if (to < from || addDays(from, MAX_RANGE_DAYS) < to) return bad(res, `Période de 1 à ${MAX_RANGE_DAYS} jours`);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  res.json({ success: true, data: await repo.compute(storeId, from, to) });
}));

// Prévision d'une journée, à plat : utilisée par la modale de plan.
forecastRouter.get('/day', ...READ, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ date: isoDate }).safeParse(req.query);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  const grid = await repo.compute(storeId, r.data.date, r.data.date);
  const items = grid.rows.map(({ days, ...p }) => ({ ...p, forecast: days[r.data.date] }));
  res.json({ success: true, data: { store_id: storeId, date: r.data.date, items } });
}));

// Instantané au moment où la prévision guide une décision (création de plan).
forecastRouter.post('/snapshot', ...READ, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    date: isoDate,
    usedFor: z.enum(['plan', 'fiche', 'manual']),
    productIds: z.array(uuid).max(500),
  }).safeParse(req.body);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  const grid = await repo.compute(storeId, r.data.date, r.data.date, { productIds: r.data.productIds });
  const wanted = new Set(r.data.productIds);
  await repo.snapshot(storeId, r.data.date, r.data.usedFor, grid.rows
    .filter(p => wanted.has(p.product_id))
    .map(p => ({ product_id: p.product_id, result: p.days[r.data.date] })));
  res.json({ success: true });
}));

const overrideSchema = z.object({
  productId: uuid,
  date: isoDate,
  quantity: z.number().int().min(0).max(100000),
  reason: z.string().trim().max(300).nullish(),
});
forecastRouter.put('/override', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = overrideSchema.safeParse(req.body);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  const data = await repo.setOverride({ ...r.data, storeId, userId: req.user!.userId });
  res.json({ success: true, data });
}));

forecastRouter.delete('/override', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ productId: uuid, date: isoDate }).safeParse(req.query);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  await repo.deleteOverride(storeId, r.data.productId, r.data.date);
  res.json({ success: true });
}));

// ─── Calendrier ─────────────────────────────────────────────────────────
forecastRouter.get('/events', ...READ, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate.optional() }).safeParse(req.query);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  res.json({ success: true, data: await repo.listEvents(storeId, r.data.from) });
}));

const eventSchema = z.object({
  date_start: isoDate,
  date_end: isoDate,
  kind: z.enum(['ramadan', 'fete', 'vacances', 'evenement', 'fermeture']),
  label: z.string().trim().min(1).max(150),
  uplift_pct: z.number().min(-100).max(500),
  category_id: z.number().int().nullable().default(null),
  /** true = tous les magasins */
  all_stores: z.boolean().default(true),
}).refine(e => e.date_end >= e.date_start, { message: 'Date de fin avant la date de début' });

async function saveEvent(req: AuthRequest, res: Response, id?: string) {
  const r = eventSchema.safeParse(req.body);
  if (!r.success) return bad(res, r.error.issues[0]?.message);
  const storeId = r.data.all_stores ? null : await storeOr400(req, res);
  if (!r.data.all_stores && !storeId) return;
  const { all_stores: _all, ...data } = r.data;
  const saved = await repo.saveEvent({ ...data, id, storeId, userId: req.user!.userId });
  if (!saved) { res.status(404).json({ success: false, error: { message: 'Événement introuvable' } }); return; }
  res.json({ success: true, data: saved });
}

forecastRouter.post('/events', ...AM, asyncHandler((req: AuthRequest, res: Response) => saveEvent(req, res)));
forecastRouter.put('/events/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  await saveEvent(req, res, req.params.id);
}));
forecastRouter.delete('/events/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  await repo.deleteEvent(req.params.id);
  res.json({ success: true });
}));

// ─── Correspondance Loyverse → catalogue ────────────────────────────────
forecastRouter.get('/links/unmapped', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.unmappedKeys() });
}));

forecastRouter.put('/links/:productKey', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ productId: uuid.nullable() }).safeParse(req.body);
  const key = String(req.params.productKey || '').slice(0, 200);
  if (!r.success || !key) return bad(res);
  await repo.linkKey(key, r.data.productId, req.user!.userId);
  res.json({ success: true });
}));

// ─── Précision ──────────────────────────────────────────────────────────
forecastRouter.get('/accuracy', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ from: isoDate, to: isoDate }).safeParse(req.query);
  if (!r.success) return bad(res);
  const storeId = await storeOr400(req, res);
  if (!storeId) return;
  res.json({ success: true, data: await repo.accuracy(storeId, r.data.from, r.data.to) });
}));
