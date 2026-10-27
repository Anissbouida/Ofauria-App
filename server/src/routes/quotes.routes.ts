import { Router, type Response } from 'express';
import { z } from 'zod';
import { ROLE_GROUPS } from '@ofauria/shared';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { db } from '../config/database.js';
import { quoteRepository } from '../repositories/quote.repository.js';
import { getParameter } from '../services/module-parameters.service.js';
import { generateInvoicePdf } from '../services/invoice-pdf.service.js';
import { loadCompanyLegal } from '../utils/company-legal.js';

/**
 * Devis clients et proforma (mig 365). Réservés à la direction, comme les commandes de
 * professionnels (mig 354).
 */
export const quotesRouter = Router();
const DIRECTION = ROLE_GROUPS.ADMIN_MANAGER;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const line = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(10_000_000).nullish(),
  tvaRate: z.coerce.number().min(0).max(100).nullish(),
  description: z.string().trim().max(300).nullish(),
});
const body = z.object({
  customerId: z.string().uuid().nullish(),
  prospectName: z.string().trim().max(160).nullish(),
  prospectCompany: z.string().trim().max(200).nullish(),
  prospectPhone: z.string().trim().max(30).nullish(),
  prospectEmail: z.string().trim().email().max(255).nullish().or(z.literal('')),
  title: z.string().trim().max(200).nullish(),
  quoteDate: isoDate.optional(),
  validUntil: isoDate.optional(),
  withTax: z.boolean().optional(),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  deliveryTerms: z.string().trim().max(300).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  internalNotes: z.string().trim().max(2000).nullish(),
  items: z.array(line).min(1, 'Ajoutez au moins un article').max(200),
  opportunityId: z.string().uuid().nullish(),
}).refine(b => b.customerId || b.prospectName || b.prospectCompany, { message: 'Choisissez un client ou saisissez le nom du prospect' });

function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }
async function validityDays() {
  const p = await getParameter<{ validity_days?: number }>('sales.quotes');
  return Math.max(1, Number(p?.validity_days) || 30);
}

quotesRouter.get('/', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({
    status: z.string().max(20).optional(), search: z.string().max(100).optional(), customerId: z.string().uuid().optional(),
    dateFrom: isoDate.optional(), dateTo: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const r = await quoteRepository.list({ ...q.data, storeId: req.user!.storeId ?? undefined, limit: q.data.limit, offset: (q.data.page - 1) * q.data.limit });
  res.json({ success: true, data: r.rows, total: r.total });
}));

quotesRouter.get('/overview', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { ...(await quoteRepository.overview(req.user!.storeId ?? undefined)), validityDays: await validityDays() } });
}));

quotesRouter.get('/:id', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = await quoteRepository.findById(req.params.id);
  if (!q) { bad(res, 'Devis introuvable', 404); return; }
  res.json({ success: true, data: q });
}));

quotesRouter.post('/', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = body.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await quoteRepository.create(b.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null, validityDays: await validityDays() });
  if ('error' in r) { bad(res, r.error); return; }
  res.status(201).json({ success: true, data: r.data });
}));

quotesRouter.put('/:id', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = body.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await quoteRepository.update(req.params.id, b.data, req.user!.userId);
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Devis introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

quotesRouter.post('/:id/duplicate', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await quoteRepository.duplicate(req.params.id, { userId: req.user!.userId, storeId: req.user!.storeId ?? null, validityDays: await validityDays() });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Devis introuvable', 404) : bad(res, r.error); return; }
  res.status(201).json({ success: true, data: r.data });
}));

quotesRouter.post('/:id/convert', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ pickupDate: z.string().min(10).max(30), customerId: z.string().uuid().nullish() }).safeParse(req.body);
  if (!b.success) { bad(res, 'Indiquez la date de livraison ou de retrait'); return; }
  const r = await quoteRepository.convert(req.params.id, { ...b.data, userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Devis introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data, order: r.order, creditWarning: r.creditWarning });
}));

