import { db, withTransaction } from '../config/database.js';

/**
 * Prix aberrants et corrections tracées du coût d'un ingrédient (G2-04, mig 540).
 *
 * `suspects()` liste les prix à revoir — sans prix, ou très éloignés de la médiane de leur
 * catégorie (même définition que la qualité des données, G2-02) — avec les trois dernières
 * réceptions et une proposition : leur prix moyen pondéré par les quantités.
 *
 * `correct()` est la seule voie de correction : coût avant, coût après, motif et pièces à
 * l'appui sont enregistrés. Elle ne touche ni les lots ni la comptabilité : le coût
 * catalogue sert au coût des fiches techniques, la valeur du stock vient des lots.
 */

export type Reception = { date: string; voucher: string; quantity: number; unitPrice: number };
export type PriceSuspect = {
  ingredientId: string; name: string; unit: string; category: string | null;
  unitCost: number; median: number | null;
  reason: 'sans_prix' | 'aberrant';
  usedInRecipes: number;
  receptions: Reception[];
  /** Prix moyen des dernières réceptions, pondéré par les quantités ; null sans réception. */
  proposal: number | null;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

async function lastReceptions(ingredientIds: string[]): Promise<Map<string, Reception[]>> {
  const out = new Map<string, Reception[]>();
  if (!ingredientIds.length) return out;
  const rows = (await db.query(
    `SELECT x.ingredient_id, x.date, x.voucher, x.quantity, x.unit_price
       FROM (
         SELECT rvi.ingredient_id, rv.reception_date::date::text AS date, rv.voucher_number AS voucher,
                rvi.quantity_received::float8 AS quantity, rvi.unit_price::float8 AS unit_price,
                ROW_NUMBER() OVER (PARTITION BY rvi.ingredient_id ORDER BY rv.reception_date DESC, rvi.created_at DESC) AS rn
           FROM reception_voucher_items rvi
           JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
          WHERE rvi.ingredient_id = ANY($1) AND rv.status = 'posted'
            AND rvi.unit_price > 0 AND rvi.quantity_received > 0
       ) x
      WHERE x.rn <= 3
      ORDER BY x.ingredient_id, x.rn`, [ingredientIds])).rows;
  for (const r of rows) {
    const list = out.get(r.ingredient_id) ?? [];
    list.push({ date: r.date, voucher: r.voucher, quantity: r.quantity, unitPrice: r.unit_price });
    out.set(r.ingredient_id, list);
  }
  return out;
}

const proposalOf = (receptions: Reception[]): number | null => {
  const qty = receptions.reduce((t, r) => t + r.quantity, 0);
  return qty > 0 ? round4(receptions.reduce((t, r) => t + r.quantity * r.unitPrice, 0) / qty) : null;
};

export const ingredientCostCorrectionRepository = {
  /** Prix à revoir, les plus éloignés de leur catégorie d'abord, puis les prix manquants. */
  async suspects(limit = 300): Promise<PriceSuspect[]> {
    const rows = (await db.query(
      `WITH med AS (
         SELECT category_id, unit, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost) AS median, COUNT(*) AS n
           FROM ingredients WHERE unit_cost > 0 AND category_id IS NOT NULL GROUP BY category_id, unit
       )
       SELECT i.id AS "ingredientId", i.name, i.unit, COALESCE(ec.name, i.category) AS category,
              COALESCE(i.unit_cost, 0)::float8 AS "unitCost", m.median::float8 AS median,
              CASE WHEN COALESCE(i.unit_cost, 0) = 0 THEN 'sans_prix' ELSE 'aberrant' END AS reason,
              (SELECT COUNT(DISTINCT f.recipe_id) FROM recipe_format_components c JOIN recipe_formats f ON f.id = c.format_id AND f.is_active WHERE c.source_ingredient_id = i.id)::int AS "usedInRecipes"
         FROM ingredients i
         LEFT JOIN med m ON m.category_id = i.category_id AND m.unit = i.unit
         LEFT JOIN expense_categories ec ON ec.id = i.category_id
        WHERE COALESCE(i.unit_cost, 0) = 0
           OR (m.n >= 5 AND m.median > 0 AND (i.unit_cost > m.median * 5 OR i.unit_cost < m.median / 5))
        ORDER BY (COALESCE(i.unit_cost, 0) = 0),
                 CASE WHEN i.unit_cost > 0 AND m.median > 0 THEN GREATEST(i.unit_cost / m.median, m.median / i.unit_cost) END DESC NULLS LAST,
                 i.name
        LIMIT $1`, [limit])).rows as Omit<PriceSuspect, 'receptions' | 'proposal'>[];
    const receptions = await lastReceptions(rows.map(r => r.ingredientId));
    return rows.map(r => {
      const list = receptions.get(r.ingredientId) ?? [];
      return { ...r, receptions: list, proposal: proposalOf(list) };
    });
  },

  /** Corrige le coût unitaire avec son motif. Tout ou rien. */
  async correct(ingredientId: string, newCost: number, reason: string, userId: string): Promise<{ error: string } | { id: string; oldCost: number; newCost: number }> {
    const cost = round4(Number(newCost));
    const motif = (reason ?? '').trim();
    if (!Number.isFinite(cost) || cost <= 0) return { error: 'Le nouveau coût doit être supérieur à 0' };
    if (motif.length < 5) return { error: 'Indiquez le motif de la correction (5 caractères au moins)' };
    return withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const ing = (await db.query(`SELECT id, unit, unit_cost, category_id FROM ingredients WHERE id = $1 FOR UPDATE`, [ingredientId])).rows[0];
      if (!ing) return { error: 'Ingrédient introuvable' };
      const oldCost = round4(Number(ing.unit_cost) || 0);
      if (oldCost === cost) return { error: 'Le coût est déjà à cette valeur' };

      const receptions = (await lastReceptions([ingredientId])).get(ingredientId) ?? [];
      const median = (await db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost)::float8 AS median
           FROM ingredients WHERE unit_cost > 0 AND category_id = $1 AND unit = $2 AND id <> $3`,
        [ing.category_id, ing.unit, ingredientId])).rows[0]?.median ?? null;

      await db.query(`UPDATE ingredients SET unit_cost = $2::numeric WHERE id = $1`, [ingredientId, cost]);
      const id = (await db.query(
        `INSERT INTO ingredient_cost_corrections (ingredient_id, old_cost, new_cost, reason, basis, corrected_by)
         VALUES ($1, $2::numeric, $3::numeric, $4, $5::jsonb, $6) RETURNING id`,
        [ingredientId, oldCost, cost, motif, JSON.stringify({ receptions, proposal: proposalOf(receptions), categoryMedian: median }), userId])).rows[0].id as string;
      return { id, oldCost, newCost: cost };
    });
  },

  /** Dernières corrections (journal). */
  async history(limit = 50) {
    return (await db.query(
      `SELECT c.id, c.ingredient_id, i.name AS ingredient_name, i.unit, c.old_cost::float8 AS old_cost, c.new_cost::float8 AS new_cost,
              c.reason, c.corrected_at, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS corrected_by_name
         FROM ingredient_cost_corrections c
         JOIN ingredients i ON i.id = c.ingredient_id
         LEFT JOIN users u ON u.id = c.corrected_by
        ORDER BY c.corrected_at DESC LIMIT $1`, [limit])).rows;
  },
};
