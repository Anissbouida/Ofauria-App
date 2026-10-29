import pg from 'pg';
import { db } from '../config/database.js';

type PoolClient = pg.PoolClient;

/**
 * Charges constatées d'avance (CCA, compte 486, mig 380).
 *
 * Modèle comptable (CGNC) :
 *   - Création : reclassement du total hors charges vers l'actif de régularisation
 *     — débit 486 / crédit 6x (compte de charge), daté au début de la période.
 *   - Chaque mois couvert : constatation au prorata linéaire — débit 6x / crédit 486.
 *   - En fin de période, le 486 est soldé.
 * Toutes les écritures passent au journal OD en 'posted'. Une constatation par
 * (CCA, mois) grâce à la contrainte d'unicité ; rejouer un mois déjà fait ne
 * double rien. La date comptable est ramenée dans une période ouverte par
 * fn_accounting_date (comme le reste du noyau).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Normalise une valeur date (Date | string) venue de pg en YYYY-MM-DD. */
function isoDate(d: unknown): string { const v = d as { toISOString?: () => string }; return v instanceof Date ? v.toISOString().slice(0, 10) : String(d); }

/** Nombre de mois (inclusif) couverts par [start, end]. */
function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** Premier jour du i-ème mois (0-based) à partir du mois de `start`, en YYYY-MM-01. */
function monthStart(start: string, i: number): string {
  const [sy, sm] = start.split('-').map(Number);
  const total = (sy * 12 + (sm - 1)) + i;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** Dernier jour du mois d'une date YYYY-MM-01. */
function monthEnd(firstDay: string): string {
  const [y, m] = firstDay.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Échéancier linéaire : montant par mois, le dernier absorbe l'arrondi. */
function schedule(total: number, months: number): number[] {
  const per = round2(total / months);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < months; i++) {
    const amt = i === months - 1 ? round2(total - acc) : per;
    acc = round2(acc + amt);
    out.push(amt);
  }
  return out;
}

/** Pose une écriture OD à deux lignes (débit `debitCode`, crédit `creditCode`). */
async function persistCcaEntry(
  client: PoolClient,
  p: { date: string; debitCode: string; creditCode: string; amount: number; label: string;
       sourceId: string; sourceDetail: string; storeId: string | null; userId: string | null },
): Promise<string> {
  // Date comptable ramenée dans une période ouverte (création des périodes à la demande).
  const accDate = (await client.query(`SELECT fn_accounting_date($1::date)::text AS d`, [p.date])).rows[0].d as string;
  const fp = (await client.query(
    `SELECT id FROM fiscal_periods WHERE $1::date BETWEEN start_date AND end_date AND status = 'open' LIMIT 1`, [accDate])).rows[0];
  if (!fp) throw new Error(`Aucune période fiscale ouverte pour ${accDate}`);

  const journalId = (await client.query(`SELECT id FROM journals WHERE code = 'OD'`)).rows[0].id as string;
  const year = parseInt(accDate.slice(0, 4), 10);
  const num = (await client.query('SELECT next_entry_number($1, $2) AS num', [journalId, year])).rows[0].num as string;

  const acc = await client.query(`SELECT id, code FROM accounts WHERE code = ANY($1::text[])`, [[p.debitCode, p.creditCode]]);
  const byCode = new Map<string, string>(acc.rows.map((r: { code: string; id: string }) => [r.code, r.id]));
  if (!byCode.get(p.debitCode) || !byCode.get(p.creditCode)) throw new Error('Compte comptable introuvable');

  const entryId = (await client.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,'draft',$8,$9) RETURNING id`,
    [num, journalId, accDate, fp.id, p.label, p.sourceId, p.sourceDetail, p.storeId, p.userId])).rows[0].id as string;

  await client.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label)
     VALUES ($1, 1, $2, $3, 0, $5), ($1, 2, $4, 0, $3, $5)`,
    [entryId, byCode.get(p.debitCode), p.amount, byCode.get(p.creditCode), p.label]);

  await client.query(`UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`, [entryId, p.userId]);
  return entryId;
}

