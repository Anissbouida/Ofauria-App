import { Router, type Response } from 'express';
import { z } from 'zod';
import { ROLE_GROUPS } from '@ofauria/shared';
import { db } from '../config/database.js';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { productRepository } from '../repositories/product.repository.js';
import { salesChannelRepository } from '../repositories/sales-channel.repository.js';
import { posLinePrice } from '../services/pos-pricing.js';
import { evaluate, promoLabel } from '../services/promotions.js';
import * as loyalty from '../services/loyalty.js';

/**
 * Promotions et fidélité (mig 372). Consultation et aperçu : toute personne qui vend ;
 * paramétrage : direction (admin, gérant).
 */
export const promotionsRouter = Router();
export const loyaltyRouter = Router();
const SELL = authorize(...ROLE_GROUPS.SALES);
const MANAGE = authorize(...ROLE_GROUPS.ADMIN_MANAGER);
function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }
const round2 = (n: number) => Math.round(n * 100) / 100;

const promoBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullish(),
  target: z.enum(['items', 'cart']),
  kind: z.enum(['percent', 'amount', 'fixed_price', 'buy_x_get_y']),
  value: z.coerce.number().min(0).max(1_000_000).default(0),
  buyQty: z.coerce.number().int().min(1).max(100).nullish(),
  getQty: z.coerce.number().int().min(1).max(100).nullish(),
  productIds: z.array(z.string().uuid()).max(500).default([]),
  categoryIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
  minQuantity: z.coerce.number().positive().max(1_000_000).nullish(),
  minAmount: z.coerce.number().positive().max(100_000_000).nullish(),
  couponCode: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/, 'Code promo : lettres, chiffres, - et _ seulement').nullish(),
  customerScope: z.enum(['all', 'identified', 'particulier', 'professionnel', 'tier']).default('all'),
  minTierCode: z.string().max(20).nullish(),
  onPos: z.boolean().default(true), onOrders: z.boolean().default(false), onQuotes: z.boolean().default(false),
  storeId: z.string().uuid().nullish(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).max(7).default([]),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  timeTo: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  maxUses: z.coerce.number().int().positive().nullish(),
  priority: z.coerce.number().int().min(-100).max(100).default(0),
  isActive: z.boolean().default(true),
}).superRefine((b, ctx) => {
  const say = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (b.target === 'cart' && !['percent', 'amount'].includes(b.kind)) say('Une promotion panier est un pourcentage ou un montant');
  if (b.kind === 'percent' && (b.value <= 0 || b.value > 100)) say('Le pourcentage est compris entre 0 et 100');
  if (b.kind === 'amount' && b.value <= 0) say('Indiquez le montant de la remise');
  if (b.kind === 'buy_x_get_y' && (!b.buyQty || !b.getQty)) say('Indiquez combien d\'articles achetés et combien offerts');
  if (b.customerScope === 'tier' && !b.minTierCode) say('Choisissez le niveau de fidélité minimum');
  if (!b.onPos && !b.onOrders && !b.onQuotes) say('Choisissez au moins un canal : caisse, commandes ou devis');
  if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) say('La date de fin précède la date de début');
  if ((b.timeFrom && !b.timeTo) || (!b.timeFrom && b.timeTo)) say('Indiquez l\'heure de début et l\'heure de fin');
});

const promoCols = (b: z.infer<typeof promoBody>) => [
  b.name, b.description || null, b.target, b.kind, b.kind === 'buy_x_get_y' ? 0 : b.value,
  b.kind === 'buy_x_get_y' ? b.buyQty : null, b.kind === 'buy_x_get_y' ? b.getQty : null,
  b.target === 'cart' ? [] : b.productIds, b.target === 'cart' ? [] : b.categoryIds,
  b.minQuantity ?? null, b.minAmount ?? null, b.couponCode?.toUpperCase() || null,
  b.customerScope, b.customerScope === 'tier' ? b.minTierCode : null,
  b.onPos, b.onOrders, b.onQuotes, b.storeId ?? null, b.startsOn ?? null, b.endsOn ?? null,
  b.daysOfWeek, b.timeFrom ?? null, b.timeTo ?? null, b.maxUses ?? null, b.priority, b.isActive,
];

const SELECT_PROMO = `
  SELECT p.*, s.name AS store_name, t.label AS min_tier_label,
         (SELECT COUNT(*)::int FROM document_promotions d WHERE d.promotion_id = p.id AND d.sale_id IS NOT NULL) AS sales_count,
         (SELECT COALESCE(SUM(d.amount), 0)::numeric(14,2) FROM document_promotions d WHERE d.promotion_id = p.id AND d.quote_id IS NULL) AS granted_amount,
         CASE WHEN NOT p.is_active THEN 'inactive'
              WHEN p.ends_on IS NOT NULL AND p.ends_on < CURRENT_DATE THEN 'ended'
              WHEN p.starts_on IS NOT NULL AND p.starts_on > CURRENT_DATE THEN 'scheduled'
              WHEN p.max_uses IS NOT NULL AND p.uses_count >= p.max_uses THEN 'exhausted'
              ELSE 'running' END AS state
    FROM promotions p LEFT JOIN stores s ON s.id = p.store_id LEFT JOIN loyalty_tiers t ON t.code = p.min_tier_code`;

