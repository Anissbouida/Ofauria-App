import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { db } from '../config/database.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Devises et taux de change (mig 363). Lecture pour tout utilisateur connecté (formulaires
 * d'achat) ; saisie des taux et activation des devises : Paramètres › Devises.
 */
export const currenciesRouter = Router();

const code = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Code ISO à 3 lettres');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function bad(res: Response, message = 'Paramètres invalides') { res.status(400).json({ success: false, error: { message } }); }

/** Devises avec leur taux du jour (ou de la date demandée) et la date de ce taux. */
async function list(date: string, activeOnly: boolean) {
  const r = await db.query(
    `SELECT c.*, CASE WHEN c.is_base THEN 1 ELSE er.rate END AS rate, er.valid_on AS rate_date, er.source AS rate_source
       FROM currencies c
       LEFT JOIN LATERAL (SELECT rate, valid_on, source FROM exchange_rates x WHERE x.currency_code = c.code AND x.valid_on <= $1::date
                          ORDER BY x.valid_on DESC LIMIT 1) er ON true
      WHERE ($2::boolean IS FALSE OR c.is_active)
      ORDER BY c.is_base DESC, c.code`, [date, activeOnly]);
  return r.rows;
}

currenciesRouter.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ date: isoDate.optional(), all: z.string().optional() }).safeParse(req.query);
  if (!r.success) { bad(res); return; }
  res.json({ success: true, data: await list(r.data.date ?? getLocalISODate(), r.data.all !== 'true') });
}));

/**
 * Écarts de change latents (mig 368) : factures fournisseurs en devise non soldées,
 * réévaluées au taux de la date. Une dette dont la devise monte coûtera plus cher
 * (perte latente). Pour information : aucune écriture (écarts de conversion de clôture).
 */
currenciesRouter.get('/revaluation', authenticate, authorizeSettings('currencies'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({ date: isoDate.optional() }).safeParse(req.query);
  if (!q.success) { bad(res); return; }
  const date = q.data.date ?? getLocalISODate();
  const r = await db.query(
    `SELECT i.id, i.invoice_number, i.supplier_invoice_number, i.invoice_date, i.currency_code, i.exchange_rate,
            i.foreign_total_amount, i.foreign_paid_amount, s.name AS supplier_name,
            (i.foreign_total_amount - i.foreign_paid_amount) AS foreign_remaining,
            fn_exchange_rate(i.currency_code, $1::date) AS current_rate
       FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.invoice_type = 'received' AND i.currency_code <> 'MAD' AND i.status NOT IN ('paid', 'cancelled')
        AND i.foreign_total_amount - i.foreign_paid_amount > 0.005
      ORDER BY i.currency_code, i.invoice_date`, [date]);
  const rows = r.rows.map(x => {
    const remaining = Number(x.foreign_remaining);
    const atInvoice = Math.round(remaining * Number(x.exchange_rate) * 100) / 100;
    const atDate = x.current_rate != null ? Math.round(remaining * Number(x.current_rate) * 100) / 100 : null;
    return { ...x, remaining_at_invoice_rate: atInvoice, remaining_at_date_rate: atDate, latent: atDate != null ? Math.round((atDate - atInvoice) * 100) / 100 : null };
  });
  const sum = (f: (x: typeof rows[number]) => number) => Math.round(rows.reduce((a, x) => a + f(x), 0) * 100) / 100;
  res.json({ success: true, data: { date, rows,
    latentLoss: sum(x => (x.latent ?? 0) > 0 ? x.latent! : 0), latentGain: sum(x => (x.latent ?? 0) < 0 ? -x.latent! : 0),
    missingRates: [...new Set(rows.filter(x => x.current_rate == null).map(x => String(x.currency_code).trim()))] } });
}));

currenciesRouter.get('/:code/rates', authenticate, authorizeSettings('currencies'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const c = code.safeParse(req.params.code);
  if (!c.success) { bad(res); return; }
  const r = await db.query(
    `SELECT x.*, u.first_name || ' ' || u.last_name AS created_by_name FROM exchange_rates x LEFT JOIN users u ON u.id = x.created_by
      WHERE x.currency_code = $1 ORDER BY x.valid_on DESC LIMIT 60`, [c.data]);
  res.json({ success: true, data: r.rows });
}));

/** Ajoute (ou remplace) le taux d'une date. */
currenciesRouter.post('/:code/rates', authenticate, authorizeSettings('currencies', 'create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const c = code.safeParse(req.params.code);
  const b = z.object({ rate: z.coerce.number().positive().max(100_000), validOn: isoDate.optional(), source: z.string().trim().max(80).nullish() }).safeParse(req.body);
  if (!c.success || !b.success) { bad(res, b.success ? undefined : b.error.issues[0]?.message); return; }
  const cur = await db.query(`SELECT is_base FROM currencies WHERE code = $1`, [c.data]);
  if (!cur.rows[0]) { res.status(404).json({ success: false, error: { message: 'Devise inconnue' } }); return; }
  if (cur.rows[0].is_base) { bad(res, 'La devise de base vaut toujours 1'); return; }
  const r = await db.query(
    `INSERT INTO exchange_rates (currency_code, valid_on, rate, source, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (currency_code, valid_on) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, created_by = EXCLUDED.created_by, created_at = now()
     RETURNING *`,
    [c.data, b.data.validOn ?? getLocalISODate(), b.data.rate, b.data.source ?? null, req.user!.userId]);
  res.status(201).json({ success: true, data: r.rows[0] });
}));

/** Nouvelle devise, ou activation / désactivation. */
currenciesRouter.post('/', authenticate, authorizeSettings('currencies', 'create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = z.object({ code, label: z.string().trim().min(2).max(60), symbol: z.string().trim().max(8).nullish(), decimals: z.coerce.number().int().min(0).max(4).optional() }).safeParse(req.body);
  if (!b.success) { bad(res, b.error.issues[0]?.message); return; }
  const r = await db.query(
    `INSERT INTO currencies (code, label, symbol, decimals) VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, symbol = EXCLUDED.symbol, decimals = EXCLUDED.decimals, is_active = true RETURNING *`,
    [b.data.code, b.data.label, b.data.symbol ?? null, b.data.decimals ?? 2]);
  res.status(201).json({ success: true, data: r.rows[0] });
}));

currenciesRouter.patch('/:code', authenticate, authorizeSettings('currencies', 'edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const c = code.safeParse(req.params.code);
  const b = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!c.success || !b.success) { bad(res); return; }
  const r = await db.query(`UPDATE currencies SET is_active = $2 WHERE code = $1 AND NOT is_base RETURNING *`, [c.data, b.data.isActive]);
  if (!r.rows[0]) { bad(res, 'La devise de base ne se désactive pas'); return; }
  res.json({ success: true, data: r.rows[0] });
}));
