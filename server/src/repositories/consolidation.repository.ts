/**
 * Consolidation multi-établissements (lot Bonus 17, mig 437) : soldes par
 * établissement lus dans un même instantané, mis en forme par
 * consolidation.rules, et transferts entre établissements par le compte de
 * liaison 1811 (deux écritures OD liées par source_detail 'liaison:<id>').
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { consolidate, transferEntries, isLiaison, type EstablishmentInput } from '../services/consolidation.rules.js';
import type { AccountBalance } from '../services/liasse.rules.js';
import { postManualEntry } from '../services/ledger-post.js';
import { extourneEntryById } from '../services/journal-generator.service.js';
import { withActor } from '../services/document-actions.service.js';
import { liasseRepository } from './liasse.repository.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const COMMON = 'common';

async function balancesByStore(c: PoolClient, year: number) {
  const end = `${year}-12-31`;
  const w = (await c.query(
    `SELECT fn_ledger_window_start($1::date, 1)::text AS bilan, fn_ledger_window_start($1::date, 6)::text AS gestion`, [end])).rows[0];
  const start = w.gestion === '-infinity' || w.gestion < `${year}-01-01` ? `${year}-01-01` : w.gestion;
  const rows = (sql: string, args: unknown[]) => c.query(sql, args).then(r => r.rows as (AccountBalance & { store_id: string | null })[]);
  const bil = await rows(
    `SELECT je.store_id, a.code, a.label, sum(jel.debit - jel.credit)::float8 AS balance
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND je.entry_date <= $1::date AND je.entry_date >= $2::date AND a.account_class BETWEEN 1 AND 5
      GROUP BY 1, 2, 3 HAVING sum(jel.debit - jel.credit) <> 0`, [end, w.bilan]);
  const ges = await rows(
    `SELECT je.store_id, a.code, a.label, sum(jel.debit - jel.credit)::float8 AS balance
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening' AND je.entry_date BETWEEN $1::date AND $2::date
        AND a.account_class IN (6, 7)
      GROUP BY 1, 2, 3 HAVING sum(jel.debit - jel.credit) <> 0`, [start, end]);
  const prior = (await c.query(
    `SELECT je.store_id, COALESCE(sum(jel.credit - jel.debit), 0)::float8 AS s
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND a.account_class IN (6, 7) AND je.entry_date >= $1::date AND je.entry_date < $2::date
      GROUP BY 1`, [w.bilan, start])).rows as { store_id: string | null; s: number }[];
  return { bil, ges, prior };
}

export const consolidationRepository = {
  /** Bilan et CPC par établissement, liaisons éliminées, combiné rapproché de la liasse de la société. */
  async build(year: number) {
    const c = await db.getClient();
    let data;
    let stores: { id: string; name: string }[];
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      data = await balancesByStore(c, year);
      stores = (await c.query(`SELECT id, name FROM stores ORDER BY name`)).rows;
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
    const keyOf = (s: string | null) => s ?? COMMON;
    const used = new Set([...data.bil, ...data.ges].map(b => keyOf(b.store_id)));
    const establishments: EstablishmentInput[] = [
      ...stores.filter(s => used.has(s.id)).map(s => ({ key: s.id, label: s.name })),
      ...(used.has(COMMON) ? [{ key: COMMON, label: 'Écritures communes (siège)' }] : []),
    ].map(e => ({
      ...e,
      bil: data.bil.filter(b => keyOf(b.store_id) === e.key).map(({ store_id: _s, ...b }) => b),
      ges: data.ges.filter(b => keyOf(b.store_id) === e.key).map(({ store_id: _s, ...b }) => b),
      prior: r2(data.prior.filter(p => keyOf(p.store_id) === e.key).reduce((s, p) => s + p.s, 0)),
    }));
    const res = consolidate(establishments);
    // Rapprochement avec la liasse de la société (mêmes écritures, sans découpage).
    const company = await liasseRepository.build(year, 'normal');
    const controls = [...res.controls];
    if (Math.abs(company.totals.result - res.combined.result) >= 0.01)
      controls.push({ level: 'error', message: `Résultat combiné (${res.combined.result.toFixed(2)}) différent de la liasse (${company.totals.result.toFixed(2)})` });
    if (Math.abs(company.totals.actif - res.combined.total_actif) >= 0.01 && Math.abs(res.combined.liaison_residual) < 0.01)
      controls.push({ level: 'error', message: `Total actif combiné (${res.combined.total_actif.toFixed(2)}) différent de la liasse (${company.totals.actif.toFixed(2)})` });
    return { year, ...res, controls, company: { actif: company.totals.actif, result: company.totals.result }, transfers: await this.transfers(year) };
  },

  async transfers(year: number) {
    return (await db.query(
      `SELECT substr(je.source_detail, 9) AS transfer_id, min(je.entry_date)::text AS date, min(je.description) AS label,
              bool_and(je.status = 'posted') AS active,
              max(CASE WHEN jel.debit > 0 AND a.code = '1811' THEN je.store_id::text END) AS from_store_id,
              max(CASE WHEN jel.credit > 0 AND a.code = '1811' THEN je.store_id::text END) AS to_store_id,
              max(CASE WHEN a.code <> '1811' THEN a.code END) AS account_code,
              max(jel.debit)::float8 AS amount, string_agg(DISTINCT je.entry_number, ', ') AS entries
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN accounts a ON a.id = jel.account_id
        WHERE je.source_detail LIKE 'liaison:%' AND EXTRACT(YEAR FROM je.entry_date) = $1
        GROUP BY 1 ORDER BY 2 DESC, 1`, [year])).rows;
  },

  /** Transfert de trésorerie ou de stock d'un établissement à un autre, par le compte de liaison. */
  async transfer(p: { date: string; fromStoreId: string; toStoreId: string; accountCode: string; amount: number; label: string; userId: string }) {
    if (p.fromStoreId === p.toStoreId) throw fail('Choisissez deux établissements différents', 400);
    if (!(p.amount > 0)) throw fail('Montant invalide', 400);
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const stores = (await c.query(`SELECT id, name FROM stores WHERE id = ANY($1::uuid[])`, [[p.fromStoreId, p.toStoreId]])).rows as { id: string; name: string }[];
      const from = stores.find(s => s.id === p.fromStoreId), to = stores.find(s => s.id === p.toStoreId);
      if (!from || !to) throw fail('Établissement introuvable', 404);
      const acc = (await c.query(`SELECT code, account_class, is_active, is_collective FROM accounts WHERE code = $1`, [p.accountCode])).rows[0];
      if (!acc || !acc.is_active || ![3, 5].includes(Number(acc.account_class)) || isLiaison(acc.code) || acc.is_collective)
        throw fail('Compte à transférer : un compte de stock (classe 3) ou de trésorerie (classe 5) actif', 400);
      const id = randomUUID();
      const label = p.label.trim() || `Transfert ${from.name} → ${to.name}`;
      const lines = transferEntries({ amount: p.amount, accountCode: acc.code, fromLabel: from.name, toLabel: to.name, label });
      const a = await postManualEntry(c, { journal: 'OD', date: p.date, label: `${label} (cession)`, detail: `liaison:${id}`, userId: p.userId, storeId: from.id, lines: lines.from });
      const b = await postManualEntry(c, { journal: 'OD', date: p.date, label: `${label} (réception)`, detail: `liaison:${id}`, userId: p.userId, storeId: to.id, lines: lines.to });
      await c.query('COMMIT');
      return { transfer_id: id, entries: [a.entry_number, b.entry_number] };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },

  /** Annule un transfert : extourne des deux écritures, ensemble. */
  async cancelTransfer(transferId: string, p: { userId: string; reason: string }) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      await withActor(c, p.userId);
      const entries = (await c.query(
        `SELECT id FROM journal_entries WHERE source_detail = $1 AND status = 'posted' FOR UPDATE`, [`liaison:${transferId}`])).rows as { id: string }[];
      if (entries.length !== 2) throw fail('Transfert introuvable ou déjà annulé', 404);
      for (const e of entries) await extourneEntryById(c, e.id, undefined, { userId: p.userId, reason: p.reason });
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  },
};
