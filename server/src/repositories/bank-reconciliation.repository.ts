import crypto from 'crypto';
import { db } from '../config/database.js';
import {
  parseStatement, netOf, type BankFormat, type CsvProfile, type DateFormat, type ParsedLine,
} from '../services/bank-statement-import.service.js';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ═══ Import de relevés (mig 426) ═══════════════════════════════════════ */

export type ProfileInput = {
  name: string; delimiter?: string | null; decimalSep: ',' | '.'; dateFormat: DateFormat;
  skipRows: number; hasHeader: boolean;
  colDate: number; colValueDate?: number | null; colLabel: number; colLabel2?: number | null; colReference?: number | null;
  colDebit?: number | null; colCredit?: number | null; colAmount?: number | null; negativeIsOut?: boolean;
  treasuryAccountId?: string | null;
};
type ProfileRow = {
  id: string; name: string; delimiter: string | null; decimal_sep: ',' | '.'; date_format: DateFormat;
  skip_rows: number; has_header: boolean; col_date: number; col_value_date: number | null; col_label: number;
  col_label2: number | null; col_reference: number | null; col_debit: number | null; col_credit: number | null;
  col_amount: number | null; negative_is_out: boolean; treasury_account_id: string | null;
};
const toCsvProfile = (p: ProfileRow): CsvProfile => ({
  delimiter: p.delimiter, decimalSep: p.decimal_sep, dateFormat: p.date_format, skipRows: p.skip_rows, hasHeader: p.has_header,
  colDate: p.col_date, colValueDate: p.col_value_date, colLabel: p.col_label, colLabel2: p.col_label2,
  colReference: p.col_reference, colDebit: p.col_debit, colCredit: p.col_credit, colAmount: p.col_amount,
  negativeIsOut: p.negative_is_out,
});

export type ImportInput = {
  content: Buffer; fileName: string; format?: BankFormat | 'auto'; encoding?: 'auto' | 'utf-8' | 'windows-1252';
  profileId?: string | null; profile?: CsvProfile | null; treasuryAccountId?: string | null;
};

/**
 * Empreinte de dédoublonnage = SHA-256(compte | date | sens | montant | rang).
 * Le rang distingue deux opérations identiques du même jour ; même canon que
 * la reprise SQL de la mig 426.
 */
export function fingerprints(accountId: string, lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map(l => {
    const k = `${l.operationDate}|${l.direction}|${l.amount.toFixed(2)}`;
    const rank = (seen.get(k) ?? 0) + 1;
    seen.set(k, rank);
    return crypto.createHash('sha256').update(`${accountId}|${k}|${rank}`).digest('hex');
  });
}

async function treasuryAccount(id?: string | null) {
  const r = await db.query(
    `SELECT t.id, t.code, t.label, t.account_code, t.iban, a.id AS account_id
       FROM treasury_accounts t JOIN accounts a ON a.code = t.account_code
      WHERE t.is_active AND t.kind = 'bank' AND ($1::uuid IS NULL OR t.id = $1::uuid)
      ORDER BY t.is_default DESC, t.code LIMIT 1`, [id || null]);
  if (!r.rows[0]) throw fail(id ? 'Compte bancaire introuvable' : 'Aucun compte bancaire actif (Paramètres › Trésorerie)');
  return r.rows[0] as { id: string; code: string; label: string; account_code: string; iban: string | null; account_id: string };
}

/** Lit le fichier, choisit le compte, marque les opérations déjà importées. */
async function analyse(input: ImportInput) {
  let profile = input.profile ?? null;
  let profileRow: ProfileRow | null = null;
  if (!profile && input.profileId) {
    profileRow = (await db.query(`SELECT * FROM bank_import_profiles WHERE id = $1`, [input.profileId])).rows[0] ?? null;
    if (!profileRow) throw fail('Profil d\'import introuvable', 404);
    profile = toCsvProfile(profileRow);
  }
  const parsed = parseStatement(input.content, { fileName: input.fileName, format: input.format, encoding: input.encoding, profile });

  // Compte : choisi, sinon celui du profil, sinon celui dont l'IBAN porte le n° de compte du fichier, sinon le défaut.
  let tid = input.treasuryAccountId || profileRow?.treasury_account_id || null;
  if (!tid && parsed.accountNumber) {
    const num = parsed.accountNumber.replace(/\W/g, '');
    tid = (await db.query(
      `SELECT id FROM treasury_accounts WHERE is_active AND kind = 'bank' AND iban IS NOT NULL
          AND (replace(iban, ' ', '') LIKE '%' || $1 || '%' OR $1 LIKE '%' || replace(iban, ' ', '') || '%') LIMIT 1`,
      [num])).rows[0]?.id ?? null;
  }
  const treasury = await treasuryAccount(tid);
  const fps = fingerprints(treasury.account_id, parsed.lines);
  const existing = new Set(fps.length
    ? (await db.query(`SELECT fingerprint FROM bank_statement_lines WHERE fingerprint = ANY($1::char(64)[])`, [fps])).rows
        .map((r: { fingerprint: string }) => r.fingerprint)
    : []);
  const lines = parsed.lines.map((l, i) => ({ ...l, fingerprint: fps[i], duplicate: existing.has(fps[i]) }));
  const fresh = lines.filter(l => !l.duplicate);
  return {
    parsed, treasury, lines, profileId: profileRow?.id ?? null,
    fileSha256: crypto.createHash('sha256').update(input.content).digest('hex'),
    stats: {
      count: lines.length, duplicates: lines.length - fresh.length,
      in: round2(fresh.filter(l => l.direction === 'in').reduce((s, l) => s + l.amount, 0)),
      out: round2(fresh.filter(l => l.direction === 'out').reduce((s, l) => s + l.amount, 0)),
      net: netOf(fresh),
    },
  };
}

