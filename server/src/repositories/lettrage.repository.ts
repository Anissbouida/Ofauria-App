/**
 * Lettrage manuel (mig 420) — l'écran « Lettrage » de Sage : on rapproche, sur
 * un compte de tiers, les factures et les règlements qui se soldent ; ce qui
 * reste non lettré est ce qui reste dû.
 *
 *   - Comptes lettrables : comptes collectifs (clients, fournisseurs, par tiers)
 *     et comptes de créances/dettes 34xx et 44xx (avances, salaires, GR/IR…).
 *     La banque se rapproche dans l'onglet Banque, pas ici.
 *   - Un groupe = un compte, un tiers, au moins deux lignes, soldé au centime
 *     (vérifié ici, puis par la base au COMMIT : trg_lettrage_coherence).
 *   - Le lettrage d'un exercice clôturé est figé : son solde non lettré a été
 *     repris en à-nouveaux, c'est la ligne d'AN qui se lettre ensuite.
 *   - Chaque ligne lettrée ou délettrée est tracée dans ledger_audit_log
 *     (trigger de la mig 413), au nom de l'utilisateur.
 *   - Lettrage automatique : une facture avec ses règlements, d'après le lien
 *     des pièces (payments.invoice_id), quand l'ensemble se solde exactement.
 *     Rattrape notamment l'historique repris (écritures « backfill »), que la
 *     reprise ne lettrait pas.
 */
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { letterCode } from '../services/fec.service.js';
import { autoLettrer } from '../services/journal-generator.service.js';

type Actor = { userId: string };
export type LettrageStatus = 'open' | 'lettered' | 'all';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const cents = (v: string | number) => Math.round((Number(v) || 0) * 100);

/** Comptes lettrables (prédicat SQL sur l'alias a). */
const LETTRABLE_SQL = `(a.is_collective OR a.code LIKE '34%' OR a.code LIKE '44%')`;
/** Lignes qui comptent : écritures comptabilisées (une extourne garde son original). */
const POSTED_SQL = `je.status IN ('posted', 'reversed')`;

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

/** Dernier jour du dernier exercice clôturé (null si aucun). */
async function closedUntil(c: PoolClient | typeof db): Promise<{ end: string | null; year: number | null }> {
  const r = (await c.query(
    `SELECT end_date::text AS end, year FROM fiscal_years WHERE status = 'closed' ORDER BY end_date DESC LIMIT 1`)).rows[0];
  return { end: r?.end ?? null, year: r?.year ?? null };
}

type LineRow = {
  id: string; lettrage_id: string | null; debit: string; credit: string; label: string | null;
  entry_id: string; entry_number: string; entry_date: string; description: string; piece_ref: string | null;
  source_kind: string; status: string; journal_code: string;
  rank: number | null; lettered_at: string | null; frozen: boolean;
};

type LockedLine = {
  id: string; account_id: string; auxiliary_id: string | null; debit: string; credit: string;
  lettrage_id: string | null; status: string; entry_date: string; entry_number: string;
  code: string; lettrable: boolean;
};

function assertNotClosed(rows: LockedLine[], closed: { end: string | null; year: number | null }) {
  if (!closed.end) return;
  const old = rows.find(r => r.entry_date <= closed.end!);
  if (old) {
    throw fail(`Écriture ${old.entry_number} datée dans l'exercice ${closed.year} clôturé : son lettrage est figé `
      + `(le solde non lettré a été repris en à-nouveaux, lettrez la ligne d'à-nouveaux)`, 409);
  }
}

