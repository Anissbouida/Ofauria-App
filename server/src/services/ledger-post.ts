/**
 * Écriture validée posée par un module métier (bordereaux d'effets, liaisons
 * entre établissements…) : numéro pris à la validation, période ouverte
 * exigée, source « manual » repérée par source_detail (extourne manuelle
 * contrôlée par chaque module).
 */
import type { PoolClient } from 'pg';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fr = (d: string) => d.split('-').reverse().join('/');

export type PostLine = { code: string; debit: number; credit: number; label: string };

export async function postManualEntry(c: PoolClient, p: {
  journal: 'BQ' | 'OD' | 'CA'; date: string; label: string; detail: string; userId: string; storeId: string | null; lines: PostLine[];
}) {
  // Deux requêtes : la période créée par fn_ensure_fiscal_period n'est pas visible du SELECT qui l'appelle.
  const periodId = (await c.query(`SELECT fn_ensure_fiscal_period($1::date) AS id`, [p.date])).rows[0].id;
  const period = (await c.query(`SELECT id, status FROM fiscal_periods WHERE id = $1`, [periodId])).rows[0];
  if (period.status !== 'open') {
    throw Object.assign(new Error(`Période du ${fr(p.date)} fermée : choisissez une date dans une période ouverte`), { statusCode: 409 });
  }
  const jrn = (await c.query(`SELECT id FROM journals WHERE code = $1`, [p.journal])).rows[0].id;
  const num = (await c.query(`SELECT next_entry_number($1, $2::smallint) AS n`, [jrn, Number(p.date.slice(0, 4))])).rows[0].n as string;
  const ids = new Map<string, string>((await c.query(`SELECT id, code FROM accounts WHERE code = ANY($1::text[])`, [p.lines.map(l => l.code)])).rows
    .map((r: { id: string; code: string }) => [r.code, r.id]));
  const id = (await c.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_detail, status, created_by, store_id)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'draft', $7, $8) RETURNING id`,
    [num, jrn, p.date, period.id, p.label, p.detail, p.userId, p.storeId])).rows[0].id as string;
  let order = 0;
  for (const l of p.lines.filter(x => x.debit > 0 || x.credit > 0)) {
    await c.query(`INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ++order, ids.get(l.code), r2(l.debit), r2(l.credit), l.label.slice(0, 200)]);
  }
  await c.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [id, p.userId]);
  return { id, entry_number: num };
}
