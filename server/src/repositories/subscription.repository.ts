import { db } from '../config/database.js';
import { invoiceRepository } from './accounting.repository.js';

/**
 * Abonnements / facturation récurrente (mig 382). Génère une facture client
 * émise à échéance régulière via le chemin de facture existant (compta auto).
 * Chaque période n'est facturée qu'une fois (contrainte d'unicité).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isoDate = (d: unknown): string => { const v = d as { toISOString?: () => string }; return v instanceof Date ? v.toISOString().slice(0, 10) : String(d); };

/** Avance une date YYYY-MM-DD du nombre de mois donné, en bornant au dernier jour du mois. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
const stepOf = (freq: string) => (freq === 'yearly' ? 12 : freq === 'quarterly' ? 3 : 1);

export const subscriptionRepository = {
  async create(input: {
    customerId: string; label: string; amount: number; tvaRate?: number;
    frequency: 'monthly' | 'quarterly' | 'yearly'; startDate: string; endDate?: string | null;
    storeId?: string | null; notes?: string | null; userId: string | null;
  }) {
    if (input.endDate && input.endDate < input.startDate) return { error: 'La date de fin doit suivre le début' };
    if (!(input.amount > 0)) return { error: 'Montant invalide' };
    const row = (await db.query(
      `INSERT INTO subscriptions (customer_id, label, amount, tva_rate, frequency, start_date, next_invoice_date, end_date, store_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10) RETURNING id`,
      [input.customerId, input.label.trim(), round2(input.amount), input.tvaRate ?? 0, input.frequency,
       input.startDate, input.endDate ?? null, input.storeId ?? null, input.notes?.trim() || null, input.userId])).rows[0];
    return { data: await this.getById(row.id) };
  },

  async list(storeId?: string) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (s.store_id IS NULL OR s.store_id = $1)`; }
    const r = await db.query(
      `SELECT s.*, ${CUSTOMER_NAME} AS customer_name,
              (SELECT COUNT(*) FROM subscription_invoices si WHERE si.subscription_id = s.id)::int AS invoices_count,
              (SELECT COALESCE(SUM(amount_ttc),0) FROM subscription_invoices si WHERE si.subscription_id = s.id)::float8 AS invoiced_total
         FROM subscriptions s JOIN customers c ON c.id = s.customer_id
         ${where}
        ORDER BY (s.status = 'active') DESC, s.next_invoice_date`, params);
    return r.rows.map((row: Record<string, unknown>) => ({ ...row, amount: Number(row.amount), tva_rate: Number(row.tva_rate) }));
  },

  async getById(id: string) {
    const s = (await db.query(
      `SELECT s.*, ${CUSTOMER_NAME} AS customer_name FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.id = $1`, [id])).rows[0];
    if (!s) return null;
    const invoices = (await db.query(
      `SELECT si.period_date, si.amount_ttc::float8 AS amount_ttc, si.generated_at, i.invoice_number, i.status AS invoice_status
         FROM subscription_invoices si LEFT JOIN invoices i ON i.id = si.invoice_id
        WHERE si.subscription_id = $1 ORDER BY si.period_date DESC`, [id])).rows;
    return { ...s, amount: Number(s.amount), tva_rate: Number(s.tva_rate), invoices };
  },

  async setStatus(id: string, status: 'active' | 'paused' | 'ended') {
    await db.query(`UPDATE subscriptions SET status = $2 WHERE id = $1`, [id, status]);
    return this.getById(id);
  },

  /**
   * Génère les factures dues (period ≤ asOf) pour une CCA ou toutes les actives.
   * Rattrape les périodes en retard. Idempotent via (subscription, période).
   */
  async generateDue(opts: { id?: string; asOf: string; storeId?: string | null; userId: string }) {
    const params: unknown[] = [];
    const cond = [`s.status = 'active'`, `s.next_invoice_date <= $${params.push(opts.asOf)}`];
    if (opts.id) cond.push(`s.id = $${params.push(opts.id)}`);
    if (opts.storeId) cond.push(`(s.store_id IS NULL OR s.store_id = $${params.push(opts.storeId)})`);
    const subs = (await db.query(
      `SELECT s.id, s.customer_id, s.label, s.amount::float8 AS amount, s.tva_rate::float8 AS tva_rate,
              s.frequency, s.next_invoice_date, s.end_date, s.store_id,
              COALESCE(c.delai_paiement_jours, 0) AS term
         FROM subscriptions s JOIN customers c ON c.id = s.customer_id
        WHERE ${cond.join(' AND ')}`, params)).rows;

    let posted = 0;
    for (const s of subs) {
      const step = stepOf(s.frequency);
      const end = s.end_date ? isoDate(s.end_date) : null;
      const done = new Set((await db.query(
        `SELECT to_char(period_date,'YYYY-MM-DD') AS d FROM subscription_invoices WHERE subscription_id = $1`, [s.id]
      )).rows.map((r: { d: string }) => r.d));

      let cursor = isoDate(s.next_invoice_date);
      let guard = 0;
      while (cursor <= opts.asOf && (!end || cursor <= end) && guard < 36) {
        if (!done.has(cursor)) {
          const ht = round2(Number(s.amount));
          const tva = round2(ht * Number(s.tva_rate) / 100);
          const ttc = round2(ht + tva);
          const dueDate = addDays(cursor, Number(s.term) || 0);
          const inv = await invoiceRepository.create({
            invoiceType: 'emitted', customerId: s.customer_id, invoiceDate: cursor, dueDate,
            amount: ht, taxAmount: tva, totalAmount: ttc,
            items: [{ description: s.label, quantity: 1, unitPrice: ht, subtotal: ht, tvaRate: Number(s.tva_rate) || null }],
            notes: `Abonnement — ${s.label}`, createdBy: opts.userId, storeId: s.store_id ?? undefined,
          });
          await db.query(
            `INSERT INTO subscription_invoices (subscription_id, invoice_id, period_date, amount_ttc) VALUES ($1,$2,$3,$4)`,
            [s.id, inv.id, cursor, ttc]);
          posted++;
        }
        cursor = addMonths(cursor, step);
        guard++;
      }
      await db.query(
        `UPDATE subscriptions SET next_invoice_date = $2,
            status = CASE WHEN end_date IS NOT NULL AND $2::date > end_date THEN 'ended' ELSE status END
          WHERE id = $1`, [s.id, cursor]);
    }
    return { posted };
  },
};

const CUSTOMER_NAME = `COALESCE(c.company_name, NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''), 'Client')`;

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
