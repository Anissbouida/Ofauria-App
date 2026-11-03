/**
 * Portefeuille d'effets clients (lot Bonus 15, mig 435) : chèques et traites
 * reçus (règlements `income`), remis en banque par bordereau.
 *
 *   - En portefeuille : reçu (5111 chèque / 5113 traite au débit), pas remis.
 *   - Bordereau d'encaissement : regroupe les effets remis à une banque ; le
 *     crédit bancaire de chacun (banque / 5111-5113) se passe à l'encaissement.
 *   - Bordereau d'escompte (traites) : la banque avance le nominal moins ses
 *     agios et commissions → banque (net) + 6311 + 6147 + 34552 au débit,
 *     5520 crédits d'escompte au crédit. À l'échéance, 5520 / 5113.
 *   - Impayé : le règlement est annulé (motif, extourne : la créance client
 *     3421 est rouverte et la facture redevient due), la banque reprend le
 *     nominal escompté (5520 / banque) et prélève ses frais (6147 / banque).
 * Comme un état « AS OF », le statut d'un effet se déduit de ses colonnes ;
 * rien n'est stocké en double.
 */
import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { regeneratePaymentEntries, extourneEntryById } from '../services/journal-generator.service.js';
import { withActor } from '../services/document-actions.service.js';
import { FLAGS } from '../config/feature-flags.js';
import { postManualEntry as postEntry } from '../services/ledger-post.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fr = (d: string) => d.split('-').reverse().join('/');
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export type BillStatus = 'portfolio' | 'remitted' | 'discounted' | 'cashed' | 'unpaid';

const EFFECTS_SQL = `
  SELECT p.id, p.payment_method, p.amount::float8 AS amount, p.payment_date::text AS received_on,
         COALESCE(p.check_date, i.due_date, p.payment_date)::text AS due_date,
         p.check_number, p.reference, p.description, p.cashed_at::text AS cashed_at,
         p.unpaid_at::text AS unpaid_at, p.unpaid_fees::float8 AS unpaid_fees, p.status AS payment_status,
         p.remittance_id, br.remittance_number, br.kind AS remittance_kind, br.remittance_date::text AS remittance_date,
         i.id AS invoice_id, i.invoice_number,
         COALESCE(NULLIF(c.company_name, ''), NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')) AS customer_name,
         CASE WHEN p.unpaid_at IS NOT NULL THEN 'unpaid'
              WHEN p.cashed_at IS NOT NULL THEN 'cashed'
              WHEN br.kind = 'discount' THEN 'discounted'
              WHEN br.kind = 'collection' THEN 'remitted'
              ELSE 'portfolio' END AS status
    FROM payments p
    LEFT JOIN bill_remittances br ON br.id = p.remittance_id AND br.status = 'posted'
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
   WHERE p.type = 'income' AND p.payment_method IN ('check', 'traite') AND p.voids_payment_id IS NULL
     AND (p.status = 'executed' OR p.unpaid_at IS NOT NULL)`;

/** Écritures d'un bordereau d'escompte, sans accès à la base (testable). */
export function discountLines(p: { gross: number; interest: number; commission: number; commissionVat: number; bankCode: string; number: string }) {
  const net = r2(p.gross - p.interest - p.commission - p.commissionVat);
  return [
    { code: p.bankCode, debit: net, credit: 0, label: `Escompte ${p.number} — net crédité` },
    { code: '6311', debit: r2(p.interest), credit: 0, label: `Escompte ${p.number} — agios` },
    { code: '6147', debit: r2(p.commission), credit: 0, label: `Escompte ${p.number} — commissions` },
    { code: '34552', debit: r2(p.commissionVat), credit: 0, label: `Escompte ${p.number} — TVA sur commissions` },
    { code: '5520', debit: 0, credit: r2(p.gross), label: `Escompte ${p.number} — crédit d'escompte` },
  ];
}

