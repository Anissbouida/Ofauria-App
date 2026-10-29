import { db } from '../config/database.js';

/**
 * Commissions commerciales (règles mig 123 + contrats-cadres à paliers et
 * versement sur paie mig 393). Deux modes de commissionnement par vendeur :
 *   - taux FIXES par produit / tous produits (employee_commissions) ;
 *   - contrat-cadre à PALIERS progressifs (commission_schemes), appliqué à la
 *     base de ventes de la période ; prioritaire quand un vendeur y est affecté.
 *
 * Spécificité des taux fixes : un barème 'product' l'emporte sur 'all'. Le
 * versement crée un élément fixe de paie (rubrique COMMISSION) repris comme gain
 * sur le bulletin du mois choisi, idempotent par (vendeur, période).
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const NAME = `e.first_name || ' ' || e.last_name`;
const SALE_TYPES = `('standard', 'delivery', 'special')`;

export type CommissionRuleInput = {
  employeeId: string; ratePercent: number; appliesTo: 'all' | 'product'; appliesId?: string | null;
  validFrom: string; validTo?: string | null;
};
export type SchemeTierInput = { fromAmount: number; ratePercent: number };
export type CommissionSchemeInput = { name: string; isActive?: boolean; notes?: string | null; storeId?: string | null; tiers: SchemeTierInput[] };
export type SchemeAssignInput = { employeeId: string; schemeId: string; validFrom: string; validTo?: string | null };

/** Commission progressive par paliers : la tranche de base dans [seuil_i, seuil_i+1[ est au taux i. */
function tieredCommission(base: number, tiers: { from_amount: number | string; rate_percent: number | string }[]): number {
  const sorted = tiers.map(t => ({ from: Number(t.from_amount), rate: Number(t.rate_percent) })).sort((a, b) => a.from - b.from);
  let commission = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i].from;
    if (base <= lo) break;
    const hi = i + 1 < sorted.length ? sorted[i + 1].from : Infinity;
    const portion = Math.max(0, Math.min(base, hi) - lo);
    commission += (portion * sorted[i].rate) / 100;
  }
  return round2(commission);
}

