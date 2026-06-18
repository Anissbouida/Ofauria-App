import { db } from '../config/database.js';

/* ═══ Plan comptable CGNC ═══ */
export const accountRepository = {
  /**
   * Liste les comptes actifs, tries par code. Sert d'arbre pour l'onglet Plan
   * comptable cote front (regroupement par classe/rubrique/poste).
   */
  async findAll(opts: { includeInactive?: boolean } = {}) {
    const where = opts.includeInactive ? '' : 'WHERE is_active = true';
    const result = await db.query(
      `SELECT id, code, label, account_class, rubrique, poste, parent_id,
              account_type, normal_side, is_collective, auxiliary_kind,
              tva_rate, tva_direction, is_active, created_at
       FROM accounts
       ${where}
       ORDER BY code`
    );
    return result.rows;
  },

  async findByCode(code: string) {
    const result = await db.query('SELECT * FROM accounts WHERE code = $1', [code]);
    return result.rows[0] || null;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM accounts WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
};

/* ═══ Sous-comptes tiers (auxiliaires) ═══ */
export const accountAuxiliaryRepository = {
  /**
   * Lookup direct par supplier_id ou customer_id. Utilise par le generateur
   * d'ecritures pour rattacher chaque ligne de tiers a son sous-compte.
   */
  async findBySupplierId(supplierId: string) {
    const result = await db.query(
      'SELECT id, code FROM account_auxiliaries WHERE supplier_id = $1',
      [supplierId]
    );
    return result.rows[0] || null;
  },
  async findByCustomerId(customerId: string) {
    const result = await db.query(
      'SELECT id, code FROM account_auxiliaries WHERE customer_id = $1',
      [customerId]
    );
    return result.rows[0] || null;
  },

  async findAll(opts: { kind?: 'supplier' | 'customer' } = {}) {
    const filters: string[] = [];
    const params: unknown[] = [];
    if (opts.kind === 'supplier') filters.push('aa.supplier_id IS NOT NULL');
    if (opts.kind === 'customer') filters.push('aa.customer_id IS NOT NULL');
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT aa.id, aa.account_id, aa.code, aa.label, aa.is_active,
              aa.supplier_id, aa.customer_id,
              s.name        AS supplier_name,
              c.first_name  AS customer_first_name,
              c.last_name   AS customer_last_name,
              a.code        AS account_code
       FROM account_auxiliaries aa
       JOIN accounts a ON a.id = aa.account_id
       LEFT JOIN suppliers s ON s.id = aa.supplier_id
       LEFT JOIN customers c ON c.id = aa.customer_id
       ${where}
       ORDER BY aa.code`,
      params
    );
    return result.rows;
  },
};

/* ═══ Journaux ═══ */
export const journalRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT j.id, j.code, j.label, j.kind, j.is_active, j.display_order,
              j.default_counterpart_account_id,
              a.code AS default_counterpart_code
       FROM journals j
       LEFT JOIN accounts a ON a.id = j.default_counterpart_account_id
       WHERE j.is_active = true
       ORDER BY j.display_order, j.code`
    );
    return result.rows;
  },
};

/* ═══ Periodes fiscales ═══ */
export const fiscalPeriodRepository = {
  async findAll(opts: { year?: number } = {}) {
    const params: unknown[] = [];
    let where = '';
    if (opts.year) {
      params.push(opts.year);
      where = 'WHERE year = $1';
    }
    const result = await db.query(
      `SELECT id, year, month, start_date, end_date, status,
              closed_at, closed_by, closed_note, created_at
       FROM fiscal_periods
       ${where}
       ORDER BY year DESC, month DESC`,
      params
    );
    return result.rows;
  },

  /**
   * Retrouve la periode contenant une date donnee. Utilise par le generateur
   * d'ecritures pour rattacher chaque journal_entry a sa periode.
   */
  async findByDate(date: string) {
    const result = await db.query(
      `SELECT id, year, month, start_date, end_date, status
       FROM fiscal_periods
       WHERE $1::DATE BETWEEN start_date AND end_date
       LIMIT 1`,
      [date]
    );
    return result.rows[0] || null;
  },
};

