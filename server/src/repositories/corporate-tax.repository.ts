/**
 * Impôt sur les sociétés (mig 430) : du résultat comptable au résultat fiscal,
 * IS au taux proportionnel, cotisation minimale, acomptes, charge de
 * l'exercice et solde — avec leurs écritures.
 *
 *   - Résultat comptable avant impôt : produits (7) − charges (6) de
 *     l'exercice, hors charge d'IS (6701) elle-même.
 *   - Résultat fiscal = résultat comptable + réintégrations − déductions.
 *   - IS = résultat fiscal positif × taux (20 % sous le seuil, 35 % au-delà,
 *     40 % en régime « crédit ») ; CM = max(base × 0,25 %, 3 000) sauf
 *     exonération ; IS dû = max(IS, CM).
 *   - Acomptes : 25 % de l'impôt du dernier exercice clos (résultat fiscal
 *     N−1 aux taux de N, ou CM N−1 si plus élevée) ; un crédit d'acomptes
 *     antérieur s'impute d'abord.
 *   - Charge (au 31/12) : 6701 D / 3453 C (acomptes et crédit disponibles,
 *     dans la limite de l'IS dû) / 4453 C (reste) ; solde : 4453 D / 5141|5161 C.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { extourneEntryById } from '../services/journal-generator.service.js';
import { DEFAULTS, rateFor, computeTax, type TaxParams } from '../services/corporate-tax.rules.js';

export { rateFor, computeTax, type TaxParams };

type Actor = { userId: string };
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** Comptes de la base de CM : ventes, produits accessoires, subventions d'exploitation, produits financiers (hors reprises). */
const CM_BASE_SQL = `(a.code LIKE '711%' OR a.code LIKE '712%' OR a.code LIKE '716%' OR a.code LIKE '718%' OR (a.code LIKE '73%' AND a.code NOT LIKE '739%'))`;

async function withTx<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

type Row = TaxParams & { year: number; status: 'draft' | 'booked'; taxable_result: string | null; cm_amount: string | null;
  tax_due: string | null; installments_imputed: string | null; charge_entry_id: string | null; booked_at: string | null };
const num = (v: unknown) => (v == null ? null : Number(v));
async function yearRow(c: PoolClient | typeof db, year: number, lock = false): Promise<Row | null> {
  const r = (await c.query(`SELECT * FROM corporate_tax_years WHERE year = $1${lock ? ' FOR UPDATE' : ''}`, [year])).rows[0];
  if (!r) return null;
  return { ...r, rate_standard: Number(r.rate_standard), rate_high: Number(r.rate_high), high_threshold: Number(r.high_threshold),
    rate_credit: Number(r.rate_credit), cm_rate: Number(r.cm_rate), cm_minimum: Number(r.cm_minimum), cm_base_override: num(r.cm_base_override) };
}
async function ensureYear(c: PoolClient, year: number) {
  await c.query(`INSERT INTO corporate_tax_years (year) VALUES ($1) ON CONFLICT (year) DO NOTHING`, [year]);
  return (await yearRow(c, year, true))!;
}

/** Écriture validée d'un journal donné (numéro pris à la validation). */
async function postEntry(c: PoolClient, p: { journal: 'OD' | 'BQ' | 'CA'; date: string; label: string; detail: string; userId: string;
  lines: { code: string; debit: number; credit: number; label: string }[] }) {
  // Deux requêtes : la période créée par fn_ensure_fiscal_period n'est pas visible du SELECT qui l'appelle.
  const periodId = (await c.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [p.date])).rows[0].id;
  const period = (await c.query(`SELECT id, status FROM fiscal_periods WHERE id = $1`, [periodId])).rows[0];
  if (period.status !== 'open') throw fail(`Période du ${p.date.split('-').reverse().join('/')} fermée : choisissez une date dans une période ouverte`, 409);
  const jrn = (await c.query(`SELECT id FROM journals WHERE code = $1`, [p.journal])).rows[0].id;
  const num = (await c.query(`SELECT next_entry_number($1, $2::smallint) AS n`, [jrn, Number(p.date.slice(0, 4))])).rows[0].n as string;
  const ids = new Map<string, string>((await c.query(`SELECT id, code FROM accounts WHERE code = ANY($1::text[])`, [p.lines.map(l => l.code)])).rows
    .map((r: { id: string; code: string }) => [r.code, r.id]));
  const id = (await c.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_detail, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'draft', $7) RETURNING id`,
    [num, jrn, p.date, period.id, p.label, p.detail, p.userId])).rows[0].id as string;
  let order = 0;
  for (const l of p.lines.filter(x => x.debit > 0 || x.credit > 0)) {
    await c.query(`INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ++order, ids.get(l.code), r2(l.debit), r2(l.credit), l.label]);
  }
  await c.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [id, p.userId]);
  return { id, entry_number: num };
}