/** Écriture bancaire d'un impayé (reprise du nominal escompté et frais), sans accès à la base. */
export function unpaidBankLines(p: { amount: number; discounted: boolean; fees: number; bankCode: string; ref: string }) {
  const lines = [];
  if (p.discounted) lines.push({ code: '5520', debit: r2(p.amount), credit: 0, label: `Impayé ${p.ref} — reprise du crédit d'escompte` });
  if (p.fees > 0) lines.push({ code: '6147', debit: r2(p.fees), credit: 0, label: `Impayé ${p.ref} — frais bancaires` });
  const total = r2((p.discounted ? p.amount : 0) + p.fees);
  if (total > 0) lines.push({ code: p.bankCode, debit: 0, credit: total, label: `Impayé ${p.ref} — débit bancaire` });
  return lines;
}

export const billPortfolioRepository = {
  async list(p: { status?: BillStatus | 'open' | 'all' }) {
    const rows = (await db.query(`${EFFECTS_SQL} ORDER BY COALESCE(p.check_date, i.due_date, p.payment_date), p.created_at`)).rows as
      { status: BillStatus; amount: number; due_date: string }[];
    const today = new Date().toISOString().slice(0, 10);
    const open = (s: BillStatus) => s === 'portfolio' || s === 'remitted' || s === 'discounted';
    const filtered = rows.filter(r => !p.status || p.status === 'all' ? true : p.status === 'open' ? open(r.status) : r.status === p.status);
    const sum = (f: (r: typeof rows[number]) => boolean) => r2(rows.filter(f).reduce((s, r) => s + r.amount, 0));
    return {
      effects: filtered.map(r => ({ ...r, overdue: open(r.status) && r.due_date < today })),
      totals: {
        portfolio: sum(r => r.status === 'portfolio'), remitted: sum(r => r.status === 'remitted'),
        discounted: sum(r => r.status === 'discounted'), unpaid: sum(r => r.status === 'unpaid'),
        overdue: sum(r => open(r.status) && r.due_date < today),
      },
    };
  },

  async remittances() {
    return (await db.query(
      `SELECT br.id, br.remittance_number, br.kind, br.remittance_date::text AS remittance_date, br.status,
              br.gross_amount::float8 AS gross_amount, br.interest::float8 AS interest, br.commission::float8 AS commission,
              br.commission_vat::float8 AS commission_vat, br.net_amount::float8 AS net_amount, br.note,
              ta.label AS bank_label, ta.account_code AS bank_code, je.entry_number,
              (SELECT count(*)::int FROM payments p WHERE p.remittance_id = br.id) AS effects,
              (SELECT count(*)::int FROM payments p WHERE p.remittance_id = br.id AND p.cashed_at IS NULL AND p.unpaid_at IS NULL) AS pending
         FROM bill_remittances br
         JOIN treasury_accounts ta ON ta.id = br.treasury_account_id
         LEFT JOIN journal_entries je ON je.id = br.entry_id
        ORDER BY br.remittance_date DESC, br.remittance_number DESC`)).rows;
  },

  /** Bordereau de remise : à l'encaissement (chèques et traites) ou à l'escompte (traites). */
  async createRemittance(p: {
    kind: 'collection' | 'discount'; treasuryAccountId: string; date: string; paymentIds: string[];
    interest?: number; commission?: number; commissionVat?: number; note?: string | null; userId: string; storeId: string | null;
  }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const bank = (await c.query(`SELECT id, account_code, kind, label FROM treasury_accounts WHERE id = $1 AND is_active`, [p.treasuryAccountId])).rows[0];
      if (!bank || bank.kind !== 'bank') throw fail('Choisissez un compte bancaire actif', 400);
      const ids = [...new Set(p.paymentIds)];
      const effects = (await c.query(
        `SELECT id, payment_method, type, status, amount::float8 AS amount, payment_date::text AS payment_date, cashed_at,
                remittance_id, voids_payment_id, unpaid_at, store_id, COALESCE(check_number, reference, '') AS ref
           FROM payments WHERE id = ANY($1::uuid[]) FOR UPDATE`, [ids])).rows;
      if (effects.length !== ids.length || !ids.length) throw fail('Effet introuvable', 404);
      for (const e of effects) {
        if (e.type !== 'income' || !['check', 'traite'].includes(e.payment_method) || e.status !== 'executed' || e.voids_payment_id)
          throw fail(`Le règlement ${e.ref} n'est pas un effet client remettable`);
        if (e.cashed_at || e.unpaid_at || e.remittance_id) throw fail(`L'effet ${e.ref} n'est plus en portefeuille`);
        if (p.kind === 'discount' && e.payment_method !== 'traite') throw fail(`Seules les traites s'escomptent : ${e.ref} est un chèque`);
        if (e.payment_date > p.date) throw fail(`L'effet ${e.ref} est reçu le ${fr(e.payment_date)}, après la date du bordereau`);
      }
      const gross = r2(effects.reduce((s, e) => s + e.amount, 0));
      const interest = p.kind === 'discount' ? r2(p.interest ?? 0) : 0;
      const commission = p.kind === 'discount' ? r2(p.commission ?? 0) : 0;
      const commissionVat = p.kind === 'discount' ? r2(p.commissionVat ?? 0) : 0;
      const net = r2(gross - interest - commission - commissionVat);
      if (net <= 0) throw fail('Les frais d\'escompte dépassent le nominal remis', 400);
      const year = p.date.slice(0, 4);
      const seq = Number((await c.query(
        `SELECT COUNT(*)::int + 1 AS n FROM bill_remittances WHERE remittance_number LIKE $1`, [`BRE-${year}-%`])).rows[0].n);
      const number = `BRE-${year}-${String(seq).padStart(4, '0')}`;
      const storeId = p.storeId ?? effects[0].store_id ?? null;
      const br = (await c.query(
        `INSERT INTO bill_remittances (remittance_number, kind, treasury_account_id, remittance_date, store_id, gross_amount,
                                       interest, commission, commission_vat, net_amount, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [number, p.kind, bank.id, p.date, storeId, gross, interest, commission, commissionVat, net, p.note ?? null, p.userId])).rows[0];
      await c.query(`UPDATE payments SET remittance_id = $1 WHERE id = ANY($2::uuid[])`, [br.id, ids]);
      let entry: { id: string; entry_number: string } | null = null;
      if (p.kind === 'discount') {
        entry = await postEntry(c, {
          journal: 'BQ', date: p.date, label: `Remise à l'escompte ${number} (${effects.length} traite${effects.length > 1 ? 's' : ''})`,
          detail: `bill:discount:${br.id}`, userId: p.userId, storeId,
          lines: discountLines({ gross, interest, commission, commissionVat, bankCode: bank.account_code, number }),
        });
        await c.query(`UPDATE bill_remittances SET entry_id = $2 WHERE id = $1`, [br.id, entry.id]);
      }
      await c.query('COMMIT');
      return { id: br.id as string, remittance_number: number, gross_amount: gross, net_amount: net, entry_number: entry?.entry_number ?? null };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Crédit en banque des effets d'un bordereau d'encaissement (ou échéance d'un escompte) à une date. */
  async settleRemittance(id: string, p: { date: string; userId: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const br = (await c.query(`SELECT id, remittance_date::text AS d, status FROM bill_remittances WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!br || br.status !== 'posted') throw fail('Bordereau introuvable ou annulé', 404);
      if (p.date < br.d) throw fail(`Date antérieure au bordereau (${fr(br.d)})`, 400);
      const pending = (await c.query(
        `UPDATE payments SET cashed_at = $2::date, cashed_by = $3
          WHERE remittance_id = $1 AND cashed_at IS NULL AND unpaid_at IS NULL AND status = 'executed' RETURNING id`,
        [id, p.date, p.userId])).rows as { id: string }[];
      if (FLAGS.LEDGER_AUTOGEN) for (const e of pending) await regeneratePaymentEntries(c, e.id, p.userId);
      await c.query('COMMIT');
      return { settled: pending.length };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Annule un bordereau dont aucun effet n'est encore encaissé ni impayé (extourne de l'escompte). */
  async cancelRemittance(id: string, p: { userId: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const br = (await c.query(`SELECT id, status, entry_id, remittance_number FROM bill_remittances WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!br || br.status !== 'posted') throw fail('Bordereau introuvable ou déjà annulé', 404);
      const done = (await c.query(
        `SELECT count(*)::int AS n FROM payments WHERE remittance_id = $1 AND (cashed_at IS NOT NULL OR unpaid_at IS NOT NULL)`, [id])).rows[0].n;
      if (done) throw fail(`${done} effet(s) du bordereau ${br.remittance_number} déjà encaissé(s) ou impayé(s) : annulez d'abord ces mouvements`);
      if (br.entry_id) await extourneEntryById(c, br.entry_id, undefined, { userId: p.userId, reason: `Annulation du bordereau ${br.remittance_number}` });
      await c.query(`UPDATE payments SET remittance_id = NULL WHERE remittance_id = $1`, [id]);
      await c.query(`UPDATE bill_remittances SET status = 'cancelled', cancelled_by = $2, cancelled_at = now() WHERE id = $1`, [id, p.userId]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /**
   * Impayé à l'échéance : règlement annulé (la facture redevient due), reprise du
   * crédit d'escompte et frais bancaires sur la banque du bordereau.
   */
  async markUnpaid(paymentId: string, p: { date: string; fees: number; note?: string | null; userId: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      const e = (await c.query(
        `SELECT p.id, p.type, p.payment_method, p.status, p.amount::float8 AS amount, p.cashed_at, p.unpaid_at, p.store_id,
                p.payment_date::text AS payment_date, COALESCE(p.check_number, p.reference, '') AS ref,
                br.kind AS remittance_kind, br.remittance_date::text AS remittance_date, ta.account_code AS bank_code
           FROM payments p
           LEFT JOIN bill_remittances br ON br.id = p.remittance_id AND br.status = 'posted'
           LEFT JOIN treasury_accounts ta ON ta.id = br.treasury_account_id
          WHERE p.id = $1 FOR UPDATE OF p`, [paymentId])).rows[0];
      if (!e) throw fail('Effet introuvable', 404);
      if (e.type !== 'income' || !['check', 'traite'].includes(e.payment_method)) throw fail('Seul un chèque ou une traite client peut être déclaré impayé');
      if (e.unpaid_at) throw fail('Effet déjà déclaré impayé');
      if (e.cashed_at) throw fail(`Effet encaissé le ${fr(String(e.cashed_at).slice(0, 10))} : annulez d'abord l'encaissement`);
      if (e.status !== 'executed') throw fail('Ce règlement est annulé');
      if (p.date < e.payment_date) throw fail('Date d\'impayé antérieure à la réception de l\'effet', 400);
      if (p.fees > 0 && !e.bank_code) throw fail('Des frais d\'impayé supposent un effet remis en banque', 400);
      const reason = (await c.query(`SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND code = 'void_unpaid_bill'`)).rows[0];
      await c.query(`UPDATE payments SET unpaid_at = $2, unpaid_fees = $3 WHERE id = $1`, [paymentId, p.date, r2(p.fees) || null]);
      await paymentRepository.voidPaymentInTx(c, paymentId, { reasonCodeId: reason.id, note: p.note ?? null, userId: p.userId, date: p.date });
      const lines = unpaidBankLines({ amount: e.amount, discounted: e.remittance_kind === 'discount', fees: r2(p.fees), bankCode: e.bank_code ?? '5141', ref: e.ref });
      let entry: { id: string; entry_number: string } | null = null;
      if (lines.length) {
        entry = await postEntry(c, {
          journal: 'BQ', date: p.date, label: `Effet impayé ${e.ref}`.trim(), detail: `bill:unpaid:${paymentId}`,
          userId: p.userId, storeId: e.store_id ?? null, lines,
        });
      }
      await c.query('COMMIT');
      return { entry_number: entry?.entry_number ?? null };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },
};
