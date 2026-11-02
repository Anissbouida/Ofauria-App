/**
 * Saisie libre d'écritures (mig 418) — l'équivalent de la saisie au kilomètre
 * de Sage : brouillon modifiable, puis comptabilisation qui fige l'écriture.
 *
 *   - Le brouillon porte un numéro provisoire « BROUILLON-… » : le vrai numéro
 *     de journal n'est pris qu'à la comptabilisation, un brouillon abandonné ne
 *     laisse donc pas de trou dans la séquence.
 *   - Une écriture comptabilisée ne se modifie plus : elle s'extourne (avec
 *     motif). Seules les écritures manuelles s'extournent ici : celles nées
 *     d'une facture, d'un paiement ou d'une vente se corrigent depuis leur pièce,
 *     sinon la pièce et le grand livre divergeraient.
 */
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { extourneEntryById } from '../services/journal-generator.service.js';

export type ManualLineInput = {
  accountId: string; auxiliaryId?: string | null;
  debit: number; credit: number; label?: string | null;
};
export type ManualEntryInput = {
  journalCode: string; date: string; description: string;
  pieceRef?: string | null; pieceDate?: string | null;
  lines: ManualLineInput[];
};
type Actor = { userId: string; storeId: string | null };

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const cents = (v: number) => Math.round((Number(v) || 0) * 100);

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

/**
 * Contrôles d'une saisie : journal permis, période ouverte, au moins deux
 * lignes, chaque ligne au débit OU au crédit, tiers obligatoire (et cohérent)
 * sur un compte collectif, écriture équilibrée et non nulle.
 * Renvoie le journal et la période retenus.
 */
async function check(c: PoolClient, input: ManualEntryInput) {
  const description = input.description?.trim();
  if (!description) throw fail('Libellé de l\'écriture obligatoire');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw fail('Date invalide');
  const jr = (await c.query(`SELECT id, code, kind, is_active FROM journals WHERE code = $1`, [input.journalCode])).rows[0];
  if (!jr || !jr.is_active) throw fail(`Journal ${input.journalCode} introuvable ou inactif`);
  if (jr.kind === 'opening') throw fail('Le journal des à-nouveaux est réservé à la clôture d\'exercice');

  const periodId = (await c.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [input.date])).rows[0].id;
  const period = (await c.query(`SELECT status, month, year FROM fiscal_periods WHERE id = $1`, [periodId])).rows[0];
  if (period.status !== 'open') {
    throw fail(`Période ${String(period.month).padStart(2, '0')}/${period.year} ${period.status === 'locked' ? 'verrouillée' : 'clôturée'} : datez l'écriture dans une période ouverte`, 409);
  }

  if (!Array.isArray(input.lines) || input.lines.length < 2) throw fail('Une écriture compte au moins deux lignes');
  const accounts = new Map<string, { code: string; is_collective: boolean; is_active: boolean }>(
    (await c.query(`SELECT id, code, is_collective, is_active FROM accounts WHERE id = ANY($1::uuid[])`,
      [input.lines.map(l => l.accountId)])).rows.map((a: { id: string; code: string; is_collective: boolean; is_active: boolean }) => [a.id, a]));
  const auxIds = input.lines.map(l => l.auxiliaryId).filter((x): x is string => !!x);
  const auxs = new Map<string, string>(auxIds.length
    ? (await c.query(`SELECT id, account_id FROM account_auxiliaries WHERE id = ANY($1::uuid[])`, [auxIds])).rows
        .map((x: { id: string; account_id: string }) => [x.id, x.account_id])
    : []);
  let d = 0, cr = 0;
  input.lines.forEach((l, i) => {
    const n = i + 1;
    const a = accounts.get(l.accountId);
    if (!a || !a.is_active) throw fail(`Ligne ${n} : compte introuvable ou inactif`);
    const ld = cents(l.debit), lc = cents(l.credit);
    if (ld < 0 || lc < 0) throw fail(`Ligne ${n} : montant négatif`);
    if ((ld > 0) === (lc > 0)) throw fail(`Ligne ${n} : un montant au débit OU au crédit`);
    if (a.is_collective) {
      if (!l.auxiliaryId) throw fail(`Ligne ${n} : le compte ${a.code} est collectif, précisez le tiers`);
      if (auxs.get(l.auxiliaryId) !== l.accountId) throw fail(`Ligne ${n} : ce tiers n'appartient pas au compte ${a.code}`);
    } else if (l.auxiliaryId) {
      throw fail(`Ligne ${n} : le compte ${a.code} n'est pas un compte de tiers`);
    }
    d += ld; cr += lc;
  });
  if (d !== cr) throw fail(`Écriture déséquilibrée : débit ${(d / 100).toFixed(2)}, crédit ${(cr / 100).toFixed(2)}`);
  return { journalId: jr.id as string, periodId: periodId as string, description: description.slice(0, 2000) };
}

