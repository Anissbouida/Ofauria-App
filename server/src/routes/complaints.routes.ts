import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { complaintRepository as repo } from '../repositories/complaint.repository.js';

/**
 * SAV : réclamations clients (mig 357).
 * Saisie : tout le personnel en contact avec le client (caisse, vente, chefs, gérant).
 * Suivi, affectation, résolution : admin et gérant.
 */
export const complaintsRouter = Router();

const ENTRY = [authenticate, authorize(...ROLE_GROUPS.STORE_STAFF, ...ROLE_GROUPS.CHEFS)];
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const status = z.enum(['open', 'in_progress', 'resolved', 'closed', 'rejected']);
const priority = z.enum(['low', 'normal', 'high', 'critical']);
const channel = z.enum(['counter', 'phone', 'email', 'social', 'other']);
const resolutionCode = z.enum(['refund', 'replacement', 'voucher', 'discount', 'apology', 'none', 'not_founded']);

const complaintFields = z.object({
  customerId: uuid.nullish(),
  customerName: text(160).nullish(),
  customerPhone: text(40).nullish(),
  channel: channel.optional(),
  categoryCode: z.string().trim().min(1).max(60),
  priority: priority.optional(),
  subject: text(200).min(1),
  description: text(4000).nullish(),
  productId: uuid.nullish(),
  productLotId: uuid.nullish(),
  saleId: uuid.nullish(),
  orderId: uuid.nullish(),
  invoiceId: uuid.nullish(),
  quantity: z.coerce.number().positive().nullish(),
  photoUrl: text(500).nullish(),
  assignedTo: uuid.nullish(),
});
const complaintBody = complaintFields.refine(b => b.customerId || (b.customerName && b.customerName.length > 0), { message: 'Client requis (fiche ou nom)' });

// Un utilisateur rattaché à un magasin ne voit que le sien ; l'admin global voit tout.
const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);

function bad(res: Response, message = 'Paramètres invalides') {
  res.status(400).json({ success: false, error: { message } });
}
function notFound(res: Response) {
  res.status(404).json({ success: false, error: { message: 'Réclamation introuvable' } });
}

complaintsRouter.post('/', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = complaintBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  res.status(201).json({ success: true, data });
}));

const listQuery = z.object({
  status: status.optional(),
  priority: priority.optional(),
  categoryCode: z.string().trim().max(60).optional(),
  assignedTo: uuid.optional(),
  overdueOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(100).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
complaintsRouter.get('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = listQuery.safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, search, ...f } = r.data;
  const data = await repo.list({ ...f, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ success: true, data: { ...data, page, pageSize } });
}));

complaintsRouter.get('/indicators', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  res.json({ success: true, data: await repo.indicators({ ...r.data, storeId: storeOf(req) }) });
}));

// Lots d'un article, pour rattacher une réclamation (saisie : tout le personnel).
complaintsRouter.get('/lookup/lots', ...ENTRY, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ productId: uuid, saleId: uuid.optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  res.json({ success: true, data: await repo.lotsForProduct(r.data.productId, r.data.saleId) });
}));

complaintsRouter.get('/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.findById(req.params.id);
  if (!data) { notFound(res); return; }
  res.json({ success: true, data });
}));

complaintsRouter.patch('/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = complaintFields.partial().safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.update(req.params.id, r.data, req.user!.userId);
  if (!data) { notFound(res); return; }
  res.json({ success: true, data });
}));

complaintsRouter.post('/:id/status', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({
    status, note: text(2000).nullish(), resolutionCode: resolutionCode.nullish(),
    resolution: text(4000).nullish(), resolutionAmount: z.coerce.number().min(0).nullish(),
  }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.setStatus(req.params.id, r.data.status, { ...r.data, userId: req.user!.userId });
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res); return; }
    if (out.error === 'resolution_required') { bad(res, 'Choisir une résolution (remboursement, remplacement, geste…) avant de résoudre'); return; }
    res.status(409).json({ success: false, error: { message: `Passage de « ${out.from} » à « ${r.data.status} » impossible` } });
    return;
  }
  res.json({ success: true, data: out.data });
}));

complaintsRouter.post('/:id/assign', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ assignedTo: uuid.nullable() }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const data = await repo.assign(req.params.id, r.data.assignedTo, req.user!.userId);
  if (!data) { notFound(res); return; }
  res.json({ success: true, data });
}));

complaintsRouter.post('/:id/priority', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ priority }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const data = await repo.setPriority(req.params.id, r.data.priority, req.user!.userId);
  if (!data) { notFound(res); return; }
  res.json({ success: true, data });
}));

complaintsRouter.post('/:id/comments', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ note: text(2000).min(1) }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const data = await repo.comment(req.params.id, r.data.note, req.user!.userId);
  if (!data) { notFound(res); return; }
  res.json({ success: true, data });
}));
