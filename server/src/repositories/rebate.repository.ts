import { db } from '../config/database.js';

/**
 * Phase 11 (D5-12) — ristournes de fin d'année (RFA).
 *
 * Accord par client et par année : taux sur le CA annuel au-delà d'un seuil.
 * Le CA se lit sur les factures émises (net des avoirs). La ristourne est figée
 * à la clôture (`settle`) ; l'émission en avoir reste le flux manuel existant,
 * que l'on rattache ensuite via `attachCreditNote`.
 */

export interface RebateInput {
  customerId: string;
  year: number;
  ratePercent: number;
  minTurnover?: number;
  notes?: string | null;
  createdBy?: string | null;
}

/** CA net (factures émises − avoirs) d'un client sur une année civile. */
async function annualTurnover(customerId: string, year: number): Promise<number> {
  const v = (await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total_amount ELSE total_amount END), 0) AS v
       FROM invoices
      WHERE invoice_type = 'emitted' AND status <> 'cancelled'
        AND customer_id = $1 AND EXTRACT(YEAR FROM invoice_date) = $2`, [customerId, year])).rows[0].v;
  return Math.round(Number(v) * 100) / 100;
}

function rebateOf(turnover: number, ratePercent: number, minTurnover: number) {
  const eligible = turnover >= minTurnover;
  const amount = eligible ? Math.round(turnover * (ratePercent / 100) * 100) / 100 : 0;
  return { turnover, eligible, amount };
}

export const rebateRepository = {
  async create(input: RebateInput) {
    if (!(Number(input.ratePercent) >= 0)) return { error: 'Taux invalide' };
    try {
      const row = (await db.query(
        `INSERT INTO rebate_agreements (customer_id, year, rate_percent, min_turnover, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.customerId, input.year, input.ratePercent, input.minTurnover ?? 0, input.notes ?? null, input.createdBy ?? null])).rows[0];
      return { data: row };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return { error: 'Un accord existe déjà pour ce client et cette année' };
      throw err;
    }
  },

  async list(year?: number) {
    const rows = (await db.query(
      `SELECT ra.*, c.company_name, c.first_name, c.last_name
         FROM rebate_agreements ra
         LEFT JOIN customers c ON c.id = ra.customer_id
        ${year ? 'WHERE ra.year = $1' : ''}
        ORDER BY ra.year DESC, ra.created_at DESC`, year ? [year] : [])).rows;
    // Pour un accord actif, la ristourne est estimée en direct ; figée si clôturé.
    return Promise.all(rows.map(async r => {
      if (r.status === 'active') {
        const t = await annualTurnover(r.customer_id, r.year);
        const { amount, eligible } = rebateOf(t, Number(r.rate_percent), Number(r.min_turnover));
        return { ...r, current_turnover: t, current_amount: amount, eligible };
      }
      return { ...r, current_turnover: Number(r.computed_turnover ?? 0), current_amount: Number(r.computed_amount ?? 0), eligible: Number(r.computed_amount ?? 0) > 0 };
    }));
  },

  /** Estimation en direct (lecture seule) de la ristourne d'un accord. */
  async compute(id: string) {
    const r = (await db.query(`SELECT * FROM rebate_agreements WHERE id = $1`, [id])).rows[0];
    if (!r) return null;
    const t = await annualTurnover(r.customer_id, r.year);
    return { agreement: r, ...rebateOf(t, Number(r.rate_percent), Number(r.min_turnover)) };
  },

  /** Clôture : fige le CA et la ristourne calculés ; passe l'accord en 'settled'. */
  async settle(id: string) {
    const r = (await db.query(`SELECT * FROM rebate_agreements WHERE id = $1`, [id])).rows[0];
    if (!r) return { error: 'Accord introuvable' };
    if (r.status !== 'active') return { error: 'Accord déjà clôturé ou annulé' };
    const t = await annualTurnover(r.customer_id, r.year);
    const { amount } = rebateOf(t, Number(r.rate_percent), Number(r.min_turnover));
    const row = (await db.query(
      `UPDATE rebate_agreements SET status = 'settled', computed_turnover = $2, computed_amount = $3, settled_at = now()
        WHERE id = $1 RETURNING *`, [id, t, amount])).rows[0];
    return { data: row };
  },

  /** Rattache a posteriori l'avoir émis (flux manuel) à l'accord clôturé. */
  async attachCreditNote(id: string, creditNoteId: string) {
    await db.query(`UPDATE rebate_agreements SET settled_credit_note_id = $2 WHERE id = $1`, [id, creditNoteId]);
  },

  async cancel(id: string) {
    await db.query(`UPDATE rebate_agreements SET status = 'cancelled' WHERE id = $1 AND status = 'active'`, [id]);
  },
};