promotionsRouter.get('/', authenticate, SELL, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const r = await db.query(`${SELECT_PROMO} ORDER BY p.is_active DESC, p.ends_on NULLS FIRST, p.created_at DESC`);
  res.json({ success: true, data: r.rows.map(p => ({ ...p, label: promoLabel(p) })) });
}));

promotionsRouter.post('/', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = promoBody.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  try {
    const r = await db.query(
      `INSERT INTO promotions (name, description, target, kind, value, buy_qty, get_qty, product_ids, category_ids, min_quantity, min_amount, coupon_code,
                               customer_scope, min_tier_code, on_pos, on_orders, on_quotes, store_id, starts_on, ends_on, days_of_week, time_from, time_to,
                               max_uses, priority, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27) RETURNING id`,
      [...promoCols(b.data), req.user!.userId]);
    res.status(201).json({ success: true, data: (await db.query(`${SELECT_PROMO} WHERE p.id = $1`, [r.rows[0].id])).rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') { bad(res, 'Ce code promo est déjà utilisé par une autre promotion', 409); return; }
    throw e;
  }
}));

promotionsRouter.put('/:id', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = promoBody.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  try {
    const r = await db.query(
      `UPDATE promotions SET name = $2, description = $3, target = $4, kind = $5, value = $6, buy_qty = $7, get_qty = $8, product_ids = $9, category_ids = $10,
              min_quantity = $11, min_amount = $12, coupon_code = $13, customer_scope = $14, min_tier_code = $15, on_pos = $16, on_orders = $17, on_quotes = $18,
              store_id = $19, starts_on = $20, ends_on = $21, days_of_week = $22, time_from = $23, time_to = $24, max_uses = $25, priority = $26, is_active = $27,
              updated_at = now()
        WHERE id = $1 RETURNING id`, [req.params.id, ...promoCols(b.data)]);
    if (!r.rows[0]) { bad(res, 'Promotion introuvable', 404); return; }
    res.json({ success: true, data: (await db.query(`${SELECT_PROMO} WHERE p.id = $1`, [req.params.id])).rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') { bad(res, 'Ce code promo est déjà utilisé par une autre promotion', 409); return; }
    throw e;
  }
}));

