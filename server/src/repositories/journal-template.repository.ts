import type { PoolClient } from 'pg';
import { db, withTransaction } from '../config/database.js';

/**
 * Modèles d'écritures comptables (mig 391) : structure réutilisable (journal,
 * comptes, sens, montants par défaut) que l'on instancie à une date pour poser
 * une OD manuelle équilibrée au grand livre.
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TemplateLineInput = { accountId: string; side: 'debit' | 'credit'; amount: number; label?: string | null };
export type Recurrence = 'monthly' | 'quarterly' | 'yearly';
export type TemplateInput = {
  name: string; journalCode?: string; description?: string | null; lines: TemplateLineInput[];
  /** G1-09 : périodicité (null = modèle manuel), première échéance et dernière échéance possible. */
  recurrence?: Recurrence | null; firstRunOn?: string | null; endOn?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Périodicité demandée : undefined = ne pas toucher ; null = retirer ; sinon contrôlée. */
function readRecurrence(input: TemplateInput): { error: string } | { set: false } | { set: true; recurrence: Recurrence | null; firstRunOn: string | null; endOn: string | null } {
  if (input.recurrence === undefined) return { set: false };
  if (input.recurrence === null) return { set: true, recurrence: null, firstRunOn: null, endOn: null };
  if (!['monthly', 'quarterly', 'yearly'].includes(input.recurrence)) return { error: 'Périodicité inconnue' };
  if (!input.firstRunOn || !ISO_DATE.test(input.firstRunOn)) return { error: 'Indiquez la date de la première échéance' };
  if (input.endOn && !ISO_DATE.test(input.endOn)) return { error: 'Date de fin invalide' };
  if (input.endOn && input.endOn < input.firstRunOn) return { error: 'La date de fin précède la première échéance' };
  return { set: true, recurrence: input.recurrence, firstRunOn: input.firstRunOn, endOn: input.endOn ?? null };
}

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
    const rec = readRecurrence(input);
    if ('error' in rec) return { error: rec.error };
    return withTransaction(async () => {
      const client = await db.getClient();
      const id = (await client.query(
        `INSERT INTO journal_entry_templates (name, journal_code, description, store_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.name.trim().slice(0, 160), (input.journalCode || 'OD').trim(), input.description?.trim() || null, ctx.storeId, ctx.userId])).rows[0].id;
      await this._replaceLines(client, id, input.lines);
      if (rec.set && rec.recurrence) await this._setRecurrence(client, id, rec.recurrence, rec.firstRunOn!, rec.endOn);
      return { id };
    });
  },

  /** Pose ou retire la périodicité. Changer la périodicité ou la première échéance repart de zéro. */
  async _setRecurrence(client: PoolClient, id: string, recurrence: Recurrence | null, firstRunOn: string | null, endOn: string | null) {
    if (!recurrence) {
      await client.query(
        `UPDATE journal_entry_templates SET recurrence = NULL, recurrence_anchor = NULL, next_run_on = NULL, end_on = NULL WHERE id = $1`, [id]);
      return;
    }
    // Même périodicité et même prochaine échéance : seul la date de fin change, le décompte est gardé.
    await client.query(
      `UPDATE journal_entry_templates SET
              recurrence_anchor = CASE WHEN recurrence = $2 AND next_run_on = $3::date THEN recurrence_anchor ELSE $3::date END,
              run_count         = CASE WHEN recurrence = $2 AND next_run_on = $3::date THEN run_count ELSE 0 END,
              next_run_on = $3::date, recurrence = $2, end_on = $4::date
        WHERE id = $1`, [id, recurrence, firstRunOn, endOn]);
  },

  async update(id: string, input: TemplateInput) {
    const err = validateLines(input.lines);
    if (err) return { error: err };
    const rec = readRecurrence(input);
    if ('error' in rec) return { error: rec.error };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const upd = (await client.query(
        `UPDATE journal_entry_templates SET name = $2, journal_code = $3, description = $4 WHERE id = $1 RETURNING id`,
        [id, input.name.trim().slice(0, 160), (input.journalCode || 'OD').trim(), input.description?.trim() || null])).rows[0];
      if (!upd) { await client.query('ROLLBACK'); return { error: 'Modèle introuvable' }; }
      await client.query(`DELETE FROM journal_entry_template_lines WHERE template_id = $1`, [id]);
      await this._replaceLines(client, id, input.lines);
      if (rec.set) await this._setRecurrence(client, id, rec.recurrence, rec.firstRunOn, rec.endOn);
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

  /**
   * G1-09 — instancie les modèles périodiques dont l'échéance est atteinte (≤ asOf), une
   * écriture par échéance, datée de l'échéance. Chaque échéance passe dans une transaction
   * qui verrouille le modèle : deux passages simultanés ne créent pas deux écritures. Une
   * échéance refusée (période comptable fermée…) n'avance pas le modèle et est rapportée.
   */
  async runRecurring(asOf: string, userId: string | null) {
    const due = (await db.query(
      `SELECT id, name FROM journal_entry_templates
        WHERE is_active AND recurrence IS NOT NULL AND next_run_on IS NOT NULL AND next_run_on <= $1::date
          AND (end_on IS NULL OR next_run_on <= end_on)
        ORDER BY next_run_on, name`, [asOf])).rows as { id: string; name: string }[];
    let posted = 0;
    const errors: string[] = [];
    for (const tpl of due) {
      // Rattrapage : plusieurs échéances manquées sont passées une à une (borné).
      for (let guard = 0; guard < 36; guard++) {
        try {
          const done = await withTransaction(async () => {
            const t = (await db.query(
              `SELECT name, next_run_on::text AS next_run_on, end_on::text AS end_on, store_id
                 FROM journal_entry_templates WHERE id = $1 AND is_active AND recurrence IS NOT NULL FOR UPDATE`, [tpl.id])).rows[0];
            if (!t || !t.next_run_on || t.next_run_on > asOf || (t.end_on && t.next_run_on > t.end_on)) return false;
            const d = t.next_run_on as string;
            const out = await this.instantiate(tpl.id, {
              date: d, label: `${t.name} — ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, storeId: t.store_id, userId });
            if ('error' in out) throw new Error(out.error);
            await db.query(
              `UPDATE journal_entry_templates SET run_count = run_count + 1, last_run_on = next_run_on,
                      next_run_on = (recurrence_anchor + ((run_count + 1) * CASE recurrence
                        WHEN 'monthly' THEN interval '1 month' WHEN 'quarterly' THEN interval '3 months' ELSE interval '1 year' END))::date
                WHERE id = $1`, [tpl.id]);
            return true;
          });
          if (!done) break;
          posted++;
        } catch (e) {
          errors.push(`${tpl.name} : ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }
    return { posted, errors };
  },
};
