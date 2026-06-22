import { db } from '../config/database.js';
import type { PoolClient } from 'pg';

/**
 * Retenues a la source (RAS) : configuration des taux + etat des montants
 * retenus a reverser a la DGI + generation de l'ecriture de reversement.
 *
 * Modele comptable : chaque retenue cree une dette envers l'Etat (credit sur
 * un compte 4452x). Le "a reverser" = solde crediteur non encore reverse de ce
 * compte. Le reversement passe une ecriture 4452x D / banque C.
 */
export const withholdingRepository = {
  /** Liste la configuration des types de RAS (taux modifiables). */
  async listTypes(opts: { includeInactive?: boolean } = {}) {
    const where = opts.includeInactive ? '' : 'WHERE w.is_active = true';
    const result = await db.query(
      `SELECT w.id, w.code, w.label, w.legal_ref, w.rate, w.threshold, w.rate_above,
              w.base, w.echeance_jours, w.is_active, w.notes,
              w.account_id, a.code AS account_code, a.label AS account_label
       FROM withholding_tax_types w
       JOIN accounts a ON a.id = w.account_id
       ${where}
       ORDER BY w.code`
    );
    return result.rows;
  },

  async findByCode(code: string) {
    const result = await db.query(
      `SELECT w.*, a.code AS account_code FROM withholding_tax_types w
       JOIN accounts a ON a.id = w.account_id WHERE w.code = $1`,
      [code]
    );
    return result.rows[0] || null;
  },

  /** Met a jour les parametres modifiables d'un type de RAS. */
  async updateType(id: string, data: {
    rate?: number | null; threshold?: number | null; rateAbove?: number | null;
    base?: string; echeanceJours?: number; isActive?: boolean; notes?: string | null;
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.rate !== undefined) { sets.push(`rate = $${i++}`); values.push(data.rate); }
    if (data.threshold !== undefined) { sets.push(`threshold = $${i++}`); values.push(data.threshold); }
    if (data.rateAbove !== undefined) { sets.push(`rate_above = $${i++}`); values.push(data.rateAbove); }
    if (data.base !== undefined) { sets.push(`base = $${i++}`); values.push(data.base); }
    if (data.echeanceJours !== undefined) { sets.push(`echeance_jours = $${i++}`); values.push(data.echeanceJours); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${i++}`); values.push(data.isActive); }
    if (data.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(data.notes); }
    if (sets.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(
      `UPDATE withholding_tax_types SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    return result.rows[0];
  },

  async findById(id: string) {
    const result = await db.query(`SELECT * FROM withholding_tax_types WHERE id = $1`, [id]);
    return result.rows[0] || null;
  },

  /**
   * Etat des RAS a reverser : pour chaque type, le solde crediteur du compte
   * 4452x sur la periode (montant retenu - deja reverse), avec l'echeance.
   */
  async toRemit(params: { startDate?: string; endDate?: string; storeId?: string }) {
    const where: string[] = [`je.status = 'posted'`];
    const values: unknown[] = [];
    let p = 1;
    if (params.startDate) { values.push(params.startDate); where.push(`je.entry_date >= $${p++}`); }
    if (params.endDate)   { values.push(params.endDate);   where.push(`je.entry_date <= $${p++}`); }
    if (params.storeId)   { values.push(params.storeId);   where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }

    const rows = await db.query(
      `SELECT w.code, w.label, w.legal_ref, w.echeance_jours,
              a.code AS account_code,
              COALESCE(SUM(jel.credit), 0) AS total_retenu,
              COALESCE(SUM(jel.debit), 0)  AS total_reverse,
              COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0) AS a_reverser
       FROM withholding_tax_types w
       JOIN accounts a ON a.id = w.account_id
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${where.join(' AND ')}
       GROUP BY w.code, w.label, w.legal_ref, w.echeance_jours, a.code
       ORDER BY w.code`,
      values
    );

    const total = rows.rows.reduce((s: number, r: { a_reverser: string }) => s + (parseFloat(r.a_reverser) || 0), 0);
    return { lines: rows.rows, total_a_reverser: Math.round(total * 100) / 100 };
  },

  /**
   * Genere l'ecriture de reversement a la DGI pour un type de RAS :
   *   4452x (compte RAS) D  / 5141 ou 5161 C
   * Journal OD. Le montant est celui saisi (en general le solde a reverser).
   */
  async createReversement(params: {
    typeCode: string; amount: number; date: string; method: 'bank' | 'cash';
    storeId: string | null; userId: string;
  }) {
    const type = await this.findByCode(params.typeCode);
    if (!type) throw new Error(`Type de RAS ${params.typeCode} introuvable`);
    if (params.amount <= 0) throw new Error('Montant invalide');

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await persistReversement(client, {
        rasAccountCode: type.account_code,
        treasuryCode: params.method === 'cash' ? '5161' : '5141',
        amount: params.amount,
        date: params.date,
        label: `Reversement DGI — ${type.label}`,
        storeId: params.storeId,
        userId: params.userId,
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

/** Persiste l'ecriture de reversement RAS (445x D / tresorerie C) en journal OD. */
async function persistReversement(
  client: PoolClient,
  p: { rasAccountCode: string; treasuryCode: string; amount: number; date: string;
       label: string; storeId: string | null; userId: string }
): Promise<{ id: string; entry_number: string }> {
  const jrn = await client.query(`SELECT id FROM journals WHERE code = 'OD'`);
  const journalId = jrn.rows[0].id;

  const fp = await client.query(
    `SELECT id, status FROM fiscal_periods WHERE $1::DATE BETWEEN start_date AND end_date LIMIT 1`,
    [p.date]
  );
  if (!fp.rows[0]) throw new Error(`Aucune periode fiscale pour ${p.date}`);
  if (fp.rows[0].status !== 'open') throw new Error(`Periode ${p.date} non ouverte`);

  const year = parseInt(p.date.slice(0, 4), 10);
  const num = await client.query('SELECT next_entry_number($1, $2) AS num', [journalId, year]);

  const acc = await client.query(
    `SELECT id, code FROM accounts WHERE code = ANY($1::text[])`,
    [[p.rasAccountCode, p.treasuryCode]]
  );
  const byCode = new Map<string, string>();
  for (const r of acc.rows) byCode.set(r.code, r.id);

  const ins = await client.query(
    `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
       source_kind, source_id, source_detail, status, store_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'manual',NULL,$6,'draft',$7,$8) RETURNING id`,
    [num.rows[0].num, journalId, p.date, fp.rows[0].id, p.label, `ras-reversement`, p.storeId, p.userId]
  );
  const entryId = ins.rows[0].id;

  await client.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label)
     VALUES ($1, 1, $2, $3, 0, $4), ($1, 2, $5, 0, $3, $6)`,
    [entryId, byCode.get(p.rasAccountCode), p.amount, 'Reversement RAS', byCode.get(p.treasuryCode), 'Sortie tresorerie']
  );

  await client.query(
    `UPDATE journal_entries SET status = 'posted', posted_at = NOW(), posted_by = $2 WHERE id = $1`,
    [entryId, p.userId]
  );
  return { id: entryId, entry_number: num.rows[0].num };
}
