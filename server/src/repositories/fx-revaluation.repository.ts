/**
 * Réévaluation de clôture des créances et dettes en devise (mig 431).
 *
 *   - Périmètre : factures clients et fournisseurs en devise, non annulées,
 *     datées au plus tard le 31/12, avec un reste dû en devise à cette date
 *     (règlements datés après le 31/12 exclus).
 *   - Reste en DH au taux de la facture = TTC − part soldée (settled_amount) ;
 *     au taux de clôture = reste en devise × taux du 31/12 (Paramètres ›
 *     Devises, ou saisi ici).
 *   - Écriture au 31/12 (OD, « fx:reval ») : une ligne par facture sur le
 *     compte du tiers (3421 / 4411), contrepartie 3701 / 3702 / 4701 / 4702 ;
 *     provision 6393 / 4506 égale aux écarts actif ; reprise 4506 / 7393 de la
 *     provision de la réévaluation précédente.
 *   - Contre-passation au 01/01 suivant (OD, « fx:reopen ») des seuls écarts de
 *     conversion, lettrée avec l'écriture du 31/12 sur chaque tiers : la
 *     facture revient à son taux historique, son règlement dégagera l'écart réel.
 *   - Annulation : délettrage puis extourne des deux écritures, tant que
 *     l'exercice n'est pas clôturé et qu'aucune réévaluation suivante ne
 *     reprend sa provision.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { extourneEntryById } from '../services/journal-generator.service.js';
import { revalue, tiersLine, type FxSide } from '../services/fx-revaluation.rules.js';

type Actor = { userId: string };
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fr = (d: string) => d.split('-').reverse().join('/');

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

type Line = { code: string; debit: number; credit: number; label: string; aux?: string | null };

/** Écriture OD validée (numéro pris à la validation), lignes de tiers avec leur auxiliaire. */
async function postEntry(c: PoolClient, p: { date: string; label: string; detail: string; userId: string; lines: Line[] }) {
  // Deux requêtes : la période créée par fn_ensure_fiscal_period n'est pas visible du SELECT qui l'appelle.
  const periodId = (await c.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [p.date])).rows[0].id;
  const period = (await c.query(`SELECT id, status FROM fiscal_periods WHERE id = $1`, [periodId])).rows[0];
  if (period.status !== 'open') throw fail(`Période du ${fr(p.date)} fermée : rouvrez-la pour comptabiliser la réévaluation`, 409);
  const jrn = (await c.query(`SELECT id FROM journals WHERE code = 'OD'`)).rows[0].id;
  const num = (await c.query(`SELECT next_entry_number($1, $2::smallint) AS n`, [jrn, Number(p.date.slice(0, 4))])).rows[0].n as string;
  const ids = new Map<string, string>((await c.query(`SELECT id, code FROM accounts WHERE code = ANY($1::text[])`, [p.lines.map(l => l.code)])).rows
    .map((r: { id: string; code: string }) => [r.code, r.id]));
  const id = (await c.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_detail, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'draft', $7) RETURNING id`,
    [num, jrn, p.date, period.id, p.label, p.detail, p.userId])).rows[0].id as string;
  let order = 0;
  for (const l of p.lines.filter(x => x.debit > 0 || x.credit > 0)) {
    await c.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ++order, ids.get(l.code), l.aux ?? null, r2(l.debit), r2(l.credit), l.label.slice(0, 200)]);
  }
  await c.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [id, p.userId]);
  return { id, entry_number: num };
}

type OpenInvoice = {
  id: string; invoice_number: string; external_ref: string | null; invoice_type: 'received' | 'emitted'; invoice_date: string;
  currency_code: string; exchange_rate: number; total_amount: number; foreign_total: number; foreign_paid: number; settled: number;
  supplier_id: string | null; customer_id: string | null; tiers: string | null;
};

/** Factures en devise ouvertes au 31/12 : reste en devise et part soldée à cette date. */
async function openInvoices(c: PoolClient | typeof db, date: string): Promise<OpenInvoice[]> {
  const r = await c.query(
    `SELECT i.id, i.invoice_number, i.supplier_invoice_number AS external_ref, i.invoice_type, i.invoice_date::text AS invoice_date,
            trim(i.currency_code) AS currency_code, i.exchange_rate::float8 AS exchange_rate, i.total_amount::float8 AS total_amount,
            i.foreign_total_amount::float8 AS foreign_total,
            COALESCE(p.foreign_paid, 0)::float8 AS foreign_paid, COALESCE(p.settled, 0)::float8 AS settled,
            i.supplier_id, i.customer_id,
            COALESCE(s.name, NULLIF(cu.company_name, ''), NULLIF(trim(concat_ws(' ', cu.first_name, cu.last_name)), '')) AS tiers
       FROM invoices i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN customers cu ON cu.id = i.customer_id
       LEFT JOIN LATERAL (
         SELECT sum(foreign_amount) AS foreign_paid, sum(COALESCE(settled_amount, amount)) AS settled
           FROM payments WHERE invoice_id = i.id AND payment_date <= $1::date) p ON true
      WHERE i.currency_code <> 'MAD' AND i.status <> 'cancelled' AND i.invoice_date <= $1::date
        AND i.invoice_type IN ('received', 'emitted') AND i.foreign_total_amount IS NOT NULL
        AND i.foreign_total_amount - COALESCE(p.foreign_paid, 0) > 0.005
      ORDER BY i.invoice_type DESC, i.currency_code, i.invoice_date, i.invoice_number`, [date]);
  return r.rows as OpenInvoice[];
}

/** Taux de clôture par devise : saisi, sinon dernier taux connu au 31/12. */
async function closingRates(c: PoolClient | typeof db, codes: string[], date: string, overrides: Record<string, number>) {
  const out: Record<string, { rate: number | null; valid_on: string | null; source: 'saisi' | 'table' | 'manquant' }> = {};
  for (const code of codes) {
    const o = overrides[code];
    if (o && o > 0) { out[code] = { rate: o, valid_on: date, source: 'saisi' }; continue; }
    const t = (await c.query(
      `SELECT rate::float8 AS rate, valid_on::text AS valid_on FROM exchange_rates WHERE currency_code = $1 AND valid_on <= $2::date
        ORDER BY valid_on DESC LIMIT 1`, [code, date])).rows[0];
    out[code] = t ? { rate: t.rate, valid_on: t.valid_on, source: 'table' } : { rate: null, valid_on: null, source: 'manquant' };
  }
  return out;
}

async function bookedRow(c: PoolClient | typeof db, year: number, lock = false) {
  return (await c.query(
    `SELECT r.*, e1.entry_number AS reval_number, e2.entry_number AS reopen_number
       FROM fx_revaluations r JOIN journal_entries e1 ON e1.id = r.reval_entry_id LEFT JOIN journal_entries e2 ON e2.id = r.reopen_entry_id
      WHERE r.year = $1 AND r.status = 'booked'${lock ? ' FOR UPDATE OF r' : ''}`, [year])).rows[0] ?? null;
}

/** Écarts de change réalisés de l'exercice (6331 / 7331). */
async function realized(year: number) {
  const r = (await db.query(
    `SELECT COALESCE(sum(jel.debit - jel.credit) FILTER (WHERE a.code = '6331'), 0)::float8 AS loss,
            COALESCE(sum(jel.credit - jel.debit) FILTER (WHERE a.code = '7331'), 0)::float8 AS gain
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE a.code IN ('6331', '7331') AND je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening'
        AND je.entry_date BETWEEN $1::date AND $2::date`, [`${year}-01-01`, `${year}-12-31`])).rows[0];
  return { loss: r2(r.loss), gain: r2(r.gain), net: r2(r.gain - r.loss) };
}

const ACCOUNT_LABEL: Record<string, string> = {
  '3701': 'Écart de conversion actif — diminution des créances',
  '3702': 'Écart de conversion actif — augmentation des dettes',
  '4701': 'Écart de conversion passif — augmentation des créances',
  '4702': 'Écart de conversion passif — diminution des dettes',
};

export const fxRevaluationRepository = {
  /**
   * Réévaluation d'un exercice : celle qui est comptabilisée, sinon le calcul
   * au 31/12 avec les taux saisis (ou ceux de Paramètres › Devises).
   */
  async summary(year: number, overrides: Record<string, number> = {}) {
    const date = `${year}-12-31`;
    const booked = await bookedRow(db, year);
    const prev = await bookedRow(db, year - 1);
    const fy = (await db.query(`SELECT status FROM fiscal_years WHERE year = $1`, [year])).rows[0];
    const real = await realized(year);
    if (booked) {
      const lines = (await db.query(
        `SELECT l.*, l.foreign_remaining::float8 AS foreign_remaining, l.book_rate::float8 AS book_rate, l.book_amount::float8 AS book_amount,
                l.closing_rate::float8 AS closing_rate, l.closing_amount::float8 AS closing_amount, l.difference::float8 AS difference,
                trim(l.currency_code) AS currency_code, i.invoice_number, i.supplier_invoice_number AS external_ref, i.invoice_date::text AS invoice_date,
                COALESCE(s.name, NULLIF(cu.company_name, ''), NULLIF(trim(concat_ws(' ', cu.first_name, cu.last_name)), '')) AS tiers
           FROM fx_revaluation_lines l JOIN invoices i ON i.id = l.invoice_id
           LEFT JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN customers cu ON cu.id = i.customer_id
          WHERE l.revaluation_id = $1 ORDER BY l.side DESC, l.currency_code, i.invoice_date, i.invoice_number`, [booked.id])).rows;
      const rates = Object.fromEntries(Object.entries(booked.rates as Record<string, number>)
        .map(([k, v]) => [k, { rate: Number(v), valid_on: date, source: 'saisi' as const }]));
      return {
        year, closing_date: date, status: 'booked' as const, fiscal_year_closed: fy?.status === 'closed',
        booked_at: booked.booked_at, reval_entry_number: booked.reval_number, reopen_entry_number: booked.reopen_number,
        rates, missing_rates: [] as string[], lines,
        loss_total: Number(booked.loss_total), gain_total: Number(booked.gain_total),
        provision: Number(booked.provision), provision_reversal: Number(booked.provision_reversal),
        previous_provision: prev ? Number(prev.provision) : 0, realized: real,
      };
    }
    const inv = await openInvoices(db, date);
    const rates = await closingRates(db, [...new Set(inv.map(i => i.currency_code))], date, overrides);
    const lines = inv.map(i => {
      const side: FxSide = i.invoice_type === 'emitted' ? 'receivable' : 'payable';
      const foreignRemaining = r2(i.foreign_total - i.foreign_paid);
      const bookAmount = r2(i.total_amount - i.settled);
      const cr = rates[i.currency_code]?.rate ?? null;
      const v = cr != null ? revalue(side, foreignRemaining, bookAmount, cr) : null;
      return {
        invoice_id: i.id, invoice_number: i.invoice_number, external_ref: i.external_ref, invoice_date: i.invoice_date, tiers: i.tiers,
        side, currency_code: i.currency_code, foreign_remaining: foreignRemaining, book_rate: i.exchange_rate, book_amount: bookAmount,
        closing_rate: cr, closing_amount: v?.closingAmount ?? null, difference: v?.difference ?? null, account_code: v?.account ?? null,
      };
    });
    const lossTotal = r2(lines.filter(l => l.account_code === '3701' || l.account_code === '3702').reduce((s, l) => s + Math.abs(l.difference!), 0));
    const gainTotal = r2(lines.filter(l => l.account_code === '4701' || l.account_code === '4702').reduce((s, l) => s + Math.abs(l.difference!), 0));
    const prevProvision = prev ? Number(prev.provision) : 0;
    return {
      year, closing_date: date, status: 'draft' as const, fiscal_year_closed: fy?.status === 'closed',
      booked_at: null, reval_entry_number: null, reopen_entry_number: null,
      rates, missing_rates: Object.entries(rates).filter(([, v]) => v.rate == null).map(([k]) => k), lines,
      loss_total: lossTotal, gain_total: gainTotal, provision: lossTotal, provision_reversal: prevProvision,
      previous_provision: prevProvision, realized: real,
    };
  },

  /** Comptabilise la réévaluation au 31/12 et sa contre-passation au 01/01 suivant. */
  book(year: number, overrides: Record<string, number>, actor: Actor) {
    return withTx(actor.userId, async c => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('fx_revaluation'), $1)`, [year]);
      if (await bookedRow(c, year, true)) throw fail(`Réévaluation ${year} déjà comptabilisée`, 409);
      const fy = (await c.query(`SELECT status FROM fiscal_years WHERE year = $1`, [year])).rows[0];
      if (fy?.status === 'closed') throw fail(`Exercice ${year} clôturé : la réévaluation se fait avant la clôture`, 409);
      if ((await c.query(`SELECT 1 FROM fx_revaluations WHERE year > $1 AND status = 'booked'`, [year])).rows.length) {
        throw fail(`Une réévaluation d'un exercice postérieur est comptabilisée : annulez-la d'abord`, 409);
      }
      const s = await fxRevaluationRepository.summary(year, overrides);
      if (s.missing_rates.length) {
        throw fail(`Taux de clôture manquant pour ${s.missing_rates.join(', ')} : saisissez-le ou ajoutez-le dans Paramètres › Devises`);
      }
      const moving = s.lines.filter(l => l.difference);
      if (!moving.length && !s.provision_reversal) {
        throw fail(s.lines.length
          ? `Aucun écart de change au ${fr(s.closing_date)} : les taux de clôture valent ceux des factures`
          : `Aucune créance ni dette en devise ouverte au ${fr(s.closing_date)}`);
      }

      // Auxiliaire de chaque tiers (créé avec la facture, mig 208).
      const auxOf = async (l: (typeof moving)[number]) => {
        const i = (await c.query(`SELECT supplier_id, customer_id FROM invoices WHERE id = $1`, [l.invoice_id])).rows[0];
        const a = (await c.query(
          `SELECT id FROM account_auxiliaries WHERE ${l.side === 'payable' ? 'supplier_id' : 'customer_id'} = $1`,
          [l.side === 'payable' ? i.supplier_id : i.customer_id])).rows[0];
        if (!a) throw fail(`Facture ${l.invoice_number} : compte auxiliaire du tiers introuvable (facture non comptabilisée ?)`, 409);
        return a.id as string;
      };
      const conv: Line[] = [];
      const counter = new Map<string, number>();
      for (const l of moving) {
        const t = tiersLine(l.side, l.difference!);
        const label = `${l.invoice_number} — ${l.foreign_remaining.toFixed(2)} ${l.currency_code} à ${l.closing_rate} (facture ${l.book_rate})`;
        conv.push({ code: t.code, debit: t.debit, credit: t.credit, label, aux: await auxOf(l) });
        counter.set(l.account_code!, r2((counter.get(l.account_code!) ?? 0) + Math.abs(l.difference!)));
      }
      for (const [code, amount] of [...counter.entries()].sort()) {
        const isActif = code.startsWith('37');
        conv.push({ code, debit: isActif ? amount : 0, credit: isActif ? 0 : amount, label: ACCOUNT_LABEL[code] });
      }
      const provisionLines: Line[] = [
        { code: '6393', debit: s.provision, credit: 0, label: 'Provision pour perte de change' },
        { code: '4506', debit: 0, credit: s.provision, label: 'Provision pour perte de change' },
        { code: '4506', debit: s.provision_reversal, credit: 0, label: `Reprise de la provision ${year - 1}` },
        { code: '7393', debit: 0, credit: s.provision_reversal, label: `Reprise de la provision ${year - 1}` },
      ];
      const reval = await postEntry(c, {
        date: s.closing_date, label: `Réévaluation des créances et dettes en devise au ${fr(s.closing_date)}`,
        detail: 'fx:reval', userId: actor.userId, lines: [...conv, ...provisionLines],
      });
      let reopen: { id: string; entry_number: string } | null = null;
      if (conv.length) {
        reopen = await postEntry(c, {
          date: `${year + 1}-01-01`, label: `Contre-passation des écarts de conversion du ${fr(s.closing_date)}`,
          detail: 'fx:reopen', userId: actor.userId,
          lines: conv.map(l => ({ ...l, debit: l.credit, credit: l.debit, label: `Contre-passation : ${l.label}` })),
        });
        // Écart et contre-passation se soldent sur chaque tiers : lettrés ensemble.
        await c.query(
          `WITH g AS (
             SELECT jel.account_id, jel.auxiliary_id, gen_random_uuid() AS lid
               FROM journal_entry_lines jel
              WHERE jel.journal_entry_id IN ($1, $2) AND jel.auxiliary_id IS NOT NULL
              GROUP BY jel.account_id, jel.auxiliary_id HAVING sum(jel.debit - jel.credit) = 0)
           UPDATE journal_entry_lines jel SET lettrage_id = g.lid FROM g
            WHERE jel.journal_entry_id IN ($1, $2) AND jel.account_id = g.account_id AND jel.auxiliary_id = g.auxiliary_id`,
          [reval.id, reopen.id]);
      }
      const rates = Object.fromEntries(Object.entries(s.rates).map(([k, v]) => [k, v.rate]));
      const id = (await c.query(
        `INSERT INTO fx_revaluations (year, closing_date, rates, loss_total, gain_total, provision, provision_reversal, reval_entry_id, reopen_entry_id, booked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [year, s.closing_date, JSON.stringify(rates), s.loss_total, s.gain_total, s.provision, s.provision_reversal, reval.id, reopen?.id ?? null, actor.userId])).rows[0].id;
      for (const l of s.lines.filter(x => x.difference != null)) {
        await c.query(
          `INSERT INTO fx_revaluation_lines (revaluation_id, invoice_id, side, currency_code, foreign_remaining, book_rate, book_amount,
                                            closing_rate, closing_amount, difference, account_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, l.invoice_id, l.side, l.currency_code, l.foreign_remaining, l.book_rate, l.book_amount, l.closing_rate, l.closing_amount,
           l.difference, l.account_code ?? '-']);
      }
      return { id, reval_entry_number: reval.entry_number, reopen_entry_number: reopen?.entry_number ?? null,
               loss_total: s.loss_total, gain_total: s.gain_total, provision: s.provision, provision_reversal: s.provision_reversal };
    });
  },

  /** Annule une réévaluation : délettrage puis extourne des deux écritures. */
  cancel(year: number, reason: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const row = await bookedRow(c, year, true);
      if (!row) throw fail(`Aucune réévaluation ${year} comptabilisée`, 409);
      const fy = (await c.query(`SELECT status FROM fiscal_years WHERE year = $1`, [year])).rows[0];
      if (fy?.status === 'closed') throw fail(`Exercice ${year} clôturé : sa réévaluation est figée`, 409);
      if ((await c.query(`SELECT 1 FROM fx_revaluations WHERE year > $1 AND status = 'booked'`, [year])).rows.length) {
        throw fail(`La réévaluation ${year + 1} reprend la provision de ${year} : annulez-la d'abord`, 409);
      }
      const entries = [row.reval_entry_id, row.reopen_entry_id].filter(Boolean);
      await c.query(
        `UPDATE journal_entry_lines SET lettrage_id = NULL
          WHERE lettrage_id IN (SELECT lettrage_id FROM journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[]) AND lettrage_id IS NOT NULL)`,
        [entries]);
      const motif = `Annulation de la réévaluation des devises ${year} — ${reason}`;
      if (row.reopen_entry_id) await extourneEntryById(c, row.reopen_entry_id, undefined, { userId: actor.userId, reason: motif });
      await extourneEntryById(c, row.reval_entry_id, undefined, { userId: actor.userId, reason: motif });
      await c.query(
        `UPDATE fx_revaluations SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`,
        [row.id, actor.userId, reason.trim().slice(0, 500)]);
      return { year };
    });
  },
};
