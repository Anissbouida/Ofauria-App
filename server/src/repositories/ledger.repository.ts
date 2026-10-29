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

  /**
   * Change le statut d'une periode (cloture / reouverture).
   * Transitions autorisees :
   *   open    -> closed  (cloture mensuelle : plus de nouvelle ecriture)
   *   closed  -> open    (reouverture, si pas encore verrouillee)
   *   closed  -> locked  (verrou definitif post-validation expert-comptable)
   * Refuse : toute transition depuis 'locked' (verrou dur, irreversible ici).
   */
  /**
   * Change le statut d'une période (mig 311, G-D8-16).
   *   open → closed  : checklist de clôture sans point bloquant ; période précédente close (trigger)
   *   closed → open  : réouverture motivée (note obligatoire)
   *   closed → locked : verrou définitif, administrateur seulement
   * Chaque transition est historisée (fiscal_period_events) avec la checklist figée.
   */
  async updateStatus(id: string, status: 'open' | 'closed' | 'locked', userId: string, note?: string, role?: string) {
    const fail = (code: number, message: string) => Object.assign(new Error(message), { statusCode: code });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const cur = await client.query(`SELECT status FROM fiscal_periods WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rows[0]) throw fail(404, 'Periode introuvable');
      const from = cur.rows[0].status as string;
      const valid: Record<string, string[]> = { open: ['closed'], closed: ['open', 'locked'] };
      if (!valid[from]?.includes(status)) throw fail(409, `Transition ${from} -> ${status} non autorisee`);
      if (status === 'locked' && role !== 'admin') throw fail(403, 'Seul un administrateur peut verrouiller une période');
      if (status === 'open' && (!note || note.trim().length < 3)) throw fail(400, 'Motif de réouverture obligatoire');
      let checklist: unknown[] | null = null;
      if (status === 'closed') {
        const ck = await client.query(`SELECT * FROM fn_close_checklist($1)`, [id]);
        checklist = ck.rows;
        const blocking = ck.rows.filter((r: { blocking: boolean; item_count: string }) => r.blocking && parseInt(r.item_count, 10) > 0);
        if (blocking.length) {
          throw fail(409, `Clôture impossible : ${blocking.map((b: { label: string; item_count: string }) => `${b.label} (${b.item_count})`).join(', ')}`);
        }
      }
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.period_note', $2, true), set_config('app.period_checklist', $3, true)`,
        [userId, note ?? '', checklist ? JSON.stringify(checklist) : '']);
      const result = await client.query(
        `UPDATE fiscal_periods
         SET status = $1::varchar,
             closed_at = CASE WHEN $1::varchar IN ('closed','locked') THEN NOW() ELSE NULL END,
             closed_by = CASE WHEN $1::varchar IN ('closed','locked') THEN $2::uuid ELSE NULL END,
             closed_note = CASE WHEN $1::varchar IN ('closed','locked') THEN $3::text ELSE NULL END
         WHERE id = $4::uuid
         RETURNING *`,
        [status, userId, note || null, id]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Checklist de clôture d'une période (contrôles bloquants / avertissements). */
  async checklist(id: string) {
    const r = await db.query(`SELECT * FROM fn_close_checklist($1)`, [id]);
    return r.rows.map((x: Record<string, unknown>) => ({ ...x, item_count: parseInt(String(x.item_count), 10) }));
  },

  /** Historique des transitions d'une période. */
  async events(id: string) {
    const r = await db.query(
      `SELECT e.*, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name
         FROM fiscal_period_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.period_id = $1 ORDER BY e.at DESC`, [id]);
    return r.rows;
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
    const where: string[] = [`a.code = $1`, `je.status IN ('posted','reversed')`];
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
      const openWhere: string[] = [`a.code = $1`, `je.status IN ('posted','reversed')`, `je.entry_date < $2`];
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
   * Grand livre complet : TOUS les comptes ayant des mouvements sur la periode,
   * chacun avec son solde d'ouverture, ses mouvements et son solde de cloture.
   * C'est la presentation classique du grand livre (par compte, sur une periode).
   * Filtres optionnels : accountCode (un seul compte) ou accountClass (une classe).
   */
  async generalLedgerByPeriod(params: {
    startDate?: string; endDate?: string; storeId?: string;
    accountCode?: string; accountClass?: number;
  }) {
    const where: string[] = [`je.status IN ('posted','reversed')`];
    const values: unknown[] = [];
    let p = 1;
    if (params.startDate)   { values.push(params.startDate);   where.push(`je.entry_date >= $${p++}`); }
    if (params.endDate)     { values.push(params.endDate);     where.push(`je.entry_date <= $${p++}`); }
    if (params.storeId)     { values.push(params.storeId);     where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }
    if (params.accountCode) { values.push(params.accountCode); where.push(`a.code = $${p++}`); }
    if (params.accountClass){ values.push(params.accountClass);where.push(`a.account_class = $${p++}`); }

    const movements = await db.query(
      `SELECT a.code AS account_code, a.label AS account_label, a.normal_side,
              je.entry_date, je.entry_number, j.code AS journal_code,
              je.description AS entry_description, jel.label AS line_label,
              jel.debit, jel.credit, jel.lettrage_id,
              aa.code AS auxiliary_code, aa.label AS auxiliary_label
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN journals j ON j.id = je.journal_id
       JOIN accounts a ON a.id = jel.account_id
       LEFT JOIN account_auxiliaries aa ON aa.id = jel.auxiliary_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.code, je.entry_date, je.entry_number, jel.line_order`,
      values
    );

    // Soldes d'ouverture par compte (mouvements anterieurs a startDate).
    const openingByCode = new Map<string, number>();
    if (params.startDate) {
      const ow: string[] = [`je.status IN ('posted','reversed')`, `je.entry_date < $1`];
      const ov: unknown[] = [params.startDate];
      let op = 2;
      if (params.storeId)     { ov.push(params.storeId);     ow.push(`(je.store_id IS NULL OR je.store_id = $${op++})`); }
      if (params.accountCode) { ov.push(params.accountCode); ow.push(`a.code = $${op++}`); }
      if (params.accountClass){ ov.push(params.accountClass);ow.push(`a.account_class = $${op++}`); }
      const ores = await db.query(
        `SELECT a.code, COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS bal
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         WHERE ${ow.join(' AND ')}
         GROUP BY a.code`,
        ov
      );
      for (const r of ores.rows) openingByCode.set(r.code, parseFloat(r.bal) || 0);
    }

    // Regroupement par compte.
    interface AcctBlock {
      code: string; label: string; normal_side: string;
      opening: number; total_debit: number; total_credit: number;
      movements: Record<string, unknown>[];
    }
    const map = new Map<string, AcctBlock>();
    for (const m of movements.rows as Record<string, unknown>[]) {
      const code = m.account_code as string;
      if (!map.has(code)) {
        map.set(code, {
          code, label: m.account_label as string, normal_side: m.normal_side as string,
          opening: openingByCode.get(code) || 0,
          total_debit: 0, total_credit: 0, movements: [],
        });
      }
      const blk = map.get(code)!;
      blk.movements.push({
        entry_date: m.entry_date, entry_number: m.entry_number, journal_code: m.journal_code,
        entry_description: m.entry_description, line_label: m.line_label,
        debit: m.debit, credit: m.credit, lettrage_id: m.lettrage_id,
        auxiliary_code: m.auxiliary_code, auxiliary_label: m.auxiliary_label,
      });
      blk.total_debit += parseFloat(m.debit as string) || 0;
      blk.total_credit += parseFloat(m.credit as string) || 0;
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const accounts = Array.from(map.values())
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(a => ({
        ...a,
        opening: r2(a.opening),
        total_debit: r2(a.total_debit),
        total_credit: r2(a.total_credit),
        closing: r2(a.opening + a.total_debit - a.total_credit),
      }));

    const grand = accounts.reduce(
      (acc, a) => ({ debit: acc.debit + a.total_debit, credit: acc.credit + a.total_credit }),
      { debit: 0, credit: 0 }
    );

    return {
      accounts,
      total_debit: r2(grand.debit),
      total_credit: r2(grand.credit),
      account_count: accounts.length,
    };
  },

  /**
   * Balance : pour chaque compte ayant au moins un mouvement sur la periode,
   * total debit, total credit et solde. Triee par code.
   */
  async balance(params: { startDate?: string; endDate?: string; storeId?: string }) {
    const where: string[] = [`je.status IN ('posted','reversed')`];
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
   * Etat de flux de tresorerie sur une periode. Base sur les mouvements des
   * comptes de tresorerie (classe 5 : caisses, banques, effets) :
   *   - par compte : solde d'ouverture (avant startDate), encaissements (debit)
   *     et decaissements (credit) de la periode, solde de cloture ;
   *   - ventilation par nature : contreparties (lignes non classe-5 des ecritures
   *     touchant la tresorerie), groupees par classe de compte -> d'ou vient et ou
   *     va la tresorerie. Les virements internes tresorerie<->tresorerie
   *     n'apparaissent pas dans la ventilation (contrepartie classe 5 exclue).
   */
  async cashFlow(params: { startDate: string; endDate: string; storeId?: string }) {
    const storeAnd = params.storeId ? ` AND (je.store_id IS NULL OR je.store_id = $3)` : '';
    const vals: unknown[] = [params.startDate, params.endDate];
    if (params.storeId) vals.push(params.storeId);

    // 1) Par compte de tresorerie
    const accounts = (await db.query(
      `SELECT a.code, a.label,
         (COALESCE(SUM(jel.debit)  FILTER (WHERE je.entry_date < $1), 0)
        - COALESCE(SUM(jel.credit) FILTER (WHERE je.entry_date < $1), 0))::float8 AS opening,
         COALESCE(SUM(jel.debit)  FILTER (WHERE je.entry_date BETWEEN $1 AND $2), 0)::float8 AS inflow,
         COALESCE(SUM(jel.credit) FILTER (WHERE je.entry_date BETWEEN $1 AND $2), 0)::float8 AS outflow
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
      WHERE a.account_class = 5 AND je.status IN ('posted','reversed') AND je.entry_date <= $2${storeAnd}
      GROUP BY a.code, a.label
      HAVING (COALESCE(SUM(jel.debit) FILTER (WHERE je.entry_date < $1),0) - COALESCE(SUM(jel.credit) FILTER (WHERE je.entry_date < $1),0)) <> 0
          OR COALESCE(SUM(jel.debit)  FILTER (WHERE je.entry_date BETWEEN $1 AND $2),0) <> 0
          OR COALESCE(SUM(jel.credit) FILTER (WHERE je.entry_date BETWEEN $1 AND $2),0) <> 0
      ORDER BY a.code`, vals)).rows as { code: string; label: string; opening: number; inflow: number; outflow: number }[];

    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const accountRows = accounts.map(a => ({ ...a, opening: r2(a.opening), inflow: r2(a.inflow), outflow: r2(a.outflow), closing: r2(a.opening + a.inflow - a.outflow) }));
    const openingTotal = r2(accountRows.reduce((s, a) => s + a.opening, 0));
    const inflowTotal = r2(accountRows.reduce((s, a) => s + a.inflow, 0));
    const outflowTotal = r2(accountRows.reduce((s, a) => s + a.outflow, 0));

    // 2) Ventilation par nature (contreparties classe != 5 des ecritures de tresorerie)
    const CLASS_LABEL: Record<number, string> = {
      1: 'Financement permanent', 2: 'Immobilisations', 3: 'Stocks & créances',
      4: 'Tiers (clients, fournisseurs, État, personnel)', 6: 'Charges', 7: 'Produits',
    };
    const nat = (await db.query(
      `WITH tre AS (
         SELECT DISTINCT je.id FROM journal_entries je
         JOIN journal_entry_lines l ON l.journal_entry_id = je.id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.account_class = 5 AND je.status IN ('posted','reversed') AND je.entry_date BETWEEN $1 AND $2${storeAnd})
       SELECT a.account_class,
              COALESCE(SUM(jel.credit),0)::float8 AS sources,
              COALESCE(SUM(jel.debit),0)::float8  AS uses
         FROM journal_entry_lines jel
         JOIN tre ON tre.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
        WHERE a.account_class <> 5
        GROUP BY a.account_class
        ORDER BY a.account_class`, vals)).rows as { account_class: number; sources: number; uses: number }[];
    const nature = nat.map(n => ({
      account_class: n.account_class,
      label: CLASS_LABEL[n.account_class] || `Classe ${n.account_class}`,
      inflow: r2(n.sources), outflow: r2(n.uses),
    }));

    return {
      startDate: params.startDate, endDate: params.endDate,
      accounts: accountRows,
      openingTotal, inflowTotal, outflowTotal, closingTotal: r2(openingTotal + inflowTotal - outflowTotal),
      nature,
    };
  },

  /**
   * CPC (Compte de Produits et Charges) : agregats classe 6 (charges) et
   * classe 7 (produits) par compte, et resultat net = produits - charges.
   */
  async incomeStatement(params: { startDate?: string; endDate?: string; storeId?: string }) {
    const where: string[] = [`je.status IN ('posted','reversed')`, `a.account_class IN (6, 7)`];
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

/* ═══ Declaration TVA (CA20 Maroc) ═══ */
export const tvaDeclarationRepository = {
  /**
   * Synthese TVA pour une periode (mensuelle par defaut) :
   *   - TVA collectee : comptes 445x (sur ventes)
   *   - TVA deductible : comptes 345x (sur achats)
   *   - TVA due = collectee - deductible
   * Detaillee par taux (20/14/10/7) via le champ tva_rate du plan comptable.
   */
  async declaration(params: { startDate: string; endDate: string; storeId?: string }) {
    const where: string[] = [
      `je.status IN ('posted','reversed')`,
      `je.entry_date >= $1`,
      `je.entry_date <= $2`,
      `a.tva_direction IS NOT NULL`,
    ];
    const values: unknown[] = [params.startDate, params.endDate];
    let p = 3;
    if (params.storeId) { values.push(params.storeId); where.push(`(je.store_id IS NULL OR je.store_id = $${p++})`); }

    const rows = await db.query(
      `SELECT
         a.code, a.label, a.tva_rate, a.tva_direction,
         -- TVA collectee : solde crediteur ; deductible : solde debiteur
         CASE WHEN a.tva_direction = 'collected'
              THEN COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
              ELSE COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
         END AS amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
       WHERE ${where.join(' AND ')}
       GROUP BY a.code, a.label, a.tva_rate, a.tva_direction
       HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.tva_direction, a.tva_rate`,
      values
    );

    const collected = rows.rows.filter((r: { tva_direction: string }) => r.tva_direction === 'collected');
    // Mig 311 (G-D8-15) : TVA déductible = factures fournisseurs dont le droit est
    // né dans la période (date du règlement qui les solde, CGI art. 101), hors
    // exclusions (espèces au-delà du plafond…). Plus la date de facture.
    const ded = await db.query(
      `WITH inv AS (
         SELECT i.id, i.amount, i.tax_amount FROM invoices i
          WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.tax_amount > 0
            AND i.is_vat_recoverable AND i.vat_recoverable_from BETWEEN $1 AND $2
       ), by_line AS (
         SELECT ROUND(ii.tva_rate)::int AS rate, SUM(ii.tva_amount) AS tva
           FROM invoice_items ii JOIN inv ON inv.id = ii.invoice_id
          WHERE ii.tva_rate IS NOT NULL AND ii.tva_amount IS NOT NULL
          GROUP BY 1
       ), by_header AS (
         SELECT CASE WHEN inv.amount > 0 THEN ROUND(inv.tax_amount / inv.amount * 100)::int ELSE 0 END AS rate, SUM(inv.tax_amount) AS tva
           FROM inv WHERE NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = inv.id AND ii.tva_rate IS NOT NULL AND ii.tva_amount IS NOT NULL)
          GROUP BY 1
       )
       SELECT rate, ROUND(SUM(tva), 2) AS amount FROM (SELECT * FROM by_line UNION ALL SELECT * FROM by_header) x
        GROUP BY rate HAVING ROUND(SUM(tva), 2) <> 0 ORDER BY rate`,
      [params.startDate, params.endDate]);
    const codeFor = (r: number) => (r === 20 ? '34552' : r === 14 ? '34553' : r === 10 ? '34554' : r === 7 ? '34555' : '3455');
    const deductible = ded.rows.map((r: { rate: number; amount: string }) => ({
      code: codeFor(r.rate), label: `TVA récupérable sur achats ${r.rate} %`, tva_rate: r.rate,
      tva_direction: 'deductible', amount: r.amount,
    }));
    const pend = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(tax_amount), 0) AS tva FROM invoices
        WHERE invoice_type = 'received' AND status <> 'cancelled' AND tax_amount > 0 AND is_vat_recoverable
          AND invoice_date <= $1 AND (vat_recoverable_from IS NULL OR vat_recoverable_from > $1)`, [params.endDate]);
    const excl = await db.query(
      `SELECT vat_non_recoverable_reason AS reason, COUNT(*)::int AS n, COALESCE(SUM(tax_amount), 0) AS tva FROM invoices
        WHERE invoice_type = 'received' AND status <> 'cancelled' AND tax_amount > 0 AND NOT is_vat_recoverable
          AND COALESCE(vat_recoverable_from, invoice_date) BETWEEN $1 AND $2
        GROUP BY 1`, [params.startDate, params.endDate]);
    const totalCollected = collected.reduce((s: number, r: { amount: string }) => s + (parseFloat(r.amount) || 0), 0);
    const totalDeductible = deductible.reduce((s: number, r: { amount: string }) => s + (parseFloat(r.amount) || 0), 0);

    return {
      period: { startDate: params.startDate, endDate: params.endDate },
      collected,
      deductible,
      total_collected: totalCollected,
      total_deductible: totalDeductible,
      // TVA due (a payer si positif, credit de TVA a reporter si negatif)
      tva_due: totalCollected - totalDeductible,
      // Mig 311 : TVA des factures non encore réglées (droit pas encore né) et exclusions.
      pending_payment: { count: pend.rows[0].n, amount: parseFloat(pend.rows[0].tva) },
      excluded: excl.rows.map((r: { reason: string; n: number; tva: string }) => ({ reason: r.reason, count: r.n, amount: parseFloat(r.tva) })),
    };
  },
};

/* ═══ Bilan (actif / passif CGNC) ═══ */
export const balanceSheetRepository = {
  /**
   * Bilan a une date d'arrete : soldes cumules (depuis l'origine) des comptes
   * de classes 1 a 5, avec le resultat net (classes 6-7) bascule au passif.
   *
   * Identite fondamentale : TOTAL ACTIF = TOTAL PASSIF, garantie par le fait
   * que chaque ecriture est equilibree (somme de tous les soldes = 0).
   *
   * Presentation (positifs des deux cotes) :
   *   ACTIF  : immobilise (classe 2, net = brut - amort), circulant (classe 3),
   *            tresorerie-actif (classe 5 a solde debiteur).
   *   PASSIF : financement permanent (classe 1) + resultat net, passif circulant
   *            (classe 4), tresorerie-passif (classe 5 a solde crediteur).
   */
  async balanceSheet(params: { endDate: string; storeId?: string }) {
    const storeFilter = params.storeId ? 'AND (je.store_id IS NULL OR je.store_id = $2)' : '';
    const values: unknown[] = [params.endDate];
    if (params.storeId) values.push(params.storeId);

    // Soldes cumules (debit - credit) des comptes 1-5 jusqu'a endDate.
    const accRows = await db.query(
      `SELECT a.code, a.label, a.account_class,
              COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS solde
       FROM accounts a
       JOIN journal_entry_lines jel ON jel.account_id = a.id
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.status IN ('posted','reversed')
         AND je.entry_date <= $1::date
         AND a.account_class BETWEEN 1 AND 5
         ${storeFilter}
       GROUP BY a.code, a.label, a.account_class
       HAVING COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) <> 0
       ORDER BY a.code`,
      values
    );

    // Resultat net cumule (produits classe 7 - charges classe 6) jusqu'a endDate.
    const resRows = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN a.account_class = 7 THEN jel.credit - jel.debit ELSE 0 END), 0) AS produits,
         COALESCE(SUM(CASE WHEN a.account_class = 6 THEN jel.debit - jel.credit ELSE 0 END), 0) AS charges
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
       WHERE je.status IN ('posted','reversed')
         AND je.entry_date <= $1::date
         AND a.account_class IN (6, 7)
         ${storeFilter}`,
      values
    );
    const produits = parseFloat(resRows.rows[0]?.produits) || 0;
    const charges = parseFloat(resRows.rows[0]?.charges) || 0;
    const resultatNet = Math.round((produits - charges) * 100) / 100;

    type Line = { code: string; label: string; amount: number };
    const immobilise: Line[] = [];
    const circulantActif: Line[] = [];
    const tresorerieActif: Line[] = [];
    const financementPermanent: Line[] = [];
    const circulantPassif: Line[] = [];
    const tresoreriePassif: Line[] = [];

    for (const r of accRows.rows as { code: string; label: string; account_class: number; solde: string }[]) {
      const solde = parseFloat(r.solde) || 0;
      const line = { code: r.code, label: r.label, amount: Math.round(Math.abs(solde) * 100) / 100 };
      if (r.account_class === 2) {
        // Immobilise : on garde le signe (28xx amort = negatif, reduit le net)
        immobilise.push({ code: r.code, label: r.label, amount: Math.round(solde * 100) / 100 });
      } else if (r.account_class === 3) {
        circulantActif.push(line);
      } else if (r.account_class === 1) {
        financementPermanent.push(line);
      } else if (r.account_class === 4) {
        circulantPassif.push(line);
      } else if (r.account_class === 5) {
        if (solde >= 0) tresorerieActif.push(line);
        else tresoreriePassif.push(line);
      }
    }

    const sum = (arr: Line[]) => Math.round(arr.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    const totalImmobilise = sum(immobilise);
    const totalCirculantActif = sum(circulantActif);
    const totalTresorerieActif = sum(tresorerieActif);
    const totalActif = Math.round((totalImmobilise + totalCirculantActif + totalTresorerieActif) * 100) / 100;

    const totalFinancementBase = sum(financementPermanent);
    const totalFinancement = Math.round((totalFinancementBase + resultatNet) * 100) / 100;
    const totalCirculantPassif = sum(circulantPassif);
    const totalTresoreriePassif = sum(tresoreriePassif);
    const totalPassif = Math.round((totalFinancement + totalCirculantPassif + totalTresoreriePassif) * 100) / 100;

    return {
      end_date: params.endDate,
      actif: {
        immobilise, total_immobilise: totalImmobilise,
        circulant: circulantActif, total_circulant: totalCirculantActif,
        tresorerie: tresorerieActif, total_tresorerie: totalTresorerieActif,
        total: totalActif,
      },
      passif: {
        financement_permanent: financementPermanent, resultat_net: resultatNet,
        total_financement: totalFinancement,
        circulant: circulantPassif, total_circulant: totalCirculantPassif,
        tresorerie: tresoreriePassif, total_tresorerie: totalTresoreriePassif,
        total: totalPassif,
      },
      ecart: Math.round((totalActif - totalPassif) * 100) / 100,
    };
  },
};

/* ═══ Mig 311 (D8) : réceptions à facturer, relevé des déductions, paramétrage ═══ */
export const purchaseLedgerRepository = {
  async grirOpenItems(params: { supplierId?: string; minAge?: number }) {
    const r = await db.query(
      `SELECT * FROM v_grir_open_items
        WHERE ($1::uuid IS NULL OR supplier_id = $1) AND ($2::int IS NULL OR age_days >= $2)
        ORDER BY age_days DESC, order_number`, [params.supplierId ?? null, params.minAge ?? null]);
    return r.rows;
  },
  async vatDeductionStatement(params: { startDate: string; endDate: string }) {
    const r = await db.query(
      `SELECT * FROM v_vat_deduction_statement
        WHERE (vat_recoverable_from BETWEEN $1 AND $2)
           OR (NOT is_vat_recoverable AND COALESCE(vat_recoverable_from, invoice_date) BETWEEN $1 AND $2)
        ORDER BY vat_recoverable_from NULLS LAST, invoice_date`, [params.startDate, params.endDate]);
    return r.rows;
  },
  async postingProfiles() {
    const r = await db.query(
      `SELECT pp.*, a.label AS account_label, ec.name AS category_name
         FROM posting_profiles pp JOIN accounts a ON a.code = pp.account_code
         LEFT JOIN expense_categories ec ON ec.id = pp.category_id
        ORDER BY pp.event_type`);
    return r.rows;
  },
  /** Catégories de charge actives sans compte (ni chez leurs parents) : bloqueraient la comptabilisation. */
  async categoriesWithoutAccount() {
    const r = await db.query(
      `WITH RECURSIVE chain AS (
         SELECT id AS leaf, id, parent_id, account_id, posting_block_reason FROM expense_categories WHERE is_active
         UNION ALL
         SELECT ch.leaf, c.id, c.parent_id, c.account_id, c.posting_block_reason FROM expense_categories c JOIN chain ch ON ch.parent_id = c.id)
       SELECT ec.id, ec.name FROM expense_categories ec
        WHERE ec.is_active
          AND NOT EXISTS (SELECT 1 FROM chain WHERE chain.leaf = ec.id AND (chain.account_id IS NOT NULL OR chain.posting_block_reason IS NOT NULL))
        ORDER BY ec.name`);
    return r.rows;
  },
};
