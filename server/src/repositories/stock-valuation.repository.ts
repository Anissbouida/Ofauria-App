import { db } from '../config/database.js';

/**
 * Stock matière à une date (G5-01, mig 549).
 *   stockAt      : quantité, coût en vigueur et valeur par article à la fin d'une date
 *                  (stock courant moins les mouvements journalisés après la date).
 *   journalGaps  : articles dont la somme des mouvements ne donne pas le stock courant —
 *                  les dates antérieures sont fausses pour eux tant que l'écart demeure.
 */
export interface StockAtLine {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  value: number;
}

export const stockValuationRepository = {
  async stockAt(date: string, storeId?: string | null): Promise<{ date: string; lines: StockAtLine[]; total: number; gaps: number }> {
    const lines = (await db.query(
      `SELECT ingredient_id, ingredient_name, unit, quantity::float8 AS quantity, unit_cost::float8 AS unit_cost, value::float8 AS value
         FROM fn_stock_at($1::date, $2::uuid)
        WHERE quantity <> 0
        ORDER BY ingredient_name`, [date, storeId ?? null])).rows as StockAtLine[];
    const gaps = Number((await db.query(`SELECT COUNT(*)::int AS n FROM fn_stock_journal_gaps($1::uuid)`, [storeId ?? null])).rows[0].n);
    return { date, lines, total: Math.round(lines.reduce((t, l) => t + l.value, 0) * 100) / 100, gaps };
  },

  async journalGaps(storeId?: string | null) {
    return (await db.query(
      `SELECT ingredient_id, ingredient_name, unit, store_id,
              current_quantity::float8 AS current_quantity, journal_quantity::float8 AS journal_quantity, gap::float8 AS gap
         FROM fn_stock_journal_gaps($1::uuid) ORDER BY ABS(gap) DESC`, [storeId ?? null])).rows;
  },
};
