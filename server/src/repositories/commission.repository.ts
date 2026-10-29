import { db } from '../config/database.js';

/**
 * Commissions commerciales (règles mig 123, employee_commissions). Les barèmes
 * existaient mais n'étaient ni éditables ni calculés. Ici : CRUD des barèmes et
 * relevé des commissions dues sur une période, par vendeur (sales.employee_id).
 *
 * Spécificité : un barème 'product' (sur un produit) l'emporte sur 'all'. Le
 * champ 'category' du schéma n'est pas exploité en v1 (les catégories produit
 * sont en entier, l'applies_id est un UUID — incompatibles).
 *
 * Base : lignes de ventes de biens (sale_type standard/delivery/special), hors
 * avances (comptées à la livraison) ; brut, retours non déduits en v1.
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const NAME = `e.first_name || ' ' || e.last_name`;
const SALE_TYPES = `('standard', 'delivery', 'special')`;

export type CommissionRuleInput = {
  employeeId: string; ratePercent: number; appliesTo: 'all' | 'product'; appliesId?: string | null;
  validFrom: string; validTo?: string | null;
};

export const commissionRepository = {
  /* ─── Barèmes ─────────────────────────────────────────────────────────── */
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

  /* ─── Relevé des commissions dues sur une période ─────────────────────── */
  /**
   * Pour chaque ligne de vente attribuée à un vendeur sur la période, applique
   * le barème le plus spécifique en vigueur à la date de la vente (produit > all)
   * et somme par vendeur. base = subtotal de la ligne.
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
              ROUND(SUM(l.commission), 2)::float8 AS commission
         FROM lines l JOIN employees e ON e.id = l.employee_id
        GROUP BY l.employee_id, e.first_name, e.last_name, e.role
        ORDER BY commission DESC, employee_name`, values);

    const totals = rows.rows.reduce(
      (a: { sales_base: number; commission: number }, r: { sales_base: number; commission: number }) =>
        ({ sales_base: round2(a.sales_base + Number(r.sales_base)), commission: round2(a.commission + Number(r.commission)) }),
      { sales_base: 0, commission: 0 });
    return { rows: rows.rows, totals };
  },
};