function monthBounds(month: number, year: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

export const commissionRepository = {
  /* ─── Barèmes à taux fixe (mig 123) ──────────────────────────────────── */
  async listRules(employeeId?: string) {
    const params: unknown[] = [];
    let where = '';
    if (employeeId) { params.push(employeeId); where = `WHERE c.employee_id = $1`; }
    const r = await db.query(
      `SELECT c.*, ${NAME} AS employee_name, p.name AS product_name,
              (c.valid_to IS NULL OR c.valid_to >= CURRENT_DATE) AS is_current
         FROM employee_commissions c
         JOIN employees e ON e.id = c.employee_id
         LEFT JOIN products p ON p.id = c.applies_id AND c.applies_to = 'product'
         ${where}
        ORDER BY ${NAME}, c.valid_from DESC`, params);
    return r.rows;
  },

  async createRule(input: CommissionRuleInput) {
    if (input.appliesTo === 'product' && !input.appliesId) return { error: 'Choisissez un produit' };
    const r = await db.query(
      `INSERT INTO employee_commissions (employee_id, rate_percent, applies_to, applies_id, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.employeeId, round2(input.ratePercent), input.appliesTo,
       input.appliesTo === 'product' ? input.appliesId : null, input.validFrom, input.validTo || null]);
    return { id: r.rows[0].id };
  },

  async updateRule(id: string, input: CommissionRuleInput) {
    if (input.appliesTo === 'product' && !input.appliesId) return { error: 'Choisissez un produit' };
    const r = await db.query(
      `UPDATE employee_commissions SET rate_percent = $2, applies_to = $3, applies_id = $4, valid_from = $5, valid_to = $6
        WHERE id = $1 RETURNING id`,
      [id, round2(input.ratePercent), input.appliesTo,
       input.appliesTo === 'product' ? input.appliesId : null, input.validFrom, input.validTo || null]);
    return r.rows[0] ? { id } : { error: 'Barème introuvable' };
  },

  async deleteRule(id: string) {
    await db.query(`DELETE FROM employee_commissions WHERE id = $1`, [id]);
  },

  /* ─── Contrats-cadres à paliers (mig 393) ────────────────────────────── */
  async listSchemes() {
    const r = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM employee_commission_schemes a
                WHERE a.scheme_id = s.id AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE)) AS assigned_count,
              COALESCE((SELECT json_agg(json_build_object('id', t.id, 'from_amount', t.from_amount, 'rate_percent', t.rate_percent) ORDER BY t.from_amount)
                          FROM commission_scheme_tiers t WHERE t.scheme_id = s.id), '[]') AS tiers
         FROM commission_schemes s
        ORDER BY s.is_active DESC, s.name`);
    return r.rows;
  },

  async createScheme(input: CommissionSchemeInput, userId: string) {
    if (!input.name?.trim()) return { error: 'Nom requis' };
    if (!input.tiers?.length) return { error: 'Au moins un palier' };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const s = await client.query(
        `INSERT INTO commission_schemes (name, is_active, notes, store_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.name.trim(), input.isActive ?? true, input.notes?.trim() || null, input.storeId ?? null, userId]);
      const id = s.rows[0].id as string;
      await this._replaceTiers(client, id, input.tiers);
      await client.query('COMMIT');
      return { id };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  async updateScheme(id: string, input: CommissionSchemeInput) {
    if (!input.tiers?.length) return { error: 'Au moins un palier' };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE commission_schemes SET name = $2, is_active = $3, notes = $4 WHERE id = $1 RETURNING id`,
        [id, input.name.trim(), input.isActive ?? true, input.notes?.trim() || null]);
      if (!r.rows[0]) { await client.query('ROLLBACK'); return { error: 'Contrat-cadre introuvable' }; }
      await this._replaceTiers(client, id, input.tiers);
      await client.query('COMMIT');
      return { id };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },

  async _replaceTiers(client: { query: (q: string, v?: unknown[]) => Promise<unknown> }, schemeId: string, tiers: SchemeTierInput[]) {
    await client.query(`DELETE FROM commission_scheme_tiers WHERE scheme_id = $1`, [schemeId]);
    let order = 0;
    // Dédoublonne les seuils et trie (contrainte UNIQUE (scheme_id, from_amount)).
    const seen = new Set<number>();
    for (const t of [...tiers].sort((a, b) => a.fromAmount - b.fromAmount)) {
      const from = Math.max(0, Number(t.fromAmount) || 0);
      if (seen.has(from)) continue;
      seen.add(from);
      await client.query(
        `INSERT INTO commission_scheme_tiers (scheme_id, from_amount, rate_percent, display_order) VALUES ($1, $2, $3, $4)`,
        [schemeId, from, round2(t.ratePercent), (order += 10)]);
    }
  },

  async deleteScheme(id: string) {
    await db.query(`DELETE FROM commission_schemes WHERE id = $1`, [id]);
  },

  /* ─── Affectation d'un contrat-cadre à un vendeur ────────────────────── */
  async listAssignments(employeeId?: string) {
    const params: unknown[] = [];
    let where = '';
    if (employeeId) { params.push(employeeId); where = `WHERE a.employee_id = $1`; }
    const r = await db.query(
      `SELECT a.*, ${NAME} AS employee_name, s.name AS scheme_name,
              (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE) AS is_current
         FROM employee_commission_schemes a
         JOIN employees e ON e.id = a.employee_id
         JOIN commission_schemes s ON s.id = a.scheme_id
         ${where}
        ORDER BY ${NAME}, a.valid_from DESC`, params);
    return r.rows;
  },

  async assignScheme(input: SchemeAssignInput) {
    const r = await db.query(
      `INSERT INTO employee_commission_schemes (employee_id, scheme_id, valid_from, valid_to) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.employeeId, input.schemeId, input.validFrom, input.validTo || null]);
    return { id: r.rows[0].id };
  },

  async unassignScheme(id: string) {
    await db.query(`DELETE FROM employee_commission_schemes WHERE id = $1`, [id]);
  },

  /* ─── Relevé des commissions dues ────────────────────────────────────── */
  /**
   * Par vendeur sur la période : base de ventes et commission aux taux fixes
   * (par ligne, barème le plus spécifique en vigueur à la date). Pour les vendeurs
   * affectés à un contrat-cadre en vigueur, la commission effective est recalculée
   * aux paliers sur la base totale (prioritaire). `already_paid` = période déjà versée.
   */
  async statement(p: { from: string; to: string; employeeId?: string; storeId?: string | null }) {
    const values: unknown[] = [p.from, p.to];
    const conds = [`s.created_at::date BETWEEN $1 AND $2`, `s.sale_type IN ${SALE_TYPES}`, `s.employee_id IS NOT NULL`];
    if (p.employeeId) { values.push(p.employeeId); conds.push(`s.employee_id = $${values.length}`); }
    if (p.storeId) { values.push(p.storeId); conds.push(`(s.store_id IS NULL OR s.store_id = $${values.length})`); }

    const rows = await db.query(
      `WITH lines AS (
         SELECT s.employee_id, s.id AS sale_id,
                si.subtotal AS base,
                COALESCE(rule.rate_percent, 0) AS rate,
                ROUND(si.subtotal * COALESCE(rule.rate_percent, 0) / 100.0, 2) AS commission
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.id
           LEFT JOIN LATERAL (
             SELECT ec.rate_percent
               FROM employee_commissions ec
              WHERE ec.employee_id = s.employee_id
                AND ec.valid_from <= s.created_at::date
                AND (ec.valid_to IS NULL OR ec.valid_to >= s.created_at::date)
                AND (ec.applies_to = 'all' OR (ec.applies_to = 'product' AND ec.applies_id = si.product_id))
              ORDER BY CASE ec.applies_to WHEN 'product' THEN 2 ELSE 0 END DESC, ec.valid_from DESC
              LIMIT 1
           ) rule ON true
          WHERE ${conds.join(' AND ')}
       )
       SELECT l.employee_id, ${NAME} AS employee_name, e.role,
              COUNT(DISTINCT l.sale_id)::int AS sale_count,
              ROUND(SUM(l.base), 2)::float8 AS sales_base,
              ROUND(SUM(l.base) FILTER (WHERE l.rate > 0), 2)::float8 AS commissionable_base,
              ROUND(SUM(l.commission), 2)::float8 AS commission_rules,
              (EXISTS (SELECT 1 FROM commission_payouts cp
                        WHERE cp.employee_id = l.employee_id AND cp.period_from = $1 AND cp.period_to = $2)) AS already_paid
         FROM lines l JOIN employees e ON e.id = l.employee_id
        GROUP BY l.employee_id, e.first_name, e.last_name, e.role
        ORDER BY employee_name`, values);

    // Contrats-cadres en vigueur sur la période (paliers prioritaires).
    const empIds = rows.rows.map((r: { employee_id: string }) => r.employee_id);
    const schemes = empIds.length
      ? (await db.query(
          `SELECT DISTINCT ON (a.employee_id) a.employee_id, s.id AS scheme_id, s.name AS scheme_name,
                  COALESCE((SELECT json_agg(json_build_object('from_amount', t.from_amount, 'rate_percent', t.rate_percent) ORDER BY t.from_amount)
                              FROM commission_scheme_tiers t WHERE t.scheme_id = s.id), '[]') AS tiers
             FROM employee_commission_schemes a
             JOIN commission_schemes s ON s.id = a.scheme_id AND s.is_active
            WHERE a.employee_id = ANY($1::uuid[])
              AND a.valid_from <= $3 AND (a.valid_to IS NULL OR a.valid_to >= $2)
            ORDER BY a.employee_id, a.valid_from DESC`,
          [empIds, p.from, p.to])).rows
      : [];
    const schemeByEmp = new Map(schemes.map((s: Record<string, any>) => [s.employee_id, s]));

    const out: Record<string, any>[] = rows.rows.map((r: Record<string, any>) => {
      const sc = schemeByEmp.get(r.employee_id);
      const commissionScheme = sc ? tieredCommission(Number(r.sales_base), sc.tiers) : null;
      const mode: 'rules' | 'scheme' = sc ? 'scheme' : 'rules';
      const commission = mode === 'scheme' ? (commissionScheme ?? 0) : Number(r.commission_rules);
      return { ...r, scheme_id: sc?.scheme_id ?? null, scheme_name: sc?.scheme_name ?? null,
               commission_scheme: commissionScheme, mode, commission: round2(commission) };
    });
    const totals = out.reduce(
      (a: { sales_base: number; commission: number }, r: Record<string, any>) =>
        ({ sales_base: round2(a.sales_base + Number(r.sales_base)), commission: round2(a.commission + Number(r.commission)) }),
      { sales_base: 0, commission: 0 });
    return { rows: out, totals };
  },

  /* ─── Versement sur bulletin de paie ─────────────────────────────────── */
  /**
   * Verse les commissions dues d'une période sur le bulletin du mois choisi :
   * un élément fixe de paie (rubrique COMMISSION) par vendeur, borné au mois de
   * paie → repris comme gain imposable au calcul du bulletin. Idempotent :
   * une période déjà versée pour un vendeur est ignorée.
   */
  async payout(p: { from: string; to: string; payMonth: number; payYear: number; employeeId?: string; storeId?: string | null }, userId: string) {
    const { rows } = await this.statement({ from: p.from, to: p.to, employeeId: p.employeeId, storeId: p.storeId });
    const due = rows.filter((r: Record<string, any>) => Number(r.commission) > 0);
    if (!due.length) return { versed: [], skipped: [], rubriqueMissing: false };

    const rub = (await db.query(`SELECT id FROM payroll_rubriques WHERE code = 'COMMISSION' LIMIT 1`)).rows[0];
    if (!rub) return { versed: [], skipped: [], rubriqueMissing: true };

    const { start, end } = monthBounds(p.payMonth, p.payYear);
    const versed: Record<string, any>[] = [];
    const skipped: Record<string, any>[] = [];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const r of due) {
        const exists = (await client.query(
          `SELECT 1 FROM commission_payouts WHERE employee_id = $1 AND period_from = $2 AND period_to = $3`,
          [r.employee_id, p.from, p.to])).rows[0];
        if (exists) { skipped.push({ employee_id: r.employee_id, employee_name: r.employee_name }); continue; }
        const item = (await client.query(
          `INSERT INTO employee_payroll_items (employee_id, rubrique_id, amount, start_date, end_date, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [r.employee_id, rub.id, round2(Number(r.commission)), start, end,
           `Commissions du ${p.from} au ${p.to}`, userId])).rows[0];
        await client.query(
          `INSERT INTO commission_payouts (employee_id, period_from, period_to, pay_month, pay_year, amount, basis, source, payroll_item_id, store_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [r.employee_id, p.from, p.to, p.payMonth, p.payYear, round2(Number(r.commission)),
           round2(Number(r.sales_base)), r.mode, item.id, p.storeId ?? null, userId]);
        versed.push({ employee_id: r.employee_id, employee_name: r.employee_name, amount: round2(Number(r.commission)) });
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return { versed, skipped, rubriqueMissing: false, payMonth: p.payMonth, payYear: p.payYear };
  },

  async listPayouts(p: { employeeId?: string; limit: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const where = p.employeeId ? `WHERE cp.employee_id = ${add(p.employeeId)}` : '';
    const lim = add(p.limit);
    const r = await db.query(
      `SELECT cp.*, ${NAME} AS employee_name
         FROM commission_payouts cp JOIN employees e ON e.id = cp.employee_id
         ${where} ORDER BY cp.created_at DESC LIMIT ${lim}`, values);
    return r.rows;
  },
};