/* ═══ Reconciliation legacy <-> ledger ═══ */
export const reconciliationRepository = {
  /**
   * Synthese : nombre de factures alignees vs divergentes, montants.
   * Sert de health-check du noyau comptable.
   */
  async summary() {
    const result = await db.query(`
      SELECT
        COUNT(*)::INT                                                       AS total_invoices,
        COUNT(*) FILTER (WHERE has_ledger_entries)::INT                     AS with_entries,
        COUNT(*) FILTER (WHERE NOT has_ledger_entries)::INT                 AS missing_entries,
        COUNT(*) FILTER (WHERE ABS(legacy_remaining - ledger_remaining) > 0.01)::INT  AS divergent,
        COUNT(*) FILTER (WHERE ABS(legacy_remaining - ledger_remaining) <= 0.01)::INT AS aligned,
        ROUND(SUM(ABS(legacy_remaining - ledger_remaining))::NUMERIC, 2)    AS total_delta
      FROM v_reconciliation_check
    `);
    return result.rows[0];
  },

  /**
   * Detail des factures divergentes (a corriger manuellement ou via job).
   */
  async divergent(limit = 50) {
    const result = await db.query(`
      SELECT invoice_id, invoice_number, invoice_type, invoice_date,
             total_amount, legacy_remaining, ledger_remaining,
             ROUND((legacy_remaining - ledger_remaining)::NUMERIC, 2) AS delta,
             has_ledger_entries
      FROM v_reconciliation_check
      WHERE ABS(legacy_remaining - ledger_remaining) > 0.01
         OR NOT has_ledger_entries
      ORDER BY ABS(legacy_remaining - ledger_remaining) DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  },
};

/* ═══ Ecritures comptables (lecture seule pour Phase 1) ═══ */
interface FindEntriesFilters {
  storeId?: string;
  startDate?: string;
  endDate?: string;
  journalId?: string;
  status?: 'draft' | 'posted' | 'reversed';
  search?: string;
  limit?: number;
  offset?: number;
}

export const journalEntryRepository = {
  /**
   * Liste paginee des ecritures. Renvoie aussi un total pour pagination cote
   * front. Les filtres sont combinables : date, journal, statut, recherche
   * texte sur entry_number et description.
   *
   * Tant que le generateur n'est pas branche (Phase suivante), cette liste est
   * VIDE par construction — c'est attendu et l'onglet front gere l'etat vide.
   */
  async findAll(filters: FindEntriesFilters = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filters.storeId) {
      // store_id NULL = ecriture transverse (ex: OD de cloture annuelle)
      params.push(filters.storeId);
      where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`);
    }
    if (filters.startDate) {
      params.push(filters.startDate);
      where.push(`je.entry_date >= $${p++}`);
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      where.push(`je.entry_date <= $${p++}`);
    }
    if (filters.journalId) {
      params.push(filters.journalId);
      where.push(`je.journal_id = $${p++}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`je.status = $${p++}`);
    }
    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim()}%`);
      where.push(`(je.entry_number ILIKE $${p} OR je.description ILIKE $${p})`);
      p++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const countResult = await db.query(
      `SELECT COUNT(*)::INT AS total FROM journal_entries je ${whereClause}`,
      params
    );

    params.push(limit, offset);
    const rowsResult = await db.query(
      `SELECT
         je.id, je.entry_number, je.entry_date, je.description,
         je.source_kind, je.source_id, je.status, je.posted_at, je.store_id,
         j.id AS journal_id, j.code AS journal_code, j.label AS journal_label, j.kind AS journal_kind,
         fp.year AS fiscal_year, fp.month AS fiscal_month, fp.status AS fiscal_status,
         COALESCE((
           SELECT SUM(debit) FROM journal_entry_lines WHERE journal_entry_id = je.id
         ), 0) AS total_debit,
         COALESCE((
           SELECT SUM(credit) FROM journal_entry_lines WHERE journal_entry_id = je.id
         ), 0) AS total_credit,
         (SELECT COUNT(*) FROM journal_entry_lines WHERE journal_entry_id = je.id)::INT AS line_count
       FROM journal_entries je
       JOIN journals j ON j.id = je.journal_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       ${whereClause}
       ORDER BY je.entry_date DESC, je.entry_number DESC
       LIMIT $${p++} OFFSET $${p++}`,
      params
    );

    return {
      rows: rowsResult.rows,
      total: countResult.rows[0]?.total ?? 0,
    };
  },

  /**
   * Detail d'une ecriture avec ses lignes triees, info compte et tiers.
   */
  async findById(id: string) {
    const headResult = await db.query(
      `SELECT
         je.id, je.entry_number, je.entry_date, je.description,
         je.source_kind, je.source_id, je.status, je.posted_at, je.posted_by, je.store_id,
         je.created_at, je.created_by,
         j.id AS journal_id, j.code AS journal_code, j.label AS journal_label, j.kind AS journal_kind,
         fp.id AS fiscal_period_id, fp.year AS fiscal_year, fp.month AS fiscal_month, fp.status AS fiscal_status,
         u_posted.email AS posted_by_email,
         u_created.email AS created_by_email
       FROM journal_entries je
       JOIN journals j ON j.id = je.journal_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       LEFT JOIN users u_posted  ON u_posted.id  = je.posted_by
       LEFT JOIN users u_created ON u_created.id = je.created_by
       WHERE je.id = $1`,
      [id]
    );

    const head = headResult.rows[0];
    if (!head) return null;

    const linesResult = await db.query(
      `SELECT
         jel.id, jel.line_order, jel.debit, jel.credit, jel.label, jel.lettrage_id,
         jel.account_id, jel.auxiliary_id,
         a.code AS account_code, a.label AS account_label, a.is_collective,
         aa.code AS auxiliary_code, aa.label AS auxiliary_label
       FROM journal_entry_lines jel
       JOIN accounts a ON a.id = jel.account_id
       LEFT JOIN account_auxiliaries aa ON aa.id = jel.auxiliary_id
       WHERE jel.journal_entry_id = $1
       ORDER BY jel.line_order`,
      [id]
    );

    return { ...head, lines: linesResult.rows };
  },
};

