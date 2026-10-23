import { db } from '../config/database.js';

/**
 * Contrôle de gestion (mig 317).
 *   - Budget annuel par compte du CPC (classes 6/7) et par mois. Réel = écritures
 *     comptabilisées (posted/reversed), même périmètre magasin que le CPC :
 *     écritures du magasin + écritures communes (store_id NULL).
 *   - Marges par famille, canal ou produit : CA (v_sales_product_daily) moins
 *     coût de revient (v_product_unit_cost). Les ventes sans coût connu sont
 *     exclues de la marge et mesurées à part (taux de couverture).
 */

export type BudgetInit = 'empty' | 'previous_actual';

/** Rubriques du CGNC (2 premiers chiffres du compte). */
export const RUBRIQUES: Record<string, string> = {
  '61': 'Charges d\'exploitation',
  '63': 'Charges financières',
  '65': 'Charges non courantes',
  '67': 'Impôts sur les résultats',
  '71': 'Produits d\'exploitation',
  '73': 'Produits financiers',
  '75': 'Produits non courants',
};

/** Montant au sens du CPC : charges = débit − crédit, produits = crédit − débit. */
const SIGNED = `CASE WHEN a.account_class = 6 THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END`;
const STORE_SCOPE = `($2::uuid IS NULL OR je.store_id IS NULL OR je.store_id = $2::uuid)`;

async function actualByAccountMonth(year: number, storeId: string | null) {
  const { rows } = await db.query(
    `SELECT jel.account_id, EXTRACT(MONTH FROM je.entry_date)::int AS month, SUM(${SIGNED})::float AS amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id
      WHERE je.status IN ('posted', 'reversed') AND a.account_class IN (6, 7)
        AND EXTRACT(YEAR FROM je.entry_date) = $1 AND ${STORE_SCOPE}
      GROUP BY 1, 2`,
    [year, storeId],
  );
  return rows as { account_id: string; month: number; amount: number }[];
}