/** Une promotion déjà utilisée s'arrête (désactivée) ; jamais utilisée, elle se supprime. */
promotionsRouter.delete('/:id', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const used = await db.query(`SELECT 1 FROM document_promotions WHERE promotion_id = $1 LIMIT 1`, [req.params.id]);
  if (used.rows.length) {
    await db.query(`UPDATE promotions SET is_active = false, updated_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ success: true, data: { archived: true } });
    return;
  }
  const r = await db.query(`DELETE FROM promotions WHERE id = $1`, [req.params.id]);
  if (!r.rowCount) { bad(res, 'Promotion introuvable', 404); return; }
  res.json({ success: true, data: { deleted: true } });
}));

/**
 * Aperçu pour la caisse : prix du canal, promotions applicables, et ce que le client
 * peut payer en points sur ce ticket. Le checkout refait le même calcul.
 */
promotionsRouter.post('/evaluate', authenticate, SELL, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({
    items: z.array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().positive() })).max(200),
    customerId: z.string().uuid().nullish(), channelId: z.string().uuid().nullish(), couponCode: z.string().trim().max(40).nullish(),
    manualDiscount: z.coerce.number().min(0).default(0),
  }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const channelId = b.data.channelId || (await salesChannelRepository.findDefault())?.id || null;
  const lines = [];
  for (const it of b.data.items) {
    const product = await productRepository.findById(it.productId);
    if (!product) continue;
    const priced = await posLinePrice(product, it.quantity, channelId);
    lines.push({ productId: it.productId, categoryId: product.category_id ?? null, quantity: it.quantity, unit: priced.unit, unitPrice: priced.unitPrice, subtotal: priced.subtotal });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const promo = await evaluate(lines, { channel: 'pos', storeId: req.user!.storeId, customerId: b.data.customerId ?? null, couponCode: b.data.couponCode ?? null });
  let points = null;
  if (b.data.customerId) {
    const s = await loyalty.getSettings();
    const c = await db.query(`SELECT COALESCE(loyalty_points, 0)::int AS n FROM customers WHERE id = $1`, [b.data.customerId]);
    const balance = c.rows[0]?.n ?? 0;
    const ticket = Math.max(0, round2(subtotal - promo.total - b.data.manualDiscount));
    const cap = round2(ticket * Number(s.max_redeem_pct) / 100);
    const maxPoints = Math.min(balance, Math.floor(cap / Number(s.point_value) + 1e-9));
    const t = await loyalty.tierFor(b.data.customerId);
    points = {
      enabled: s.enabled, balance, value: round2(balance * Number(s.point_value)), pointValue: Number(s.point_value),
      minRedeemPoints: s.min_redeem_points, maxRedeemPct: Number(s.max_redeem_pct),
      maxPoints: s.enabled && maxPoints >= s.min_redeem_points ? maxPoints : 0,
      tier: t.tier ? { code: t.tier.code, label: t.tier.label } : null,
      // Barème du client : la caisse calcule les points sur le montant réellement payé.
      earn: { points: s.earn_points, perAmount: Number(s.earn_per_amount), multiplier: t.tier ? Number(t.tier.earn_multiplier) : 1 },
    };
  }
  res.json({ success: true, data: { subtotal, promotion: promo, loyalty: points } });
}));

/* ─── Fidélité ─────────────────────────────────────────────────────────── */
loyaltyRouter.get('/overview', authenticate, MANAGE, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { ...(await loyalty.overview()), tiersConfig: await loyalty.listTiers(db, true) } });
}));

loyaltyRouter.put('/settings', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({
    enabled: z.boolean(), earnPoints: z.coerce.number().int().min(1).max(1000), earnPerAmount: z.coerce.number().positive().max(100000),
    pointValue: z.coerce.number().positive().max(1000), minRedeemPoints: z.coerce.number().int().min(1).max(10_000_000),
    maxRedeemPct: z.coerce.number().positive().max(100), expiryMonths: z.coerce.number().int().min(0).max(120),
  }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const d = b.data;
  await db.query(
    `UPDATE loyalty_settings SET enabled = $1, earn_points = $2, earn_per_amount = $3, point_value = $4, min_redeem_points = $5,
            max_redeem_pct = $6, expiry_months = $7, updated_by = $8, updated_at = now() WHERE id`,
    [d.enabled, d.earnPoints, d.earnPerAmount, d.pointValue, d.minRedeemPoints, d.maxRedeemPct, d.expiryMonths, req.user!.userId]);
  res.json({ success: true, data: await loyalty.getSettings() });
}));

loyaltyRouter.put('/tiers', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.array(z.object({
    code: z.string().trim().regex(/^[a-z0-9_]{2,20}$/, 'Code de niveau : minuscules, chiffres, _'), label: z.string().trim().min(1).max(60),
    minPoints: z.coerce.number().int().min(0), earnMultiplier: z.coerce.number().min(1).max(10), color: z.string().max(20).nullish(), isActive: z.boolean().default(true),
  })).max(10).safeParse(req.body?.tiers);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  if (new Set(b.data.map(t => t.minPoints)).size !== b.data.length) { bad(res, 'Deux niveaux ne peuvent pas avoir le même seuil'); return; }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const t of b.data) {
      await client.query(
        `INSERT INTO loyalty_tiers (code, label, min_points, earn_multiplier, color, is_active) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, min_points = EXCLUDED.min_points, earn_multiplier = EXCLUDED.earn_multiplier,
                                          color = EXCLUDED.color, is_active = EXCLUDED.is_active`,
        [t.code, t.label, t.minPoints, t.earnMultiplier, t.color ?? null, t.isActive]);
    }
    // Un niveau retiré de la liste est désactivé (des promotions peuvent le viser).
    await client.query(`UPDATE loyalty_tiers SET is_active = false WHERE NOT (code = ANY ($1::text[]))`, [b.data.map(t => t.code)]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ success: true, data: await loyalty.listTiers(db, true) });
}));

loyaltyRouter.get('/tiers', authenticate, SELL, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await loyalty.listTiers() });
}));

loyaltyRouter.get('/customers/:id', authenticate, SELL, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await loyalty.customerSummary(req.params.id);
  if (!r) { bad(res, 'Client introuvable', 404); return; }
  res.json({ success: true, data: r });
}));

loyaltyRouter.post('/customers/:id/adjust', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ points: z.coerce.number().int().refine(n => n !== 0, 'Indiquez un nombre de points'), note: z.string().trim().min(3).max(200) }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await loyalty.adjust(req.params.id, b.data.points, b.data.note, req.user!.userId);
  if ('error' in r) { bad(res, r.error, 409); return; }
  res.json({ success: true, data: await loyalty.customerSummary(req.params.id) });
}));

/** Derniers mouvements de points, tous clients (contrôle de la direction). */
loyaltyRouter.get('/transactions', authenticate, MANAGE, asyncHandler(async (req: AuthRequest, res: Response) => {
  const kind = typeof req.query.kind === 'string' && ['earn', 'redeem', 'expire', 'adjust', 'reverse'].includes(req.query.kind) ? req.query.kind : null;
  const r = await db.query(
    `SELECT t.*, s.sale_number, COALESCE(NULLIF(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) AS customer_name,
            concat_ws(' ', u.first_name, u.last_name) AS created_by_name
       FROM loyalty_transactions t JOIN customers c ON c.id = t.customer_id
       LEFT JOIN sales s ON s.id = t.sale_id LEFT JOIN users u ON u.id = t.created_by
      WHERE ($1::text IS NULL OR t.kind = $1::text) ORDER BY t.created_at DESC LIMIT 200`, [kind]);
  res.json({ success: true, data: r.rows });
}));
