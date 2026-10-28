import { Router, type Response } from 'express';
import { z } from 'zod';
import { ROLE_GROUPS } from '@ofauria/shared';
import { db } from '../config/database.js';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Tickets en attente à la caisse (mig 373) : par magasin, visibles de tous les postes du
 * magasin. Le contenu est le panier tel que la caisse le tient ; aucune vente n'est créée.
 */
export const posParkedRouter = Router();
const SELL = authorize(...ROLE_GROUPS.SALES);
function bad(res: Response, message = 'Paramètres invalides', status = 400) { res.status(status).json({ success: false, error: { message } }); }

const item = z.object({
  productId: z.string().uuid(), name: z.string().max(200), price: z.number().min(0), quantity: z.number().int().positive(),
  unit: z.enum(['unit', 'g']).default('unit'), displayUnit: z.enum(['g', 'kg']).nullish(), imageUrl: z.string().max(500).nullish(),
});
const body = z.object({
  items: z.array(item).min(1).max(200),
  customerId: z.string().uuid().nullish(),
  customerLabel: z.string().trim().max(160).nullish(),
  label: z.string().trim().max(80).nullish(),
  channelId: z.string().uuid().nullish(),
  couponCode: z.string().trim().max(40).nullish(),
  sachetsGiven: z.number().int().min(0).max(50).nullish(),
  total: z.number().min(0),
});

posParkedRouter.get('/', authenticate, SELL, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user!.storeId) { res.json({ success: true, data: [] }); return; }
  const r = await db.query(
    `SELECT p.*, concat_ws(' ', u.first_name, u.last_name) AS user_name
       FROM pos_parked_tickets p JOIN users u ON u.id = p.user_id
      WHERE p.store_id = $1 ORDER BY p.created_at`, [req.user!.storeId]);
  res.json({ success: true, data: r.rows });
}));

posParkedRouter.post('/', authenticate, SELL, asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user!.storeId) { bad(res, 'Caissier non rattaché à un magasin'); return; }
  const b = body.safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const d = b.data;
  const count = d.items.reduce((n, i) => n + (i.unit === 'g' ? 1 : i.quantity), 0);
  const r = await db.query(
    `INSERT INTO pos_parked_tickets (store_id, user_id, customer_id, customer_label, label, channel_id, coupon_code, sachets_given, items, item_count, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) RETURNING *`,
    [req.user!.storeId, req.user!.userId, d.customerId ?? null, d.customerLabel || null, d.label || null, d.channelId ?? null,
     d.couponCode || null, d.sachetsGiven ?? null, JSON.stringify(d.items), count, Math.round(d.total * 100) / 100]);
  res.status(201).json({ success: true, data: r.rows[0] });
}));

/** Reprise ou abandon : dans les deux cas le ticket quitte la file (la caisse garde une copie pour la reprise). */
posParkedRouter.delete('/:id', authenticate, SELL, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = await db.query(`DELETE FROM pos_parked_tickets WHERE id = $1 AND store_id = $2 RETURNING *`, [req.params.id, req.user!.storeId ?? null]);
  if (!r.rows[0]) { bad(res, 'Ticket en attente introuvable (déjà repris sur un autre poste ?)', 404); return; }
  res.json({ success: true, data: r.rows[0] });
}));