export const prepaidChargeRepository = {
  async create(input: {
    label: string; chargeAccountCode: string; totalAmount: number; startDate: string; endDate: string;
    sourceInvoiceId?: string | null; storeId?: string | null; notes?: string | null; userId: string | null;
  }) {
    if (input.endDate < input.startDate) return { error: 'La date de fin doit suivre la date de début' };
    const months = monthsBetween(input.startDate, input.endDate);
    if (months < 1) return { error: 'Période invalide' };
    const total = round2(input.totalAmount);
    if (total <= 0) return { error: 'Montant invalide' };

    // Le compte de charge doit exister et être une charge (classe 6).
    const accRow = (await db.query(`SELECT code, account_class FROM accounts WHERE code = $1`, [input.chargeAccountCode])).rows[0];
    if (!accRow) return { error: 'Compte de charge introuvable' };
    if (Number(accRow.account_class) !== 6) return { error: 'Le compte doit être un compte de charge (classe 6)' };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const row = (await client.query(
        `INSERT INTO prepaid_charges (label, charge_account_code, total_amount, start_date, end_date, months, source_invoice_id, store_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [input.label.trim(), input.chargeAccountCode, total, input.startDate, input.endDate, months,
         input.sourceInvoiceId ?? null, input.storeId ?? null, input.notes?.trim() || null, input.userId])).rows[0];
      // Reclassement initial : débit 486 / crédit 6x, daté au début de la période.
      const initId = await persistCcaEntry(client, {
        date: input.startDate, debitCode: '486', creditCode: input.chargeAccountCode, amount: total,
        label: `CCA — ${input.label.trim()}`, sourceId: row.id, sourceDetail: 'cca-init',
        storeId: input.storeId ?? null, userId: input.userId,
      });
      await client.query(`UPDATE prepaid_charges SET init_entry_id = $2 WHERE id = $1`, [row.id, initId]);
      await client.query('COMMIT');
      return { data: await this.getById(row.id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async list(storeId?: string) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (pc.store_id IS NULL OR pc.store_id = $1)`; }
    const r = await db.query(
      `SELECT pc.*, a.label AS charge_account_label,
              COALESCE((SELECT SUM(amount) FROM prepaid_charge_recognitions r WHERE r.prepaid_charge_id = pc.id), 0)::float8 AS recognized,
              (SELECT COUNT(*) FROM prepaid_charge_recognitions r WHERE r.prepaid_charge_id = pc.id)::int AS recognized_months
         FROM prepaid_charges pc
         JOIN accounts a ON a.code = pc.charge_account_code
         ${where}
        ORDER BY pc.created_at DESC`, params);
    return r.rows.map((row: Record<string, unknown>) => ({
      ...row,
      total_amount: Number(row.total_amount),
      remaining: round2(Number(row.total_amount) - Number(row.recognized)),
    }));
  },

  async getById(id: string) {
    const pc = (await db.query(
      `SELECT pc.*, a.label AS charge_account_label FROM prepaid_charges pc JOIN accounts a ON a.code = pc.charge_account_code WHERE pc.id = $1`, [id])).rows[0];
    if (!pc) return null;
    const recs = (await db.query(
      `SELECT period_month, amount::float8 AS amount, journal_entry_id, recognized_at FROM prepaid_charge_recognitions WHERE prepaid_charge_id = $1 ORDER BY period_month`, [id])).rows;
    const total = Number(pc.total_amount);
    const sched = schedule(total, pc.months);
    const recognizedSet = new Set(recs.map((r: { period_month: string }) =>
      isoDate(r.period_month).slice(0, 7)));
    const plan = sched.map((amount, i) => {
      const month = monthStart(isoDate(pc.start_date), i);
      return { month, amount, recognized: recognizedSet.has(month.slice(0, 7)) };
    });
    const recognized = round2(recs.reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0));
    return {
      ...pc, total_amount: total, recognized, remaining: round2(total - recognized),
      recognitions: recs, schedule: plan,
    };
  },

  /**
   * Constate les mois échus (period_month ≤ asOf) non encore constatés, pour une
   * CCA (si `id`) ou toutes les CCA actives. Pose une écriture débit 6x / crédit 486
   * par mois. Idempotent via la contrainte d'unicité (CCA, mois).
   */
  async recognizeDue(opts: { id?: string; asOf: string; storeId?: string | null; userId: string | null }) {
    const asOfMonth = opts.asOf.slice(0, 7); // YYYY-MM
    const params: unknown[] = [];
    const cond = [`pc.status = 'active'`];
    if (opts.id) { params.push(opts.id); cond.push(`pc.id = $${params.length}`); }
    if (opts.storeId) { params.push(opts.storeId); cond.push(`(pc.store_id IS NULL OR pc.store_id = $${params.length})`); }
    const charges = (await db.query(
      `SELECT id, label, charge_account_code, total_amount::float8 AS total, months, start_date, store_id
         FROM prepaid_charges pc WHERE ${cond.join(' AND ')}`, params)).rows;

    let posted = 0;
    const client = await db.getClient();
    try {
      for (const c of charges) {
        const start = isoDate(c.start_date);
        const sched = schedule(Number(c.total), c.months);
        const existing = new Set((await client.query(
          `SELECT to_char(period_month, 'YYYY-MM') AS m FROM prepaid_charge_recognitions WHERE prepaid_charge_id = $1`, [c.id]
        )).rows.map((r: { m: string }) => r.m));

        for (let i = 0; i < c.months; i++) {
          const month = monthStart(start, i);         // YYYY-MM-01
          if (month.slice(0, 7) > asOfMonth) break;    // pas encore échu
          if (existing.has(month.slice(0, 7))) continue;
          await client.query('BEGIN');
          try {
            const amount = sched[i];
            const entryId = await persistCcaEntry(client, {
              date: monthEnd(month), debitCode: c.charge_account_code, creditCode: '486', amount,
              label: `Constatation CCA — ${c.label} (${month.slice(0, 7)})`,
              sourceId: c.id, sourceDetail: `cca-recog:${month.slice(0, 7)}`,
              storeId: c.store_id ?? null, userId: opts.userId,
            });
            await client.query(
              `INSERT INTO prepaid_charge_recognitions (prepaid_charge_id, period_month, amount, journal_entry_id) VALUES ($1,$2,$3,$4)`,
              [c.id, month, amount, entryId]);
            await client.query('COMMIT');
            posted++;
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          }
        }
        // Clôture si tous les mois sont constatés.
        const nb = (await client.query(`SELECT COUNT(*)::int AS n FROM prepaid_charge_recognitions WHERE prepaid_charge_id = $1`, [c.id])).rows[0].n;
        if (nb >= c.months) await client.query(`UPDATE prepaid_charges SET status = 'done' WHERE id = $1 AND status = 'active'`, [c.id]);
      }
    } finally {
      client.release();
    }
    return { posted };
  },
};
