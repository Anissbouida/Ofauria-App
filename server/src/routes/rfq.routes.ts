import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { rfqRepository as repo } from '../repositories/rfq.repository.js';

/** Appels d'offres fournisseurs (mig 360). Admin et gérant, comme les bons de commande. */
export const rfqRouter = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const rfqStatus = z.enum(['draft', 'sent', 'quoted', 'awarded', 'cancelled', 'closed']);
const item = z.object({
  lineType: z.enum(['ingredient', 'consumable', 'service', 'asset']).optional(),
  ingredientId: uuid.nullish(), packagingId: uuid.nullish(), description: text(500).nullish(), categoryId: uuid.nullish(),
  unit: text(20).nullish(), quantity: z.coerce.number().positive().max(1_000_000),
}).refine(i => i.ingredientId || i.packagingId || i.description?.trim(), { message: 'Article ou désignation requis' });
const rfqBody = z.object({
  title: text(200).min(1), neededBy: isoDate.nullish(), responseDeadline: isoDate.nullish(), notes: text(4000).nullish(),
  items: z.array(item).min(1).max(200), supplierIds: z.array(uuid).max(50),
});
const quotationBody = z.object({
  supplierId: uuid, quotationRef: text(80).nullish(), receivedAt: isoDate.optional(), validUntil: isoDate.nullish(),
  deliveryDays: z.coerce.number().int().min(0).max(3650).nullish(), paymentTerms: text(200).nullish(),
  shippingCost: z.coerce.number().min(0).optional(), discountPct: z.coerce.number().min(0).max(100).optional(), notes: text(4000).nullish(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(), exchangeRate: z.coerce.number().positive().max(100_000).optional(),
  items: z.array(z.object({
    rfqItemId: uuid, available: z.boolean().optional(), unitPrice: z.coerce.number().min(0).nullish(),
    quantity: z.coerce.number().positive().nullish(), note: text(300).nullish(),
  })).max(200),
});

const storeOf = (req: AuthRequest) => (req.user!.role === 'admin' ? undefined : req.user!.storeId);
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }
function notFound(res: Response, message = 'Appel d\'offres introuvable') { res.status(404).json({ success: false, error: { message } }); }
const ok = (res: Response, data: unknown) => res.json({ success: true, data });
function conflict(res: Response, from: string | undefined) { res.status(409).json({ success: false, error: { message: `Action impossible au statut « ${from} »` } }); }

rfqRouter.get('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ status: rfqStatus.optional(), search: text(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  const { page, pageSize, search, status } = r.data;
  ok(res, { ...(await repo.list({ status, search: search || undefined, storeId: storeOf(req), limit: pageSize, offset: (page - 1) * pageSize })), page, pageSize });
}));

rfqRouter.post('/', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = rfqBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await repo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null }) });
}));

rfqRouter.get('/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const data = await repo.findById(req.params.id);
  if (!data) { notFound(res); return; }
  ok(res, data);
}));

rfqRouter.patch('/:id', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = rfqBody.partial().safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const data = await repo.update(req.params.id, r.data, req.user!.userId);
  if (!data) { notFound(res); return; }
  ok(res, data);
}));

rfqRouter.post('/:id/send', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const out = await repo.send(req.params.id, req.user?.userId ?? null);
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res); return; }
    if (out.error === 'incomplete') { bad(res, 'Ajouter au moins un article et un fournisseur avant d\'envoyer'); return; }
    conflict(res, out.from); return;
  }
  ok(res, { ...out.data, emailsQueued: out.emailed });
}));

rfqRouter.post('/:id/status', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ status: z.enum(['cancelled', 'closed', 'draft']) }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.setStatus(req.params.id, r.data.status);
  if ('error' in out) { if (out.error === 'not_found') { notFound(res); return; } conflict(res, out.from); return; }
  ok(res, out.data);
}));

rfqRouter.post('/:id/suppliers/:supplierId/status', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.supplierId).success) { bad(res); return; }
  const r = z.object({ status: z.enum(['invited', 'declined', 'no_response']), note: text(500).nullish() }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const data = await repo.setSupplierStatus(req.params.id, req.params.supplierId, r.data.status, r.data.note);
  if (!data) { notFound(res); return; }
  ok(res, data);
}));

rfqRouter.put('/:id/quotations', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = quotationBody.safeParse(req.body);
  if (!r.success) { bad(res, r.error.issues[0]?.message); return; }
  const out = await repo.saveQuotation(req.params.id, r.data, req.user!.userId);
  if ('error' in out) { if (out.error === 'not_found') { notFound(res); return; } conflict(res, out.from); return; }
  ok(res, out.data);
}));

rfqRouter.post('/:id/award', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!uuid.safeParse(req.params.id).success) { bad(res); return; }
  const r = z.object({ quotationId: uuid, expectedDeliveryDate: isoDate.nullish(), notes: text(2000).nullish() }).safeParse(req.body);
  if (!r.success) { bad(res); return; }
  const out = await repo.award(req.params.id, r.data.quotationId, { ...r.data, userId: req.user!.userId, storeId: req.user!.storeId });
  if ('error' in out) {
    if (out.error === 'not_found') { notFound(res); return; }
    if (out.error === 'quotation') { bad(res, 'Devis introuvable sur cet appel d\'offres'); return; }
    if (out.error === 'empty') { bad(res, 'Ce devis ne propose aucune ligne avec prix'); return; }
    conflict(res, out.from); return;
  }
  res.status(201).json({ success: true, data: out.data, purchaseOrder: out.purchaseOrder });
}));