export const bankImportRepository = {
  async listProfiles() {
    return (await db.query(
      `SELECT p.*, t.label AS treasury_label FROM bank_import_profiles p
         LEFT JOIN treasury_accounts t ON t.id = p.treasury_account_id
        WHERE p.is_active ORDER BY p.name`)).rows;
  },
  async saveProfile(p: ProfileInput, userId: string, id?: string) {
    const v = [p.name.trim(), p.delimiter || null, p.decimalSep, p.dateFormat, p.skipRows, p.hasHeader,
      p.colDate, p.colValueDate ?? null, p.colLabel, p.colLabel2 ?? null, p.colReference ?? null,
      p.colDebit ?? null, p.colCredit ?? null, p.colAmount ?? null, p.negativeIsOut !== false, p.treasuryAccountId || null];
    if ((p.colAmount == null) === (p.colDebit == null && p.colCredit == null)) {
      throw fail('Indiquez soit les colonnes débit/crédit, soit une colonne de montant signé');
    }
    try {
      const r = id
        ? await db.query(
          `UPDATE bank_import_profiles SET name = $1, delimiter = $2, decimal_sep = $3, date_format = $4, skip_rows = $5,
                  has_header = $6, col_date = $7, col_value_date = $8, col_label = $9, col_label2 = $10, col_reference = $11,
                  col_debit = $12, col_credit = $13, col_amount = $14, negative_is_out = $15, treasury_account_id = $16
            WHERE id = $17 RETURNING *`, [...v, id])
        : await db.query(
          `INSERT INTO bank_import_profiles (name, delimiter, decimal_sep, date_format, skip_rows, has_header, col_date,
                  col_value_date, col_label, col_label2, col_reference, col_debit, col_credit, col_amount, negative_is_out,
                  treasury_account_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [...v, userId]);
      if (!r.rows[0]) throw fail('Profil introuvable', 404);
      return r.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw fail(`Un profil « ${p.name.trim()} » existe déjà`, 409);
      throw err;
    }
  },
  async deleteProfile(id: string) {
    await db.query(`UPDATE bank_import_profiles SET is_active = false WHERE id = $1`, [id]);
  },

  /** Aperçu : opérations lues, doublons repérés, soldes et contrôle — rien n'est écrit. */
  async preview(input: ImportInput) {
    const a = await analyse(input);
    const p = a.parsed;
    return {
      format: p.format, accountNumber: p.accountNumber, currency: p.currency, warnings: p.warnings, rawRows: p.rawRows ?? null,
      statementDate: p.statementDate, openingBalance: p.openingBalance, closingBalance: p.closingBalance,
      treasuryAccount: { id: a.treasury.id, code: a.treasury.code, label: a.treasury.label, account_code: a.treasury.account_code },
      profileId: a.profileId, stats: a.stats,
      lines: a.lines.map(({ fingerprint: _f, ...l }) => l),
    };
  },

  /**
   * Import : relit le fichier côté serveur (les lignes ne viennent jamais du
   * navigateur), écarte les doublons, crée le relevé. Refuse un relevé dont
   * toutes les opérations sont déjà importées.
   */
  async importStatement(input: ImportInput & {
    label?: string | null; statementDate?: string | null; openingBalance?: number | null; closingBalance?: number | null;
    storeId?: string | null; userId: string;
  }) {
    const a = await analyse(input);
    if (!a.lines.length) throw fail('Aucune opération lue dans ce fichier : vérifiez le format ou les colonnes');
    const fresh = a.lines.filter(l => !l.duplicate);
    if (!fresh.length) throw fail(`Relevé déjà importé : ses ${a.lines.length} opérations sont toutes connues`, 409);
    const p = a.parsed;
    const statementDate = input.statementDate || p.statementDate || a.lines[a.lines.length - 1].operationDate;
    const opening = input.openingBalance ?? p.openingBalance ?? 0;
    const closing = input.closingBalance ?? p.closingBalance ?? round2(opening + netOf(a.lines));
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const stmt = (await client.query(
        `INSERT INTO bank_statements (label, account_id, statement_date, opening_balance, closing_balance, store_id, created_by,
                source_format, file_name, file_sha256, profile_id, treasury_account_id, duplicates_skipped)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [input.label?.trim() || `Relevé ${a.treasury.label} au ${statementDate.split('-').reverse().join('/')}`,
         a.treasury.account_id, statementDate, opening, closing, input.storeId || null, input.userId,
         p.format, input.fileName.slice(0, 255), a.fileSha256, a.profileId, a.treasury.id, 0])).rows[0];
      let inserted = 0;
      for (const l of fresh) {
        const r = await client.query(
          `INSERT INTO bank_statement_lines (bank_statement_id, operation_date, value_date, label, reference, amount, direction, fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL DO NOTHING`,
          [stmt.id, l.operationDate, l.valueDate, l.label.slice(0, 300) || null, l.reference?.slice(0, 100) || null,
           l.amount, l.direction, l.fingerprint]);
        inserted += r.rowCount ?? 0;
      }
      const skipped = a.lines.length - inserted;
      await client.query(`UPDATE bank_statements SET duplicates_skipped = $2 WHERE id = $1`, [stmt.id, skipped]);
      await client.query('COMMIT');
      return { statement: { ...stmt, duplicates_skipped: skipped }, imported: inserted, skipped };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

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
         AND je.status = 'posted' AND je.source_kind NOT IN ('reversal', 'opening')
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
             AND je.status = 'posted' AND je.source_kind <> 'reversal'
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
