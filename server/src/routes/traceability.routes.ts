import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { traceabilityRepository as repo } from '../repositories/traceability.repository.js';

/**
 * Traçabilité aval / amont et rappel produit (mig 316). Admin et gérant :
 * un rappel bloque des lots dans tous les magasins concernés.
 */
export const traceabilityRouter = Router();

const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
const uuid = z.string().uuid();
const storeOf = (req: AuthRequest) => req.user!.storeId ?? null;

function bad(res: Response, message = 'Paramètres invalides') {
  res.status(400).json({ success: false, error: { message } });
}
function notFound(res: Response, message = 'Introuvable') {
  res.status(404).json({ success: false, error: { message } });
}

traceabilityRouter.get('/search', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) return bad(res, 'Saisissez au moins 2 caractères');
  res.json({ success: true, data: await repo.search(q) });
}));

traceabilityRouter.get('/ingredient-lot/:id/forward', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  const data = await repo.forward(req.params.id);
  if (!data) return notFound(res, 'Lot introuvable');
  res.json({ success: true, data });
}));

traceabilityRouter.get('/product-lot/:id/backward', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  const data = await repo.backward(req.params.id);
  if (!data) return notFound(res, 'Lot introuvable');
  res.json({ success: true, data });
}));

traceabilityRouter.get('/product-lot/:id/sales', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  res.json({ success: true, data: await repo.lotSales(req.params.id) });
}));

// ─── Rappels ────────────────────────────────────────────────────────────
traceabilityRouter.get('/recalls', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await repo.listRecalls(storeOf(req)) });
}));

traceabilityRouter.post('/recalls', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    originKind: z.enum(['ingredient_lot', 'product_lot']),
    originId: uuid,
    reason: z.string().trim().min(3).max(1000),
  }).safeParse(req.body);
  if (!r.success) return bad(res, 'Indiquez le lot et le motif du rappel');
  const data = await repo.createRecall({ ...r.data, storeId: storeOf(req), userId: req.user!.userId });
  if (!data) return notFound(res, 'Lot introuvable');
  res.status(201).json({ success: true, data });
}));

traceabilityRouter.get('/recalls/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  const data = await repo.getRecall(req.params.id);
  if (!data) return notFound(res, 'Rappel introuvable');
  res.json({ success: true, data });
}));

traceabilityRouter.post('/recalls/:id/block', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res);
  const data = await repo.blockRecall(req.params.id, req.user!.userId);
  if (!data) return notFound(res, 'Rappel introuvable');
  res.json({ success: true, data });
}));

traceabilityRouter.put('/recalls/:id/items/:itemId', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    disposition: z.enum(['detruit', 'retourne_fournisseur', 'libere', 'deja_consomme']).nullable(),
    note: z.string().trim().max(500).nullish(),
  }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.itemId).success || !r.success) return bad(res);
  const data = await repo.setDisposition(req.params.id, req.params.itemId, r.data.disposition, r.data.note ?? null);
  if (!data) return notFound(res, 'Lot introuvable ou rappel clôturé');
  res.json({ success: true, data });
}));

traceabilityRouter.post('/recalls/:id/close', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ note: z.string().trim().min(3).max(2000) }).safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !r.success) return bad(res, 'Rédigez une conclusion');
  const data = await repo.closeRecall(req.params.id, r.data.note, req.user!.userId);
  if (!data) return notFound(res, 'Rappel introuvable ou pas encore bloqué');
  res.json({ success: true, data });
}));