export const corporateTaxRepository = {
  /** Calcul complet d'un exercice (rien n'est écrit). */
  async summary(year: number) {
    const row = await yearRow(db, year);
    const params: TaxParams = row ?? DEFAULTS;
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const res = (await db.query(
      `SELECT COALESCE(sum(jel.credit - jel.debit) FILTER (WHERE a.account_class = 7), 0)::float8 AS produits,
              COALESCE(sum(jel.debit - jel.credit) FILTER (WHERE a.account_class = 6 AND a.code <> '6701'), 0)::float8 AS charges
         FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening' AND je.entry_date BETWEEN $1::date AND $2::date
          AND a.account_class IN (6, 7)`, [start, end])).rows[0];
    const accountingResult = r2(res.produits - res.charges);
    const adjustments = (await db.query(
      `SELECT id, kind, label, amount::float8 AS amount FROM corporate_tax_adjustments WHERE year = $1 ORDER BY kind DESC, created_at`, [year])).rows as
      { id: string; kind: 'reintegration' | 'deduction'; label: string; amount: number }[];
    const reint = r2(adjustments.filter(a => a.kind === 'reintegration').reduce((s, a) => s + a.amount, 0));
    const deduct = r2(adjustments.filter(a => a.kind === 'deduction').reduce((s, a) => s + a.amount, 0));
    const taxable = r2(accountingResult + reint - deduct);

    const cmLines = (await db.query(
      `SELECT a.code, a.label, sum(jel.credit - jel.debit)::float8 AS amount
         FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening' AND je.entry_date BETWEEN $1::date AND $2::date AND ${CM_BASE_SQL}
        GROUP BY a.code, a.label HAVING sum(jel.credit - jel.debit) <> 0 ORDER BY a.code`, [start, end])).rows as { code: string; label: string; amount: number }[];
    const cmBaseComputed = r2(cmLines.reduce((s, l) => s + l.amount, 0));
    const cmBase = params.cm_base_override ?? cmBaseComputed;
    const tax = computeTax(params, taxable, cmBase);

    // Acomptes : impôt du dernier exercice clos (comptabilisé) aux taux de l'exercice en cours.
    const prev = await yearRow(db, year - 1);
    let basis: { source: 'previous' | 'none'; tax: number | null; taxable: number | null; cm: number | null } = { source: 'none', tax: null, taxable: null, cm: null };
    if (prev?.status === 'booked') {
      const pt = Number(prev.taxable_result), pcm = Number(prev.cm_amount ?? 0);
      const isAtCurrent = pt > 0 ? r2((pt * rateFor(params, pt)) / 100) : 0;
      basis = { source: 'previous', tax: Math.max(isAtCurrent, pcm), taxable: pt, cm: pcm };
    }
    // Crédit d'acomptes disponible : solde débiteur du 3453 à la veille de l'exercice.
    const credit3453 = async (until: string, from: string) => Number((await db.query(
      `SELECT COALESCE(sum(jel.debit - jel.credit), 0)::float8 AS s FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE a.code = '3453' AND je.status IN ('posted', 'reversed') AND je.entry_date <= $1::date AND je.entry_date >= fn_ledger_window_start($1::date, 3)
          AND ($2::date IS NULL OR je.entry_date < $2::date)`, [until, from])).rows[0].s);
    const priorCredit = r2(Math.max(0, await credit3453(end, start)));
    const paid = (await db.query(
      `SELECT i.id, i.kind, i.quarter, i.amount::float8 AS amount, i.paid_on::text AS paid_on, i.treasury, i.reference, je.entry_number
         FROM corporate_tax_installments i JOIN journal_entries je ON je.id = i.entry_id WHERE i.year = $1 ORDER BY i.paid_on, i.created_at`, [year])).rows as
      { id: string; kind: 'acompte' | 'solde'; quarter: number | null; amount: number; paid_on: string; treasury: string; reference: string | null; entry_number: string }[];
    let creditLeft = priorCredit;
    const schedule = [1, 2, 3, 4].map(q => {
      const theoretical = basis.tax != null ? r2(basis.tax / 4) : null;
      const use = theoretical != null ? Math.min(creditLeft, theoretical) : 0;
      creditLeft = r2(creditLeft - use);
      return {
        quarter: q, due_date: lastDay(year, q * 3), theoretical, credit_used: r2(use),
        to_pay: theoretical != null ? r2(theoretical - use) : null,
        payment: paid.find(x => x.kind === 'acompte' && x.quarter === q) ?? null,
      };
    });
    const acomptesPaid = r2(paid.filter(p => p.kind === 'acompte').reduce((s, p) => s + p.amount, 0));
    const available = r2(priorCredit + acomptesPaid);
    const booked = row?.status === 'booked';
    const due = booked ? Number(row!.tax_due) : tax.due;
    const imputed = booked ? Number(row!.installments_imputed) : Math.min(available, due);
    const soldePaid = r2(paid.filter(p => p.kind === 'solde').reduce((s, p) => s + p.amount, 0));
    const chargeEntry = row?.charge_entry_id
      ? (await db.query(`SELECT entry_number FROM journal_entries WHERE id = $1`, [row.charge_entry_id])).rows[0]?.entry_number ?? null : null;
    return {
      year, params, status: row?.status ?? 'draft', booked_at: row?.booked_at ?? null, charge_entry_number: chargeEntry,
      accounting_result: accountingResult, produits: r2(res.produits), charges: r2(res.charges),
      adjustments, reintegrations: reint, deductions: deduct, taxable_result: taxable,
      cm_lines: cmLines, cm_base_computed: cmBaseComputed, cm_base: cmBase,
      rate: tax.rate, is_amount: tax.is, cm_amount: tax.cm, tax_due: tax.due, cm_applies: tax.cm > tax.is,
      basis, prior_credit: priorCredit, schedule, payments: paid,
      acomptes_paid: acomptesPaid, available, imputed: r2(imputed),
      balance_due: r2(Math.max(0, due - imputed) - soldePaid), credit_after: r2(Math.max(0, available - imputed)),
      solde_paid: soldePaid, solde_deadline: lastDay(year + 1, 3),
      net_result: r2(accountingResult - due),
    };
  },

  setParams(year: number, p: Partial<TaxParams>, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await ensureYear(c, year);
      if (row.status === 'booked') throw fail('IS déjà comptabilisé : annulez la comptabilisation pour modifier les paramètres', 409);
      const m = { ...row, ...p };
      await c.query(
        `UPDATE corporate_tax_years SET regime = $2, rate_standard = $3, rate_high = $4, high_threshold = $5, rate_credit = $6,
                cm_rate = $7, cm_minimum = $8, cm_exempt = $9, cm_base_override = $10 WHERE year = $1`,
        [year, m.regime, m.rate_standard, m.rate_high, m.high_threshold, m.rate_credit, m.cm_rate, m.cm_minimum, m.cm_exempt, m.cm_base_override]);
      return { year };
    });
  },

  addAdjustment(year: number, a: { kind: 'reintegration' | 'deduction'; label: string; amount: number }, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await ensureYear(c, year);
      if (row.status === 'booked') throw fail('IS déjà comptabilisé : annulez la comptabilisation pour modifier le résultat fiscal', 409);
      return (await c.query(
        `INSERT INTO corporate_tax_adjustments (year, kind, label, amount, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [year, a.kind, a.label.trim().slice(0, 200), r2(a.amount), actor.userId])).rows[0];
    });
  },
  removeAdjustment(id: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const a = (await c.query(
        `SELECT a.id, y.status FROM corporate_tax_adjustments a JOIN corporate_tax_years y ON y.year = a.year WHERE a.id = $1 FOR UPDATE OF y`, [id])).rows[0];
      if (!a) throw fail('Ligne introuvable', 404);
      if (a.status === 'booked') throw fail('IS déjà comptabilisé', 409);
      await c.query(`DELETE FROM corporate_tax_adjustments WHERE id = $1`, [id]);
      return { id };
    });
  },

  /** Versement d'un acompte (3453 D) ou du solde (4453 D) par banque ou caisse. */
  pay(year: number, p: { kind: 'acompte' | 'solde'; quarter?: number | null; amount: number; date: string; treasury: 'bank' | 'cash'; reference?: string | null }, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await ensureYear(c, year);
      const amount = r2(p.amount);
      if (amount <= 0) throw fail('Montant obligatoire');
      if (p.kind === 'acompte') {
        if (!p.quarter || p.quarter < 1 || p.quarter > 4) throw fail('Trimestre de l\'acompte (1 à 4) obligatoire');
        if (row.status === 'booked') throw fail('IS de l\'exercice déjà comptabilisé : un acompte se rattache à l\'exercice en cours', 409);
        if ((await c.query(`SELECT 1 FROM corporate_tax_installments WHERE year = $1 AND kind = 'acompte' AND quarter = $2`, [year, p.quarter])).rows.length) {
          throw fail(`Acompte n° ${p.quarter} déjà versé`, 409);
        }
      } else {
        if (row.status !== 'booked') throw fail('Comptabilisez d\'abord l\'IS de l\'exercice : le solde se calcule sur la charge constatée', 409);
        const s = await corporateTaxRepository.summary(year);
        if (amount > s.balance_due + 0.004) throw fail(`Le solde restant dû est de ${s.balance_due.toFixed(2)} DH`);
      }
      const label = p.kind === 'acompte' ? `IS ${year} — acompte n° ${p.quarter}` : `IS ${year} — solde`;
      const e = await postEntry(c, {
        journal: p.treasury === 'bank' ? 'BQ' : 'CA', date: p.date, label: p.reference ? `${label} (${p.reference})` : label,
        detail: `is:${p.kind}`, userId: actor.userId,
        lines: [
          { code: p.kind === 'acompte' ? '3453' : '4453', debit: amount, credit: 0, label },
          { code: p.treasury === 'bank' ? '5141' : '5161', debit: 0, credit: amount, label },
        ],
      });
      await c.query(
        `INSERT INTO corporate_tax_installments (year, kind, quarter, amount, paid_on, treasury, reference, entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [year, p.kind, p.kind === 'acompte' ? p.quarter : null, amount, p.date, p.treasury, p.reference?.trim() || null, e.id, actor.userId]);
      return { entry_number: e.entry_number };
    });
  },

  /** Annule un versement : extourne de son écriture. */
  cancelPayment(id: string, reason: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const i = (await c.query(
        `SELECT i.*, y.status FROM corporate_tax_installments i JOIN corporate_tax_years y ON y.year = i.year WHERE i.id = $1 FOR UPDATE OF i`, [id])).rows[0];
      if (!i) throw fail('Versement introuvable', 404);
      if (i.kind === 'acompte' && i.status === 'booked') throw fail('IS comptabilisé : annulez d\'abord la comptabilisation (les acomptes y sont imputés)', 409);
      await extourneEntryById(c, i.entry_id, undefined, { userId: actor.userId, reason: `Annulation du versement d'IS — ${reason}` });
      await c.query(`DELETE FROM corporate_tax_installments WHERE id = $1`, [id]);
      return { id };
    });
  },

  /** Charge d'IS de l'exercice au 31/12 : 6701 D / 3453 C / 4453 C ; calcul figé. */
  book(year: number, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await ensureYear(c, year);
      if (row.status === 'booked') throw fail('IS déjà comptabilisé', 409);
      const s = await corporateTaxRepository.summary(year);
      if (s.tax_due <= 0) throw fail('Aucun impôt dû sur cet exercice (exonération de CM et résultat fiscal nul ou négatif)');
      const e = await postEntry(c, {
        journal: 'OD', date: `${year}-12-31`, label: `IS ${year} — charge de l'exercice${s.cm_applies ? ' (cotisation minimale)' : ''}`,
        detail: 'is:charge', userId: actor.userId,
        lines: [
          { code: '6701', debit: s.tax_due, credit: 0, label: s.cm_applies ? 'Cotisation minimale' : `IS au taux de ${s.rate} %` },
          { code: '3453', debit: 0, credit: s.imputed, label: 'Acomptes imputés' },
          { code: '4453', debit: 0, credit: r2(s.tax_due - s.imputed), label: 'IS restant dû' },
        ],
      });
      await c.query(
        `UPDATE corporate_tax_years SET status = 'booked', accounting_result = $2, taxable_result = $3, rate_applied = $4, is_amount = $5,
                cm_base = $6, cm_amount = $7, tax_due = $8, installments_imputed = $9, charge_entry_id = $10, booked_at = now(), booked_by = $11
          WHERE year = $1`,
        [year, s.accounting_result, s.taxable_result, s.rate, s.is_amount, s.cm_base, s.cm_amount, s.tax_due, s.imputed, e.id, actor.userId]);
      return { entry_number: e.entry_number, tax_due: s.tax_due, imputed: s.imputed, balance_due: r2(s.tax_due - s.imputed) };
    });
  },

  /** Annule la comptabilisation (extourne) tant qu'aucun solde n'a été versé. */
  unbook(year: number, reason: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await yearRow(c, year, true);
      if (row?.status !== 'booked') throw fail('IS non comptabilisé', 409);
      if ((await c.query(`SELECT 1 FROM corporate_tax_installments WHERE year = $1 AND kind = 'solde'`, [year])).rows.length) {
        throw fail('Un solde a déjà été versé : annulez d\'abord ce versement', 409);
      }
      await extourneEntryById(c, row.charge_entry_id!, undefined, { userId: actor.userId, reason: `Annulation de la charge d'IS — ${reason}` });
      await c.query(
        `UPDATE corporate_tax_years SET status = 'draft', accounting_result = NULL, taxable_result = NULL, rate_applied = NULL, is_amount = NULL,
                cm_base = NULL, cm_amount = NULL, tax_due = NULL, installments_imputed = NULL, charge_entry_id = NULL, booked_at = NULL, booked_by = NULL
          WHERE year = $1`, [year]);
      return { year };
    });
  },
};