/* ═══ Etats comptables (grand livre, balance, CPC) ═══ */
export const financialStatementsRepository = {
  /**
   * Grand livre d'un compte : tous les mouvements (lignes posted) d'un compte
   * sur une periode, tries chronologiquement, avec solde progressif.
   * Filtres : accountCode (obligatoire), startDate, endDate, storeId.
   */
  async generalLedger(params: {
    accountCode: string;
    startDate?: string;
    endDate?: string;
    storeId?: string;
  }) {
    const where: string[] = [`a.code = $1`, `je.status = 'posted'`];
    const values: unknown[] = [params.accountCode];
    let p = 2;
    if (params.startDate) { values.push(params.startDate); where.push(`je.entry_date >= $${p++}`); }
    if (params.endDate)   { values.push(params.endDate);   where.push(`je.entry_date <= $${p++}`); }
    if (params.storeId)   { values.push(params.storeId);   where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }

    const account = await db.query(
      `SELECT code, label, normal_side, account_type FROM accounts WHERE code = $1`,
      [params.accountCode]
    );
    if (!account.rows[0]) return null;

    const rows = await db.query(
      `SELECT
         je.entry_date, je.entry_number, j.code AS journal_code,
         je.description AS entry_description,
         jel.label AS line_label, jel.debit, jel.credit, jel.lettrage_id,
         aa.code AS auxiliary_code, aa.label AS auxiliary_label
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN journals j ON j.id = je.journal_id
       JOIN accounts a ON a.id = jel.account_id
       LEFT JOIN account_auxiliaries aa ON aa.id = jel.auxiliary_id
       WHERE ${where.join(' AND ')}
       ORDER BY je.entry_date, je.entry_number, jel.line_order`,
      values
    );

    // Solde d'ouverture : mouvements anterieurs a startDate (si fourni).
    let opening = 0;
    if (params.startDate) {
      const openWhere: string[] = [`a.code = $1`, `je.status = 'posted'`, `je.entry_date < $2`];
      const openValues: unknown[] = [params.accountCode, params.startDate];
      let op = 3;
      if (params.storeId) { openValues.push(params.storeId); openWhere.push(`(je.store_id IS NULL OR je.store_id = $${op++})`); }
      const openRes = await db.query(
        `SELECT COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         WHERE ${openWhere.join(' AND ')}`,
        openValues
      );
      opening = parseFloat(openRes.rows[0].bal) || 0;
    }

    return { account: account.rows[0], opening, movements: rows.rows };
  },

  /**
   * Balance : pour chaque compte ayant au moins un mouvement sur la periode,
   * total debit, total credit et solde. Triee par code.
   */
  async balance(params: { startDate?: string; endDate?: string; storeId?: string }) {
    const where: string[] = [`je.status = 'posted'`];
    const values: unknown[] = [];
    let p = 1;
    if (params.startDate) { values.push(params.startDate); where.push(`je.entry_date >= $${p++}`); }
    if (params.endDate)   { values.push(params.endDate);   where.push(`je.entry_date <= $${p++}`); }
    if (params.storeId)   { values.push(params.storeId);   where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }

    const rows = await db.query(
      `SELECT
         a.code, a.label, a.account_class, a.account_type, a.normal_side,
         COALESCE(SUM(jel.debit), 0)  AS total_debit,
         COALESCE(SUM(jel.credit), 0) AS total_credit,
         COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS balance
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
       WHERE ${where.join(' AND ')}
       GROUP BY a.code, a.label, a.account_class, a.account_type, a.normal_side
       HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.code`,
      values
    );
    return rows.rows;
  },

  /**
   * CPC (Compte de Produits et Charges) : agregats classe 6 (charges) et
   * classe 7 (produits) par compte, et resultat net = produits - charges.
   */
  async incomeStatement(params: { startDate?: string; endDate?: string; storeId?: string }) {
    const where: string[] = [`je.status = 'posted'`, `a.account_class IN (6, 7)`];
    const values: unknown[] = [];
    let p = 1;
    if (params.startDate) { values.push(params.startDate); where.push(`je.entry_date >= $${p++}`); }
    if (params.endDate)   { values.push(params.endDate);   where.push(`je.entry_date <= $${p++}`); }
    if (params.storeId)   { values.push(params.storeId);   where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }

    const rows = await db.query(
      `SELECT
         a.code, a.label, a.account_class,
         -- Charges (classe 6) : solde debiteur = debit - credit
         -- Produits (classe 7) : solde crediteur = credit - debit
         CASE WHEN a.account_class = 6
              THEN COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
              ELSE COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
         END AS amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
       WHERE ${where.join(' AND ')}
       GROUP BY a.code, a.label, a.account_class
       HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.code`,
      values
    );

    const charges = rows.rows.filter((r: { account_class: number }) => r.account_class === 6);
    const produits = rows.rows.filter((r: { account_class: number }) => r.account_class === 7);
    const totalCharges = charges.reduce((s: number, r: { amount: string }) => s + (parseFloat(r.amount) || 0), 0);
    const totalProduits = produits.reduce((s: number, r: { amount: string }) => s + (parseFloat(r.amount) || 0), 0);

    return {
      charges,
      produits,
      total_charges: totalCharges,
      total_produits: totalProduits,
      resultat_net: totalProduits - totalCharges,
    };
  },
};