async function writeLines(c: PoolClient, entryId: string, lines: ManualLineInput[], fallbackLabel: string) {
  let order = 0;
  for (const l of lines) {
    await c.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entryId, ++order, l.accountId, l.auxiliaryId || null, cents(l.debit) / 100, cents(l.credit) / 100,
       (l.label?.trim() || fallbackLabel).slice(0, 200)]);
  }
}

/** Écriture de saisie libre encore en brouillon, verrouillée pour la transaction. */
async function lockDraft(c: PoolClient, id: string) {
  const e = (await c.query(
    `SELECT id, status, source_kind, source_detail, journal_id, entry_date FROM journal_entries WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!e) throw fail('Écriture introuvable', 404);
  if (e.status !== 'draft' || e.source_kind !== 'manual' || e.source_detail !== 'saisie') {
    throw fail('Seul un brouillon de saisie libre se modifie, se comptabilise ou se supprime ici', 409);
  }
  return e;
}

async function createDraftTx(c: PoolClient, input: ManualEntryInput, actor: Actor): Promise<string> {
  const k = await check(c, input);
  const id = (await c.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_detail, status, store_id, created_by, piece_ref, piece_date)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'saisie', 'draft', $6, $7, $8, $9) RETURNING id`,
    [`BROUILLON-${crypto.randomUUID().slice(0, 8)}`, k.journalId, input.date, k.periodId, k.description,
     actor.storeId, actor.userId, input.pieceRef?.trim() || null, input.pieceDate || null])).rows[0].id as string;
  await writeLines(c, id, input.lines, k.description);
  return id;
}

/** Comptabilise : contrôles rejoués sur l'état en base, numéro définitif, figeage (triggers). */
async function postTx(c: PoolClient, id: string, actor: Actor) {
  const e = await lockDraft(c, id);
  const head = (await c.query(
    `SELECT j.code, je.entry_date::text AS date, je.description, je.piece_ref, je.piece_date::text AS piece_date
       FROM journal_entries je JOIN journals j ON j.id = je.journal_id WHERE je.id = $1`, [id])).rows[0];
  const lines = (await c.query(
    `SELECT account_id, auxiliary_id, debit, credit, label FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_order`, [id])).rows;
  await check(c, {
    journalCode: head.code, date: head.date, description: head.description, pieceRef: head.piece_ref, pieceDate: head.piece_date,
    lines: lines.map((l: { account_id: string; auxiliary_id: string | null; debit: string; credit: string; label: string | null }) => ({
      accountId: l.account_id, auxiliaryId: l.auxiliary_id, debit: Number(l.debit), credit: Number(l.credit), label: l.label })),
  });
  const year = Number(String(head.date).slice(0, 4));
  const num = (await c.query(`SELECT next_entry_number($1, $2::smallint) AS n`, [e.journal_id, year])).rows[0].n as string;
  await c.query(
    `UPDATE journal_entries SET entry_number = $2, status = 'posted', posted_at = now(), posted_by = $3 WHERE id = $1`,
    [id, num, actor.userId]);
  return { id, entry_number: num };
}