quotesRouter.post('/:id/:action(send|accept|refuse|reopen|cancel)', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ reasonCode: z.string().max(40).nullish(), note: z.string().max(1000).nullish() }).safeParse(req.body ?? {});
  if (!b.success) { bad(res); return; }
  const r = await quoteRepository.transition(req.params.id, req.params.action as 'send', { userId: req.user!.userId, ...b.data });
  if ('error' in r) { r.error === 'not_found' ? bad(res, 'Devis introuvable', 404) : bad(res, r.error, 409); return; }
  res.json({ success: true, data: r.data });
}));

/** PDF du devis ou de la proforma (numéro PF attribué à la première édition). */
quotesRouter.get('/:id/pdf', authenticate, authorize(...DIRECTION), asyncHandler(async (req: AuthRequest, res: Response) => {
  const kind = req.query.kind === 'proforma' ? 'proforma' : 'quote';
  const q = await quoteRepository.findById(req.params.id);
  if (!q) { bad(res, 'Devis introuvable', 404); return; }
  const number = kind === 'proforma' ? await quoteRepository.ensureProformaNumber(q.id) : q.number;
  const fr = (d: unknown) => (d ? new Date(d instanceof Date ? d : `${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '');
  const legal = await loadCompanyLegal();
  const settings = (await db.query(`SELECT logo_url FROM company_settings LIMIT 1`)).rows[0];
  const items = q.items as Record<string, any>[];
  const ratio = Number(q.subtotal) > 0 ? 1 - Number(q.discount_amount) / Number(q.subtotal) : 1;
  const tva = new Map<number, number>();
  if (q.with_tax) for (const it of items) if (it.tva_rate != null) {
    const rate = Number(it.tva_rate);
    tva.set(rate, (tva.get(rate) ?? 0) + Math.round(Number(it.subtotal) * ratio * rate) / 100);
  }
  const breakdown = [...tva.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount: Math.round(amount * 100) / 100 }));
  const pct = Number(q.discount_pct);
  const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
  const buffer = await generateInvoicePdf({
    kind,
    invoiceNumber: number!,
    invoiceDate: fr(q.quote_date),
    dueDate: fr(q.valid_until),
    paymentMethod: q.customer_type && q.customer_type !== 'particulier' ? 'Sur facture' : '',
    customerName: q.client_label ?? '',
    customerAddress: q.customer_id ? [q.customer_address, q.customer_city].filter(Boolean).join(', ') || undefined : undefined,
    customerPhone: q.customer_phone ?? q.prospect_phone ?? undefined,
    customerEmail: q.customer_email ?? q.prospect_email ?? undefined,
    customerICE: q.customer_ice ?? undefined,
    items: items.map(it => ({
      description: it.description ? `${it.product_name} — ${it.description}` : it.product_name,
      quantity: Number(it.quantity), unit_price: Number(it.unit_price), subtotal: Number(it.subtotal),
    })),
    totalHT: Number(q.subtotal),
    discountLabel: pct > 0 ? `${pct} % (-${n2(Number(q.discount_amount))} DH)` : '0 %',
    tvaRate: q.with_tax ? (breakdown.length === 1 ? breakdown[0].rate : 0) : 0,
    totalTVA: Number(q.tax_amount),
    totalTTC: Number(q.total),
    tvaBreakdown: breakdown,
    pricesInclTax: !q.with_tax,
    extraNotes: [q.delivery_terms && `Livraison : ${q.delivery_terms}`, q.notes].filter(Boolean).join('\n') || undefined,
    companyName: legal.name, companyAddress: legal.address, companyPhone: legal.phone, companyEmail: legal.email,
    companyRC: legal.rc, companyPatente: legal.patente, companyIF: legal.if, companyICE: legal.ice,
    logoPath: settings?.logo_url?.startsWith('data:') ? settings.logo_url : undefined,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${String(number).replace(/[/\\]/g, '-')}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));