export const lettrageRepository = {
  /** Comptes lettrables qui ont des lignes, avec ce qui reste à lettrer. */
  async accounts() {
    const r = await db.query(
      `SELECT a.id, a.code, a.label, a.is_collective, a.auxiliary_kind,
              count(jel.id)::int AS lines,
              (count(jel.id) FILTER (WHERE jel.lettrage_id IS NULL))::int AS open_lines,
              COALESCE(sum(jel.debit - jel.credit) FILTER (WHERE jel.lettrage_id IS NULL), 0) AS open_balance
         FROM accounts a
         JOIN journal_entry_lines jel ON jel.account_id = a.id
         JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${POSTED_SQL}
        WHERE ${LETTRABLE_SQL}
        GROUP BY a.id
        ORDER BY a.code`);
    return r.rows;
  },

  /** Tiers d'un compte collectif, avec leurs lignes non lettrées. */
  async tiers(accountId: string) {
    const r = await db.query(
      `SELECT ax.id, ax.code, ax.label,
              count(jel.id)::int AS lines,
              (count(jel.id) FILTER (WHERE jel.lettrage_id IS NULL))::int AS open_lines,
              COALESCE(sum(jel.debit - jel.credit) FILTER (WHERE jel.lettrage_id IS NULL), 0) AS open_balance
         FROM account_auxiliaries ax
         JOIN journal_entry_lines jel ON jel.auxiliary_id = ax.id AND jel.account_id = ax.account_id
         JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${POSTED_SQL}
        WHERE ax.account_id = $1
        GROUP BY ax.id
        ORDER BY (count(jel.id) FILTER (WHERE jel.lettrage_id IS NULL)) > 0 DESC, ax.label`,
      [accountId]);
    return r.rows;
  },

  /**
   * Lignes d'un compte (et d'un tiers pour un collectif), avec leur code de
   * lettrage (A, B… par ordre de première date, propre à ce compte et ce tiers)
   * et le drapeau « figé » pour un exercice clôturé.
   */
  async lines(p: { accountId: string; auxiliaryId?: string | null; status: LettrageStatus; from?: string; to?: string }) {
    const acc = (await db.query(
      `SELECT a.id, a.code, a.label, a.is_collective, ${LETTRABLE_SQL} AS lettrable FROM accounts a WHERE a.id = $1`,
      [p.accountId])).rows[0];
    if (!acc) throw fail('Compte introuvable', 404);
    if (!acc.lettrable) throw fail(`Le compte ${acc.code} ne se lettre pas (comptes de tiers 34xx/44xx seulement)`);
    if (acc.is_collective && !p.auxiliaryId) throw fail(`Le compte ${acc.code} est collectif : choisissez le tiers`);
    const closed = await closedUntil(db);
    const r = await db.query(
      `WITH scope AS (
         SELECT jel.id, jel.line_order, jel.lettrage_id, jel.debit, jel.credit, jel.label,
                je.id AS entry_id, je.entry_number, je.entry_date, je.description, je.piece_ref,
                je.source_kind, je.status, j.code AS journal_code
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${POSTED_SQL}
           JOIN journals j ON j.id = je.journal_id
          WHERE jel.account_id = $1 AND jel.auxiliary_id IS NOT DISTINCT FROM $2::uuid),
       grp AS (
         SELECT lettrage_id, row_number() OVER (ORDER BY min(entry_date), lettrage_id) AS rk
           FROM scope WHERE lettrage_id IS NOT NULL GROUP BY lettrage_id),
       aud AS (
         SELECT lettrage_id, max(at) AS at FROM ledger_audit_log
          WHERE event = 'letter' AND lettrage_id IN (SELECT lettrage_id FROM grp) GROUP BY lettrage_id)
       SELECT s.id, s.lettrage_id, s.debit, s.credit, s.label, s.entry_id, s.entry_number,
              s.entry_date::text AS entry_date, s.description, s.piece_ref, s.source_kind, s.status, s.journal_code,
              grp.rk::int AS rank, aud.at AS lettered_at,
              ($6::date IS NOT NULL AND s.entry_date <= $6::date) AS frozen
         FROM scope s
         LEFT JOIN grp ON grp.lettrage_id = s.lettrage_id
         LEFT JOIN aud ON aud.lettrage_id = s.lettrage_id
        WHERE ($3 = 'all' OR ($3 = 'open') = (s.lettrage_id IS NULL))
          AND ($4::date IS NULL OR s.entry_date >= $4::date)
          AND ($5::date IS NULL OR s.entry_date <= $5::date)
        ORDER BY s.entry_date, s.entry_number, s.line_order
        LIMIT 3000`,
      [p.accountId, p.auxiliaryId || null, p.status, p.from || null, p.to || null, closed.end]);
    const lines = (r.rows as LineRow[]).map(l => ({ ...l, code: l.rank ? letterCode(l.rank) : null }));
    const tot = (await db.query(
      `SELECT COALESCE(sum(jel.debit) FILTER (WHERE jel.lettrage_id IS NULL), 0) AS open_debit,
              COALESCE(sum(jel.credit) FILTER (WHERE jel.lettrage_id IS NULL), 0) AS open_credit,
              (count(*) FILTER (WHERE jel.lettrage_id IS NULL))::int AS open_lines,
              count(DISTINCT jel.lettrage_id)::int AS groups
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${POSTED_SQL}
        WHERE jel.account_id = $1 AND jel.auxiliary_id IS NOT DISTINCT FROM $2::uuid`,
      [p.accountId, p.auxiliaryId || null])).rows[0];
    return { account: { id: acc.id, code: acc.code, label: acc.label, is_collective: acc.is_collective },
             closed_until: closed.end, totals: tot, lines, truncated: r.rows.length === 3000 };
  },

  /** Lettre un ensemble de lignes qui se soldent. */
  letter(lineIds: string[], actor: Actor) {
    return withTx(actor.userId, async c => {
      const ids = [...new Set(lineIds)];
      if (ids.length < 2) throw fail('Sélectionnez au moins deux lignes à lettrer');
      const rows = (await c.query(
        `SELECT jel.id, jel.account_id, jel.auxiliary_id, jel.debit, jel.credit, jel.lettrage_id,
                je.status, je.entry_date::text AS entry_date, je.entry_number, a.code, ${LETTRABLE_SQL} AS lettrable
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           JOIN accounts a ON a.id = jel.account_id
          WHERE jel.id = ANY($1::uuid[])
          ORDER BY jel.id
          FOR UPDATE OF jel`, [ids])).rows as LockedLine[];
      if (rows.length !== ids.length) throw fail('Ligne introuvable', 404);
      const draft = rows.find(r => r.status !== 'posted' && r.status !== 'reversed');
      if (draft) throw fail(`Écriture ${draft.entry_number} en brouillon : comptabilisez-la avant de la lettrer`, 409);
      const done = rows.find(r => r.lettrage_id);
      if (done) throw fail(`Une ligne de l'écriture ${done.entry_number} est déjà lettrée : délettrez d'abord son groupe`, 409);
      if (new Set(rows.map(r => r.account_id)).size > 1) throw fail('Les lignes lettrées ensemble portent sur un même compte');
      if (!rows[0].lettrable) throw fail(`Le compte ${rows[0].code} ne se lettre pas (comptes de tiers 34xx/44xx seulement)`);
      if (new Set(rows.map(r => r.auxiliary_id ?? '-')).size > 1) throw fail('Les lignes lettrées ensemble portent sur un même tiers');
      const ecart = rows.reduce((s, r) => s + cents(r.debit) - cents(r.credit), 0);
      if (ecart !== 0) throw fail(`Sélection non soldée : écart de ${(Math.abs(ecart) / 100).toFixed(2)} DH au ${ecart > 0 ? 'débit' : 'crédit'}`);
      assertNotClosed(rows, await closedUntil(c));
      const lettrageId = crypto.randomUUID();
      await c.query(`UPDATE journal_entry_lines SET lettrage_id = $1 WHERE id = ANY($2::uuid[])`, [lettrageId, ids]);
      return { lettrage_id: lettrageId, lines: ids.length };
    });
  },

  /**
   * Lettrage automatique facture ↔ règlements (mêmes lignes et même règle que
   * autoLettrer) sur les factures dont les lignes non lettrées se soldent, sur
   * un seul compte et un seul tiers, hors exercice clôturé. Facultativement
   * limité à un compte et un tiers ; dryRun = compter sans lettrer.
   */
  async autoLetter(p: { accountId?: string; auxiliaryId?: string; dryRun?: boolean }, actor: Actor) {
    const candidates = async (c: PoolClient | typeof db) => {
      const closed = await closedUntil(c);
      return (await c.query(
        `WITH l AS (
           SELECT jel.debit, jel.credit, jel.account_id, jel.auxiliary_id, je.entry_date,
                  COALESCE(i.id, pay.invoice_id) AS inv
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             JOIN accounts a ON a.id = jel.account_id
             LEFT JOIN invoices i ON i.id = je.source_id
             LEFT JOIN payments pay ON pay.id = je.source_id
            WHERE a.code IN ('4411', '3421') AND jel.lettrage_id IS NULL
              AND je.status = 'posted' AND je.source_kind <> 'reversal')
         SELECT inv, count(*)::int AS lines
           FROM l WHERE inv IS NOT NULL
          GROUP BY inv
         HAVING count(*) >= 2 AND sum(debit - credit) = 0
            AND count(DISTINCT account_id) = 1 AND count(DISTINCT COALESCE(auxiliary_id::text, '-')) = 1
            AND ($1::uuid IS NULL OR bool_and(account_id = $1::uuid))
            AND ($2::uuid IS NULL OR bool_and(auxiliary_id = $2::uuid))
            AND ($3::date IS NULL OR min(entry_date) > $3::date)`,
        [p.accountId || null, p.auxiliaryId || null, closed.end])).rows as { inv: string; lines: number }[];
    };
    if (p.dryRun) {
      const rows = await candidates(db);
      return { invoices: rows.length, lines: rows.reduce((s, r) => s + r.lines, 0) };
    }
    return withTx(actor.userId, async c => {
      let invoices = 0, lines = 0;
      for (const r of await candidates(c)) {
        const out = await autoLettrer(c, r.inv);
        if (out.lettered) { invoices++; lines += out.lineCount ?? 0; }
      }
      return { invoices, lines };
    });
  },

  /** Délettre un groupe entier (jamais une partie : le reste ne serait plus soldé). */
  unletter(lettrageId: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const rows = (await c.query(
        `SELECT jel.id, jel.account_id, jel.auxiliary_id, jel.debit, jel.credit, jel.lettrage_id,
                je.status, je.entry_date::text AS entry_date, je.entry_number, a.code, true AS lettrable
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           JOIN accounts a ON a.id = jel.account_id
          WHERE jel.lettrage_id = $1
          ORDER BY jel.id
          FOR UPDATE OF jel`, [lettrageId])).rows as LockedLine[];
      if (!rows.length) throw fail('Lettrage introuvable', 404);
      assertNotClosed(rows, await closedUntil(c));
      await c.query(`UPDATE journal_entry_lines SET lettrage_id = NULL WHERE lettrage_id = $1`, [lettrageId]);
      return { lettrage_id: lettrageId, lines: rows.length };
    });
  },
};