export const manualEntryRepository = {
  createDraft(input: ManualEntryInput, actor: Actor) {
    return withTx(actor.userId, async c => ({ id: await createDraftTx(c, input, actor) }));
  },

  /** Saisie validée d'un coup (bouton « Comptabiliser » de l'éditeur). */
  createAndPost(input: ManualEntryInput, actor: Actor) {
    return withTx(actor.userId, async c => postTx(c, await createDraftTx(c, input, actor), actor));
  },

  updateDraft(id: string, input: ManualEntryInput, actor: Actor) {
    return withTx(actor.userId, async c => {
      await lockDraft(c, id);
      const k = await check(c, input);
      await c.query(
        `UPDATE journal_entries SET journal_id = $2, entry_date = $3, fiscal_period_id = $4, description = $5,
                piece_ref = $6, piece_date = $7 WHERE id = $1`,
        [id, k.journalId, input.date, k.periodId, k.description, input.pieceRef?.trim() || null, input.pieceDate || null]);
      await c.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`, [id]);
      await writeLines(c, id, input.lines, k.description);
      return { id };
    });
  },

  post(id: string, actor: Actor) {
    return withTx(actor.userId, c => postTx(c, id, actor));
  },

  deleteDraft(id: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      await lockDraft(c, id);
      await c.query(`DELETE FROM journal_entries WHERE id = $1`, [id]);   // lignes en cascade, trace draft_delete
      return { id };
    });
  },

  /** Extourne d'une écriture manuelle comptabilisée, datée et motivée. */
  reverse(id: string, p: { date?: string | null; reason: string }, actor: Actor) {
    return withTx(actor.userId, async c => {
      const e = (await c.query(`SELECT status, source_kind, source_detail, entry_number FROM journal_entries WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!e) throw fail('Écriture introuvable', 404);
      if (e.status !== 'posted') throw fail(`Écriture ${e.entry_number} : seule une écriture comptabilisée non extournée s'extourne`, 409);
      if (e.source_kind !== 'manual') {
        throw fail(`Écriture ${e.entry_number} générée par une pièce (${e.source_kind}) : corrigez ou annulez la pièce elle-même`, 409);
      }
      // Dotations et cessions d'immobilisations (mig 427) : elles s'annulent depuis Immobilisations.
      if (e.source_detail === 'cession' || String(e.source_detail ?? '').startsWith('depr:')) {
        throw fail(`Écriture ${e.entry_number} d'immobilisation : annulez-la depuis Comptabilité › Immobilisations`, 409);
      }
      // IS (mig 430) : acomptes, charge et solde s'annulent depuis l'écran IS.
      if (String(e.source_detail ?? '').startsWith('is:')) {
        throw fail(`Écriture ${e.entry_number} d'impôt sur les sociétés : annulez-la depuis Comptabilité › Impôt sur les sociétés`, 409);
      }
      // Réévaluation des devises (mig 431) : écriture du 31/12 et contre-passation s'annulent ensemble.
      if (String(e.source_detail ?? '').startsWith('fx:')) {
        throw fail(`Écriture ${e.entry_number} de réévaluation des devises : annulez-la depuis Comptabilité › Écarts de change`, 409);
      }
      await extourneEntryById(c, id, p.date || undefined, { userId: actor.userId, reason: p.reason.trim() });
      const rev = (await c.query(
        `SELECT r.id, r.entry_number FROM journal_entries o JOIN journal_entries r ON r.id = o.reversed_by_entry_id WHERE o.id = $1`, [id])).rows[0];
      return { id, reversal_id: rev?.id ?? null, reversal_number: rev?.entry_number ?? null };
    });
  },
};