export const managementRepository = {
  async accounts() {
    const { rows } = await db.query(
      `SELECT id, code, label, account_class FROM accounts
        WHERE account_class IN (6, 7) AND is_active ORDER BY code`,
    );
    return rows.map(r => ({ ...r, rubrique: r.code.slice(0, 2), rubrique_label: RUBRIQUES[r.code.slice(0, 2)] ?? r.code.slice(0, 2) }));
  },

  async findBudget(year: number, storeId: string | null) {
    const { rows } = await db.query(
      `SELECT b.*, COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS approved_by_name
         FROM budgets b LEFT JOIN users u ON u.id = b.approved_by
        WHERE b.fiscal_year = $1 AND b.store_id IS NOT DISTINCT FROM $2::uuid`,
      [year, storeId],
    );
    return rows[0] ?? null;
  },

  /**
   * Crée le budget de l'exercice. Initialisation possible depuis le réel N-1,
   * ajusté d'un pourcentage (hausse attendue du CA, inflation des charges…).
   */
  async createBudget(p: { year: number; storeId: string | null; name: string; init: BudgetInit; revenuePct: number; chargesPct: number; userId: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO budgets (fiscal_year, store_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [p.year, p.storeId, p.name, p.userId],
      );
      const budget = rows[0];
      if (p.init === 'previous_actual') {
        const prev = await actualByAccountMonth(p.year - 1, p.storeId);
        const { rows: acc } = await client.query(`SELECT id, account_class FROM accounts WHERE account_class IN (6, 7)`);
        const cls = new Map(acc.map(a => [a.id as string, a.account_class as number]));
        for (const l of prev) {
          const pct = cls.get(l.account_id) === 7 ? p.revenuePct : p.chargesPct;
          const amount = Math.round(l.amount * (1 + pct / 100) * 100) / 100;
          if (amount === 0) continue;
          await client.query(
            `INSERT INTO budget_lines (budget_id, account_id, month, amount) VALUES ($1, $2, $3, $4)`,
            [budget.id, l.account_id, l.month, amount],
          );
        }
      }
      await client.query('COMMIT');
      return budget;
    } catch (err) {
      await client.query('ROLLBACK');
      if ((err as { code?: string }).code === '23505') {
        throw Object.assign(new Error('Un budget existe déjà pour cet exercice et ce périmètre'), { statusCode: 409 });
      }
      throw err;
    } finally {
      client.release();
    }
  },

  /** Saisie : remplace les montants des cellules envoyées. Budget approuvé = figé. */
  async saveLines(budgetId: string, lines: { account_id: string; month: number; amount: number }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT status FROM budgets WHERE id = $1 FOR UPDATE`, [budgetId]);
      if (!rows[0]) throw Object.assign(new Error('Budget introuvable'), { statusCode: 404 });
      if (rows[0].status === 'approved') throw Object.assign(new Error('Budget approuvé : repassez-le en brouillon pour le modifier'), { statusCode: 409 });
      for (const l of lines) {
        await client.query(
          `INSERT INTO budget_lines (budget_id, account_id, month, amount) VALUES ($1, $2, $3, $4)
           ON CONFLICT (budget_id, account_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
          [budgetId, l.account_id, l.month, l.amount],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async setStatus(budgetId: string, status: 'draft' | 'approved', userId: string) {
    const { rows } = await db.query(
      `UPDATE budgets SET status = $2::varchar,
              approved_by = CASE WHEN $2::text = 'approved' THEN $3::uuid END,
              approved_at = CASE WHEN $2::text = 'approved' THEN NOW() END
        WHERE id = $1 RETURNING *`,
      [budgetId, status, userId],
    );
    return rows[0] ?? null;
  },

  async deleteBudget(budgetId: string) {
    const { rowCount } = await db.query(`DELETE FROM budgets WHERE id = $1 AND status = 'draft'`, [budgetId]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Budget vs réel : une ligne par compte, 12 mois de budget et de réel,
   * plus le cumul à date (mois écoulés de l'exercice) pour juger l'écart
   * sans comparer un budget annuel à un réel partiel.
   */
  async comparison(year: number, storeId: string | null) {
    const [accounts, budget, actual] = await Promise.all([
      this.accounts(),
      this.findBudget(year, storeId),
      actualByAccountMonth(year, storeId),
    ]);
    const { rows: lines } = budget
      ? await db.query(`SELECT account_id, month, amount::float FROM budget_lines WHERE budget_id = $1`, [budget.id])
      : { rows: [] as { account_id: string; month: number; amount: number }[] };

    const now = new Date();
    const elapsed = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
    const empty = () => Array.from({ length: 12 }, () => 0);
    const rows = accounts.map(a => ({ ...a, budget: empty(), actual: empty() }));
    const byId = new Map(rows.map(r => [r.id as string, r]));
    for (const l of lines) { const r = byId.get(l.account_id); if (r) r.budget[l.month - 1] = l.amount; }
    for (const l of actual) { const r = byId.get(l.account_id); if (r) r.actual[l.month - 1] = l.amount; }

    const sum = (arr: number[], n = 12) => arr.slice(0, n).reduce((s, v) => s + v, 0);
    const withTotals = rows.map(r => ({
      ...r,
      budget_year: sum(r.budget),
      actual_year: sum(r.actual),
      budget_ytd: sum(r.budget, elapsed),
      actual_ytd: sum(r.actual, elapsed),
    }));
    const total = (cls: number, key: 'budget' | 'actual') => Array.from({ length: 12 }, (_, m) =>
      withTotals.filter(r => r.account_class === cls).reduce((s, r) => s + r[key][m], 0));
    const produitsB = total(7, 'budget'), produitsA = total(7, 'actual');
    const chargesB = total(6, 'budget'), chargesA = total(6, 'actual');

    return {
      year, store_id: storeId, budget, elapsed_months: elapsed,
      rows: withTotals,
      totals: {
        produits: { budget: produitsB, actual: produitsA },
        charges: { budget: chargesB, actual: chargesA },
        resultat: {
          budget: produitsB.map((v, i) => v - chargesB[i]),
          actual: produitsA.map((v, i) => v - chargesA[i]),
        },
      },
    };
  },

  /** Compte de résultat par magasin sur l'exercice (écritures sans magasin à part). */
  async resultByStore(year: number) {
    const { rows } = await db.query(
      `SELECT je.store_id, st.name AS store_name,
              SUM(CASE WHEN a.account_class = 7 THEN jel.credit - jel.debit ELSE 0 END)::float AS produits,
              SUM(CASE WHEN a.account_class = 6 THEN jel.debit - jel.credit ELSE 0 END)::float AS charges
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         LEFT JOIN stores st ON st.id = je.store_id
        WHERE je.status IN ('posted', 'reversed') AND a.account_class IN (6, 7)
          AND EXTRACT(YEAR FROM je.entry_date) = $1
        GROUP BY je.store_id, st.name
        ORDER BY st.name NULLS LAST`,
      [year],
    );
    return rows.map(r => ({ ...r, resultat: r.produits - r.charges }));
  },

  // ─── Marges ───────────────────────────────────────────────────────────

  async margins(p: { from: string; to: string; storeId: string | null; groupBy: 'category' | 'channel' | 'product' }) {
    const key = {
      category: `COALESCE(c.name, 'Sans catégorie')`,
      channel: `COALESCE(ch.label, 'Non renseigné')`,
      product: `pr.name`,
    }[p.groupBy];
    // Statut du coût, par produit et par canal (le prix moyen dépend du canal) :
    //   missing    : aucun coût de revient connu, ou vente au poids ;
    //   incoherent : coût ≥ prix moyen de vente → unité différente entre la vente
    //                et la fiche (ex. entremets entier vs part) ou coût faux ;
    //   ok         : retenu dans la marge.
    const { rows } = await db.query(
      `WITH per_product AS (
         SELECT v.product_id, v.channel_id,
                SUM(v.qty) AS qty, SUM(v.revenue) AS revenue,
                BOOL_AND(v.unit = 'unit') AS unit_only,
                MAX(uc.unit_cost) AS unit_cost
           FROM v_sales_product_daily v
           LEFT JOIN v_product_unit_cost uc ON uc.product_id = v.product_id
          WHERE v.business_date BETWEEN $1::date AND $2::date
            AND ($3::uuid IS NULL OR v.store_id = $3::uuid)
          GROUP BY v.product_id, v.channel_id
       ), s AS (
         SELECT pp.*,
                CASE WHEN pp.unit_cost IS NULL OR NOT pp.unit_only THEN 'missing'
                     WHEN pp.qty > 0 AND pp.unit_cost >= pp.revenue / pp.qty THEN 'incoherent'
                     ELSE 'ok' END AS cost_status
           FROM per_product pp
       )
       SELECT ${key} AS key,
              SUM(s.qty)::float AS qty,
              SUM(s.revenue)::float AS revenue,
              SUM(s.revenue) FILTER (WHERE s.cost_status = 'ok')::float AS revenue_costed,
              SUM(s.qty * s.unit_cost) FILTER (WHERE s.cost_status = 'ok')::float AS cost,
              COUNT(DISTINCT s.product_id) AS products,
              COUNT(DISTINCT s.product_id) FILTER (WHERE s.cost_status = 'missing') AS products_without_cost,
              COUNT(DISTINCT s.product_id) FILTER (WHERE s.cost_status = 'incoherent') AS products_incoherent
         FROM s
         JOIN products pr ON pr.id = s.product_id
         LEFT JOIN categories c ON c.id = pr.category_id
         LEFT JOIN sales_channels ch ON ch.id = s.channel_id
        GROUP BY 1
        ORDER BY revenue DESC NULLS LAST
        LIMIT 300`,
      [p.from, p.to, p.storeId],
    );
    // Produits à corriger, par CA décroissant : c'est là que la marge est la plus faussée.
    const { rows: toFix } = await db.query(
      `SELECT pr.name, c.name AS category, uc.unit_cost::float, uc.cost_source,
              SUM(v.qty)::float AS qty, SUM(v.revenue)::float AS revenue,
              (SUM(v.revenue) / NULLIF(SUM(v.qty), 0))::float AS avg_price,
              CASE WHEN uc.unit_cost IS NULL THEN 'missing' ELSE 'incoherent' END AS issue
         FROM v_sales_product_daily v
         JOIN products pr ON pr.id = v.product_id
         LEFT JOIN categories c ON c.id = pr.category_id
         LEFT JOIN v_product_unit_cost uc ON uc.product_id = v.product_id
        WHERE v.business_date BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR v.store_id = $3::uuid) AND v.unit = 'unit'
        GROUP BY pr.name, c.name, uc.unit_cost, uc.cost_source
       HAVING uc.unit_cost IS NULL OR uc.unit_cost >= SUM(v.revenue) / NULLIF(SUM(v.qty), 0)
        ORDER BY SUM(v.revenue) DESC
        LIMIT 30`,
      [p.from, p.to, p.storeId],
    );
    const groups = rows.map(r => {
      const revenueCosted = r.revenue_costed ?? 0;
      const cost = r.cost ?? 0;
      const margin = revenueCosted - cost;
      return {
        key: r.key as string,
        qty: r.qty ?? 0,
        revenue: r.revenue ?? 0,
        revenue_costed: revenueCosted,
        cost,
        margin,
        margin_pct: revenueCosted > 0 ? Math.round((margin / revenueCosted) * 1000) / 10 : null,
        coverage_pct: r.revenue > 0 ? Math.round((revenueCosted / r.revenue) * 1000) / 10 : null,
        products: Number(r.products),
        products_without_cost: Number(r.products_without_cost),
        products_incoherent: Number(r.products_incoherent),
      };
    });
    const tot = groups.reduce((a, g) => ({
      revenue: a.revenue + g.revenue, revenue_costed: a.revenue_costed + g.revenue_costed, cost: a.cost + g.cost,
    }), { revenue: 0, revenue_costed: 0, cost: 0 });
    const margin = tot.revenue_costed - tot.cost;
    return {
      groups,
      toFix,
      total: {
        ...tot,
        margin,
        margin_pct: tot.revenue_costed > 0 ? Math.round((margin / tot.revenue_costed) * 1000) / 10 : null,
        coverage_pct: tot.revenue > 0 ? Math.round((tot.revenue_costed / tot.revenue) * 1000) / 10 : null,
      },
    };
  },
};
