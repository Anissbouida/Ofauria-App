import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Modèles d'écritures comptables (mig 391) : structure réutilisable (journal,
 * comptes, sens, montants par défaut) que l'on instancie à une date pour poser
 * une OD manuelle équilibrée au grand livre.
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TemplateLineInput = { accountId: string; side: 'debit' | 'credit'; amount: number; label?: string | null };
export type TemplateInput = { name: string; journalCode?: string; description?: string | null; lines: TemplateLineInput[] };

function validateLines(lines: TemplateLineInput[]): string | null {
  if (!lines || lines.length < 2) return 'Un modèle doit avoir au moins deux lignes';
  let debit = 0, credit = 0;
  for (const l of lines) {
    if (!l.accountId) return 'Chaque ligne doit avoir un compte';
    const a = round2(Number(l.amount) || 0);
    if (a < 0) return 'Montant négatif';
    if (l.side === 'debit') debit += a; else credit += a;
  }
  if (round2(debit) <= 0) return 'Le total doit être supérieur à zéro';
  if (Math.abs(round2(debit) - round2(credit)) > 0.005) return `Déséquilibre : débit ${round2(debit)} ≠ crédit ${round2(credit)}`;
  return null;
}

export const journalTemplateRepository = {
  async list(storeId?: string | null) {
    const params: unknown[] = [];
    let where = '';
    if (storeId) { params.push(storeId); where = `WHERE (t.store_id IS NULL OR t.store_id = $1)`; }
    const r = await db.query(
      `SELECT t.*, j.label AS journal_name,
              (SELECT COUNT(*) FROM journal_entry_template_lines l WHERE l.template_id = t.id)::int AS line_count,
              (SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'debit'), 0) FROM journal_entry_template_lines l WHERE l.template_id = t.id)::float8 AS total_debit
         FROM journal_entry_templates t
         LEFT JOIN journals j ON j.code = t.journal_code
         ${where}
        ORDER BY t.is_active DESC, t.name`, params);
    return r.rows;
  },

  async getById(id: string) {
    const t = (await db.query(
      `SELECT t.*, j.label AS journal_name FROM journal_entry_templates t LEFT JOIN journals j ON j.code = t.journal_code WHERE t.id = $1`, [id])).rows[0];
    if (!t) return null;
    const lines = (await db.query(
      `SELECT l.id, l.line_order, l.account_id, l.side, l.amount::float8 AS amount, l.label,
              a.code AS account_code, a.label AS account_name
         FROM journal_entry_template_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.template_id = $1 ORDER BY l.line_order, a.code`, [id])).rows;
    return { ...t, lines };
  },

  async create(input: TemplateInput, ctx: { userId: string | null; storeId: string | null }) {
    const err = validateLines(input.lines);
    if (err) return { error: err };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const id = (await client.query(
        `INSERT INTO journal_entry_templates (name, journal_code, description, store_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.name.trim().slice(0, 160), (input.journalCode || 'OD').trim(), input.description?.trim() || null, ctx.storeId, ctx.userId])).rows[0].id;
      await this._replaceLines(client, id, input.lines);
      await client.query('COMMIT');
      return { id };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  async update(id: string, input: TemplateInput) {
    const err = validateLines(input.lines);
    if (err) return { error: err };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const upd = (await client.query(
        `UPDATE journal_entry_templates SET name = $2, journal_code = $3, description = $4 WHERE id = $1 RETURNING id`,
        [id, input.name.trim().slice(0, 160), (input.journalCode || 'OD').trim(), input.description?.trim() || null])).rows[0];
      if (!upd) { await client.query('ROLLBACK'); return { error: 'Modèle introuvable' }; }
      await client.query(`DELETE FROM journal_entry_template_lines WHERE template_id = $1`, [id]);
      await this._replaceLines(client, id, input.lines);
      await client.query('COMMIT');
      return { id };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  async _replaceLines(client: PoolClient, templateId: string, lines: TemplateLineInput[]) {
    let order = 0;
    for (const l of lines) {
      order += 1;
      await client.query(
        `INSERT INTO journal_entry_template_lines (template_id, line_order, account_id, side, amount, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [templateId, order, l.accountId, l.side, round2(Number(l.amount) || 0), l.label?.trim() || null]);
    }
  },

  async setActive(id: string, active: boolean) {
    const r = await db.query(`UPDATE journal_entry_templates SET is_active = $2 WHERE id = $1 RETURNING id`, [id, active]);
    return r.rows[0] ?? null;
  },

  async remove(id: string) {
    await db.query(`DELETE FROM journal_entry_templates WHERE id = $1`, [id]);
  },

  /**
   * Instancie le modèle : crée une écriture manuelle équilibrée et la pose au
   * grand livre. `amounts` (par id de ligne de modèle) surcharge les montants ;
   * le sens et les comptes restent ceux du modèle.
   */
  async instantiate(id: string, p: { date: string; label?: string | null; amounts?: Record<string, number>; storeId: string | null; userId: string | null }) {
    const tpl = await this.getById(id);
    if (!tpl) return { error: 'Modèle introuvable' };
    if (!tpl.is_active) return { error: 'Modèle inactif' };

    // Applique les surcharges de montant, garde le sens/compte du modèle.
    const effLines: TemplateLineInput[] = tpl.lines.map((l: { id: string; account_id: string; side: 'debit' | 'credit'; amount: number; label: string | null }) => ({
      accountId: l.account_id, side: l.side,
      amount: p.amounts && p.amounts[l.id] !== undefined ? round2(Number(p.amounts[l.id]) || 0) : round2(Number(l.amount) || 0),
      label: l.label,
    }));
    const err = validateLines(effLines);
    if (err) return { error: err };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const accDate = (await client.query(`SELECT fn_accounting_date($1::date)::text AS d`, [p.date])).rows[0].d as string;
      const fp = (await client.query(
        `SELECT id FROM fiscal_periods WHERE $1::date BETWEEN start_date AND end_date AND status = 'open' LIMIT 1`, [accDate])).rows[0];
      if (!fp) { await client.query('ROLLBACK'); return { error: `Aucune période fiscale ouverte pour ${accDate}` }; }
      const jrn = (await client.query(`SELECT id FROM journals WHERE code = $1`, [tpl.journal_code])).rows[0];
      if (!jrn) { await client.query('ROLLBACK'); return { error: `Journal ${tpl.journal_code} introuvable` }; }
      const year = parseInt(accDate.slice(0, 4), 10);
      const num = (await client.query('SELECT next_entry_number($1, $2) AS num', [jrn.id, year])).rows[0].num as string;
      const label = (p.label?.trim() || tpl.name).slice(0, 200);

      const entryId = (await client.query(
        `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
           source_kind, source_id, source_detail, status, store_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'manual',NULL,$6,'draft',$7,$8) RETURNING id`,
        [num, jrn.id, accDate, fp.id, label, `template:${id}`, p.storeId, p.userId])).rows[0].id as string;

      let order = 0;
      for (const l of effLines) {
        order += 1;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [entryId, order, l.accountId, l.side === 'debit' ? l.amount : 0, l.side === 'credit' ? l.amount : 0, l.label || label]);
      }
      // Passage en posted : déclenche le contrôle d'équilibre (trigger).
      await client.query(`UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`, [entryId, p.userId]);
      await client.query('COMMIT');
      return { id: entryId, entry_number: num };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },
};
