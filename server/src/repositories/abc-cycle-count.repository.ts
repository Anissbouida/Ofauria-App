import { db, withTransaction } from '../config/database.js';
import { getParameter } from '../services/module-parameters.service.js';
import { stockCountRepository } from './stock-count.repository.js';

/**
 * Classes ABC et inventaire tournant (G5-03, mig 551).
 *
 * Classe d'un article dans son établissement : valeur consommée sur 12 mois (sorties
 * usage et production × coût unitaire actuel), cumulée de la plus forte à la plus
 * faible : A jusqu'à a_share % de la valeur totale, B jusqu'à b_share %, C au-delà et
 * tout article sans consommation.
 * Article dû : jamais compté dans un inventaire validé, ou dernier comptage plus vieux
 * que la fréquence de sa classe. La campagne tournante est une campagne partielle du
 * module Inventaires, limitée aux articles dus (A d'abord, puis par retard).
 */
type Params = { a_share: number; b_share: number; a_days: number; b_days: number; c_days: number; max_lines: number };

async function params(): Promise<Params> {
  const p = await getParameter<Partial<Params>>('stock.cycle_count');
  return {
    a_share: Number(p?.a_share ?? 80), b_share: Number(p?.b_share ?? 95),
    a_days: Number(p?.a_days ?? 30), b_days: Number(p?.b_days ?? 90), c_days: Number(p?.c_days ?? 180),
    max_lines: Number(p?.max_lines ?? 40),
  };
}

export const abcCycleCountRepository = {
  /** Recalcule les classes de toutes les lignes d'inventaire (ou d'un établissement). */
  async classify(storeId?: string | null): Promise<{ A: number; B: number; C: number }> {
    const p = await params();
    const r = await withTransaction(() => db.query(
      `WITH used AS (
         SELECT t.ingredient_id, t.store_id, -SUM(t.quantity_change) AS qty
           FROM inventory_transactions t
          WHERE t.quantity_change < 0 AND t.type IN ('usage', 'production') AND t.created_at >= now() - interval '12 months'
          GROUP BY 1, 2
       ), valued AS (
         SELECT i.id, i.store_id, COALESCE(u.qty, 0) * g.unit_cost AS value
           FROM inventory i
           JOIN ingredients g ON g.id = i.ingredient_id
           LEFT JOIN used u ON u.ingredient_id = i.ingredient_id AND u.store_id IS NOT DISTINCT FROM i.store_id
          WHERE $1::uuid IS NULL OR i.store_id = $1::uuid
       ), ranked AS (
         SELECT id, value,
                SUM(value) OVER (PARTITION BY store_id ORDER BY value DESC, id ROWS UNBOUNDED PRECEDING) AS cum,
                SUM(value) OVER (PARTITION BY store_id) AS total
           FROM valued
       )
       UPDATE inventory i
          SET abc_value = ROUND(r.value, 2), abc_computed_at = now(),
              abc_class = CASE WHEN r.value <= 0 OR r.total <= 0 THEN 'C'
                               WHEN r.cum - r.value < r.total * $2::numeric / 100 THEN 'A'
                               WHEN r.cum - r.value < r.total * $3::numeric / 100 THEN 'B'
                               ELSE 'C' END
         FROM ranked r WHERE r.id = i.id
       RETURNING i.abc_class`, [storeId ?? null, p.a_share, p.b_share]));
    const out = { A: 0, B: 0, C: 0 };
    for (const row of r.rows) out[row.abc_class as 'A' | 'B' | 'C']++;
    return out;
  },

  /** Articles de l'établissement avec classe, dernier comptage validé et échéance. */
  async board(storeId: string | null) {
    const p = await params();
    const rows = (await db.query(
      `WITH last AS (
         SELECT l.ingredient_id, MAX(c.count_date) AS last_count
           FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
          WHERE c.status = 'validated' AND l.ingredient_id IS NOT NULL AND c.store_id IS NOT DISTINCT FROM $1::uuid
            AND l.counted_qty IS NOT NULL
          GROUP BY l.ingredient_id
       )
       SELECT i.ingredient_id, g.name AS ingredient_name, g.unit, COALESCE(i.abc_class, 'C') AS abc_class,
              COALESCE(i.abc_value, 0)::float8 AS abc_value, last.last_count,
              (last.last_count + CASE COALESCE(i.abc_class, 'C') WHEN 'A' THEN $2::int WHEN 'B' THEN $3::int ELSE $4::int END) AS due_date
         FROM inventory i
         JOIN ingredients g ON g.id = i.ingredient_id
         LEFT JOIN last ON last.ingredient_id = i.ingredient_id
        WHERE i.store_id IS NOT DISTINCT FROM $1::uuid AND COALESCE(g.non_stocke, false) = false
        ORDER BY COALESCE(i.abc_class, 'C'), COALESCE(i.abc_value, 0) DESC`,
      [storeId, p.a_days, p.b_days, p.c_days])).rows as Array<{
        ingredient_id: string; ingredient_name: string; unit: string; abc_class: 'A' | 'B' | 'C';
        abc_value: number; last_count: string | null; due_date: string | null;
      }>;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
    const withDue = rows.map(r => ({ ...r, due: !r.due_date || String(r.due_date).slice(0, 10) <= today }));
    const classes = (['A', 'B', 'C'] as const).map(c => ({
      class: c, items: withDue.filter(r => r.abc_class === c).length, due: withDue.filter(r => r.abc_class === c && r.due).length,
      value: Math.round(withDue.filter(r => r.abc_class === c).reduce((t, r) => t + r.abc_value, 0) * 100) / 100,
    }));
    return { params: p, classes, rows: withDue };
  },

  /** Ouvre la campagne tournante : les articles dus, A d'abord, au plus max_lines. */
  async generate(storeId: string | null, userId: string | null) {
    const b = await this.board(storeId);
    const order = { A: 0, B: 1, C: 2 } as const;
    const due = b.rows.filter(r => r.due)
      .sort((x, y) => order[x.abc_class] - order[y.abc_class] || String(x.due_date ?? '').localeCompare(String(y.due_date ?? '')))
      .slice(0, b.params.max_lines);
    if (!due.length) return { error: 'Aucun article à compter : tous les comptages sont à jour' };
    const by = (c: string) => due.filter(d => d.abc_class === c).length;
    return stockCountRepository.create({
      title: `Inventaire tournant — A ${by('A')} · B ${by('B')} · C ${by('C')}`,
      itemKinds: 'ingredient', blind: true, ingredientIds: due.map(d => d.ingredient_id),
      notes: 'Campagne générée par l\'inventaire tournant (classes ABC).',
    }, { userId: userId as string, storeId });
  },
};

/** Tâche planifiée cycle_counts : classes recalculées, campagne ouverte par établissement libre. */
export async function cycleCountJob(): Promise<{ items: number; message: string }> {
  await abcCycleCountRepository.classify();
  const stores = (await db.query(
    `SELECT DISTINCT i.store_id FROM inventory i
      WHERE i.store_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.status IN ('counting', 'review') AND c.store_id = i.store_id)`)).rows;
  let opened = 0;
  for (const s of stores) {
    const r = await abcCycleCountRepository.generate(s.store_id, null);
    if (!('error' in r)) opened++;
  }
  return { items: opened, message: `${opened} campagne(s) tournante(s) ouverte(s)` };
}
