import { db } from '../config/database.js';

/**
 * Rapprochement bancaire : pointe les lignes d'un releve bancaire contre les
 * lignes d'ecriture du compte de tresorerie (5141 par defaut).
 *
 * Convention de sens :
 *   - releve 'in'  (encaissement) <-> ligne d'ecriture 5141 au DEBIT
 *   - releve 'out' (decaissement) <-> ligne d'ecriture 5141 au CREDIT
 */
export const bankReconciliationRepository = {
  /** Cree un releve + ses lignes en une transaction. */
  async createStatement(data: {
    label: string;
    accountCode: string;
    statementDate: string;
    openingBalance: number;
    closingBalance: number;
    storeId?: string;
    createdBy: string;
    lines: { operationDate: string; label?: string; reference?: string; amount: number; direction: 'in' | 'out' }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const acc = await client.query(`SELECT id FROM accounts WHERE code = $1`, [data.accountCode]);
      if (!acc.rows[0]) throw new Error(`Compte ${data.accountCode} introuvable`);

      const stmt = await client.query(
        `INSERT INTO bank_statements (label, account_id, statement_date, opening_balance, closing_balance, store_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [data.label, acc.rows[0].id, data.statementDate, data.openingBalance, data.closingBalance, data.storeId || null, data.createdBy]
      );
      const stmtId = stmt.rows[0].id;

      for (const l of data.lines) {
        if (!l.amount || l.amount <= 0) continue;
        await client.query(
          `INSERT INTO bank_statement_lines (bank_statement_id, operation_date, label, reference, amount, direction)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [stmtId, l.operationDate, l.label || null, l.reference || null, l.amount, l.direction]
        );
      }

      await client.query('COMMIT');
      return stmt.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async listStatements(opts: { storeId?: string } = {}) {
    const where = opts.storeId ? 'WHERE (bs.store_id IS NULL OR bs.store_id = $1)' : '';
    const result = await db.query(
      `SELECT bs.*, a.code AS account_code, a.label AS account_label,
              (SELECT COUNT(*) FROM bank_statement_lines WHERE bank_statement_id = bs.id)::int AS line_count,
              (SELECT COUNT(*) FROM bank_statement_lines WHERE bank_statement_id = bs.id AND reconciled)::int AS reconciled_count
       FROM bank_statements bs
       JOIN accounts a ON a.id = bs.account_id
       ${where}
       ORDER BY bs.statement_date DESC, bs.created_at DESC`,
      opts.storeId ? [opts.storeId] : []
    );
    return result.rows;
  },

  /**
   * Vue de rapprochement : lignes du releve (avec leur match) + lignes
   * d'ecriture du compte non encore rapprochees sur la periode du releve +
   * synthese des ecarts.
   */
  async getReconciliation(statementId: string) {
    const stmt = await db.query(
      `SELECT bs.*, a.code AS account_code, a.label AS account_label
       FROM bank_statements bs JOIN accounts a ON a.id = bs.account_id WHERE bs.id = $1`,
      [statementId]
    );
    if (!stmt.rows[0]) return null;
    const statement = stmt.rows[0];

    // Lignes du releve avec info de match
    const bankLines = await db.query(
      `SELECT bsl.*, je.entry_number AS matched_entry_number
       FROM bank_statement_lines bsl
       LEFT JOIN journal_entry_lines jel ON jel.id = bsl.matched_entry_line_id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE bsl.bank_statement_id = $1
       ORDER BY bsl.operation_date, bsl.created_at`,
      [statementId]
    );

    // Lignes d'ecriture sur le compte, NON rapprochees (aucun bank_statement_line ne pointe dessus),
    // sur une fenetre large autour de la date du releve (le mois).
    const periodStart = `${String(statement.statement_date).slice(0, 7)}-01`;
    const ledgerLines = await db.query(
      `SELECT jel.id, jel.debit, jel.credit, jel.label,
              je.entry_number, je.entry_date, j.code AS journal_code
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN journals j ON j.id = je.journal_id
       WHERE jel.account_id = $1
         AND je.status = 'posted'
         AND je.entry_date >= ($2::date - INTERVAL '1 month')
         AND je.entry_date <= ($2::date + INTERVAL '1 month')
         AND NOT EXISTS (
           SELECT 1 FROM bank_statement_lines b WHERE b.matched_entry_line_id = jel.id
         )
       ORDER BY je.entry_date, je.entry_number`,
      [statement.account_id, statement.statement_date]
    );

    // Synthese
    const reconciledLines = bankLines.rows.filter((l: { reconciled: boolean }) => l.reconciled);
    const unmatchedBank = bankLines.rows.filter((l: { reconciled: boolean }) => !l.reconciled);

    return {
      statement,
      bankLines: bankLines.rows,
      unmatchedLedgerLines: ledgerLines.rows,
      summary: {
        total_lines: bankLines.rows.length,
        reconciled: reconciledLines.length,
        unmatched_bank: unmatchedBank.length,
        unmatched_ledger: ledgerLines.rows.length,
      },
    };
  },

  /**
   * Rapprochement automatique : pour chaque ligne de releve non rapprochee,
   * cherche UNE ligne d'ecriture du compte avec montant + sens correspondant,
   * dans une fenetre de +/- 7 jours. Si match unique -> rapproche.
   */
  async autoMatch(statementId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const stmt = await client.query(`SELECT account_id FROM bank_statements WHERE id = $1`, [statementId]);
      if (!stmt.rows[0]) throw new Error('Releve introuvable');
      const accountId = stmt.rows[0].account_id;

      const bankLines = await client.query(
        `SELECT id, operation_date, amount, direction FROM bank_statement_lines
         WHERE bank_statement_id = $1 AND reconciled = false`,
        [statementId]
      );

      let matched = 0;
      for (const bl of bankLines.rows) {
        // 'in' -> debit, 'out' -> credit
        const col = bl.direction === 'in' ? 'debit' : 'credit';
        const candidates = await client.query(
          `SELECT jel.id
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = $1
             AND je.status = 'posted'
             AND jel.${col} = $2
             AND je.entry_date BETWEEN ($3::date - INTERVAL '7 days') AND ($3::date + INTERVAL '7 days')
             AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.matched_entry_line_id = jel.id)
           LIMIT 2`,
          [accountId, bl.amount, bl.operation_date]
        );
        if (candidates.rows.length === 1) {
          await client.query(
            `UPDATE bank_statement_lines
             SET matched_entry_line_id = $1, reconciled = true, reconciled_at = NOW(), reconciled_by = $2
             WHERE id = $3`,
            [candidates.rows[0].id, userId, bl.id]
          );
          matched++;
        }
      }

      await client.query('COMMIT');
      return { matched };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Rapprochement manuel d'une ligne de releve avec une ligne d'ecriture. */
  async matchLine(bankLineId: string, entryLineId: string, userId: string) {
    // Verifie que la ligne d'ecriture n'est pas deja rapprochee.
    const taken = await db.query(
      `SELECT 1 FROM bank_statement_lines WHERE matched_entry_line_id = $1 AND id <> $2`,
      [entryLineId, bankLineId]
    );
    if (taken.rows.length > 0) throw new Error('Cette ecriture est deja rapprochee a une autre ligne');

    const result = await db.query(
      `UPDATE bank_statement_lines
       SET matched_entry_line_id = $1, reconciled = true, reconciled_at = NOW(), reconciled_by = $2
       WHERE id = $3 RETURNING *`,
      [entryLineId, userId, bankLineId]
    );
    if (!result.rows[0]) throw new Error('Ligne de releve introuvable');
    return result.rows[0];
  },

  /** Annule le rapprochement d'une ligne. */
  async unmatchLine(bankLineId: string) {
    const result = await db.query(
      `UPDATE bank_statement_lines
       SET matched_entry_line_id = NULL, reconciled = false, reconciled_at = NULL, reconciled_by = NULL
       WHERE id = $1 RETURNING *`,
      [bankLineId]
    );
    if (!result.rows[0]) throw new Error('Ligne de releve introuvable');
    return result.rows[0];
  },

  async deleteStatement(id: string) {
    await db.query(`DELETE FROM bank_statements WHERE id = $1`, [id]);
  },
};
