import { Router, type Response } from 'express';
import { z } from 'zod';
import { ROLE_GROUPS } from '@ofauria/shared';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { db } from '../config/database.js';
import { dunningRepository, dunningSettings } from '../repositories/dunning.repository.js';
import { generateDunningPdf } from '../services/dunning-pdf.service.js';

/**
 * Relances clients et blocage de crédit (mig 366). Direction uniquement : c'est elle qui
 * règle les créances des professionnels (mig 354) et décide d'un blocage.
 */
export const dunningRouter = Router();
const DIRECTION = ROLE_GROUPS.ADMIN_MANAGER;
function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

dunningRouter.get('/overview', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [proposals, settings, drafts, blocked] = await Promise.all([
    dunningRepository.proposals(req.user!.storeId ?? undefined),
    dunningSettings(),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_due), 0)::numeric(14,2) AS amount FROM dunnings WHERE status = 'draft'`),
    dunningRepository.blocked(),
  ]);
  res.json({ success: true, data: {
    settings,
    proposals: proposals.map(p => ({ ...p, docs: p.docs.map(d => ({ kind: d.kind, number: d.number, due_date: d.due_date, days_late: d.days_late, remaining: d.remaining })) })),
    drafts: { count: drafts.rows[0].n, amount: Number(drafts.rows[0].amount) },
    blocked,
  } });
}));

dunningRouter.get('/levels', authenticate, authorize(...DIRECTION), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await dunningRepository.allLevels() });
}));

dunningRouter.put('/levels/:level', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const level = Number(req.params.level);
  const b = z.object({
    label: z.string().trim().min(2).max(80).optional(), daysAfterDue: z.coerce.number().int().min(0).max(3650).optional(),
    feeAmount: z.coerce.number().min(0).max(100_000).optional(), interestRate: z.coerce.number().min(0).max(100).optional(),
    subject: z.string().trim().min(2).max(200).optional(), body: z.string().trim().min(10).max(4000).optional(),
    sendEmail: z.boolean().optional(), creditHold: z.boolean().optional(), isActive: z.boolean().optional(),
  }).safeParse(req.body);
  if (!Number.isInteger(level) || level < 1 || level > 9 || !b.success) { bad(res, b.success ? 'Niveau entre 1 et 9' : b.error.issues[0]?.message); return; }
  res.json({ success: true, data: await dunningRepository.saveLevel(level, b.data, req.user!.userId) });
}));

dunningRouter.get('/', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({ status: z.enum(['draft', 'sent', 'resolved', 'cancelled']).optional(), customerId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const r = await dunningRepository.list({ ...q.data, offset: (q.data.page - 1) * q.data.limit });
  res.json({ success: true, data: r.rows, total: r.total });
}));

/** Crée les lettres proposées (un client, ou tous). */
dunningRouter.post('/create', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ customerIds: z.array(z.string().uuid()).min(1).max(500), level: z.coerce.number().int().min(1).max(9).optional() }).safeParse(req.body);
  if (!b.success) { bad(res); return; }
  const created = []; const errors = [];
  for (const id of b.data.customerIds) {
    const r = await dunningRepository.create(id, { userId: req.user!.userId, level: b.data.level });
    if ('data' in r) created.push(r.data); else errors.push({ customerId: id, error: r.error });
  }
  res.status(201).json({ success: true, data: created, errors });
}));

dunningRouter.get('/:id', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await dunningRepository.findById(req.params.id);
  if (!d) { bad(res, 'Relance introuvable', 404); return; }
  res.json({ success: true, data: d });
}));

dunningRouter.post('/:id/send', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ via: z.enum(['email', 'print', 'phone', 'other']), emailTo: z.string().trim().email().nullish() }).safeParse(req.body);
  if (!b.success) { bad(res); return; }
  const r = await dunningRepository.send(req.params.id, { ...b.data, userId: req.user!.userId });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Relance introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

dunningRouter.post('/:id/cancel', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await dunningRepository.cancel(req.params.id);
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

dunningRouter.get('/:id/pdf', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await dunningRepository.findById(req.params.id);
  if (!d) { bad(res, 'Relance introuvable', 404); return; }
  const logo = (await db.query(`SELECT logo_url FROM company_settings LIMIT 1`)).rows[0]?.logo_url ?? null;
  const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const buf = await generateDunningPdf({
    number: d.number, date: day(d.dunning_date)!, levelLabel: d.level_label, subject: d.subject, body: d.body,
    customerName: d.customer_name, customerAddress: [d.customer_address, d.customer_city].filter(Boolean).join(', ') || null, customerIce: d.customer_ice,
    items: d.items.map((i: Record<string, any>) => ({ number: i.doc_number, kind: i.doc_kind, docDate: day(i.doc_date), dueDate: day(i.due_date)!, daysLate: i.days_late, remaining: Number(i.remaining) })),
    amountDue: Number(d.amount_due), fee: Number(d.fee_amount), interest: Number(d.interest_amount), logo,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${d.number}.pdf"`);
  res.send(buf);
}));

/* ─── Blocage et pause ────────────────────────────────────────────────────── */
dunningRouter.post('/customers/:customerId/hold', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body);
  if (!b.success) { bad(res, 'Indiquez le motif du blocage'); return; }
  await dunningRepository.hold(req.params.customerId, { reason: b.data.reason, userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  res.json({ success: true });
}));
dunningRouter.post('/customers/:customerId/release', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  await dunningRepository.release(req.params.customerId);
  res.json({ success: true });
}));
dunningRouter.post('/customers/:customerId/pause', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ until: isoDate.nullable() }).safeParse(req.body);
  if (!b.success) { bad(res); return; }
  await dunningRepository.pause(req.params.customerId, b.data.until);
  res.json({ success: true });
}));
