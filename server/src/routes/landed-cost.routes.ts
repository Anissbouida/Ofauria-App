import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { landedCostRepository as repo } from '../repositories/landed-cost.repository.js';

/** Frais d'approche (mig 361). Admin et gérant, comme les réceptions. */
export const landedCostRouter = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const method = z.enum(['value', 'quantity']);
const body = z.object({
  receptionVoucherId: uuid,
  method: method.default('value'),
  notes: text(2000).nullish(),
  charges: z.array(z.object({
    label: text(200).min(1), amount: z.coerce.number().finite().refine(v => v !== 0, 'Montant requis'),
    categoryId: uuid.nullish(), supplierId: uuid.nullish(), invoiceId: uuid.nullish(),
  })).min(1).max(50),
});

const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }
function notFound(res: Response) { res.status(404).json({ success: false, error: { message: 'Bon de frais introuvable' } }); }
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

landedCostRouter.get('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ status: z.enum(['draft', 'applied', 'cancelled']).optional(), search: text(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, search, status } = r.data;
  ok(res, { ...(await repo.list({ status, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize })), page, pageSize });
}));

landedCostRouter.get('/receptions', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ search: text(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.receptions({ ...r.data, search: r.data.search || undefined, storeId: storeOf(req) }));
}));

landedCostRouter.get('/preview', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ receptionVoucherId: uuid, total: z.coerce.number().finite().default(0), method: method.default('value') }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  ok(res, await repo.preview(r.data.receptionVoucherId, r.data.total, r.data.method));
}));

landedCostRouter.post('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = body.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  if ('error' in out) {
    bad(res, out.error === 'no_lines' ? 'Cette réception n\'a aucune ligne d\'article à charger' : 'Base de répartition nulle (valeur ou quantité à zéro)');
    return;
  }
  res.status(201).json({ success: true, data: out.data });
}));

landedCostRouter.get('/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.findById(req.params.id);
  if (!data) { notFound(res); return; }
  ok(res, data);
}));

landedCostRouter.post('/:id/apply', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const out = await repo.apply(req.params.id, req.user!.userId);
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res); return; }
    res.status(409).json({ success: false, error: { message: `Bon déjà ${out.status === 'applied' ? 'appliqué' : 'annulé'}` } });
    return;
  }
  ok(res, out.data);
}));

landedCostRouter.post('/:id/cancel', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.cancel(req.params.id);
  if (!data) { res.status(409).json({ success: false, error: { message: 'Seul un brouillon peut être annulé' } }); return; }
  ok(res, data);
}));
