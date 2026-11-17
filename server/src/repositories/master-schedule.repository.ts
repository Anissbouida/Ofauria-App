import { db, withTransaction } from '../config/database.js';
import { forecastRepository } from './forecast.repository.js';

/**
 * Plan directeur enregistré (G5-05, mig 553) : quantité à produire par article et par
 * semaine (lundi), par établissement. Lu par le calcul des besoins phasé à la place de
 * la prévision (services/mrp-phased.ts).
 */
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Lundi de la semaine d'une date (AAAA-MM-JJ). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lundi
  return addDays(date, -dow);
}

export const masterScheduleRepository = {
  /** Grille : produits (prévus ou déjà saisis) × semaines, prévision et quantité saisie. */
  async grid(storeId: string, from: string, weeks: number) {
    const start = mondayOf(from);
    const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(start, i * 7));
    const end = addDays(weekStarts[weekStarts.length - 1], 6);
    const fc = await forecastRepository.compute(storeId, start, end, { withMarkup: true });
    const saved = (await db.query(
      `SELECT m.product_id, m.week_start::text AS week_start, m.quantity::float8 AS quantity
         FROM master_schedule_entries m WHERE m.store_id = $1 AND m.week_start BETWEEN $2::date AND $3::date`,
      [storeId, start, weekStarts[weekStarts.length - 1]])).rows;
    const rows = new Map<string, { product_id: string; product_name: string; category_name: string | null; weeks: Record<string, { forecast: number; planned: number | null }> }>();
    const row = (id: string, name: string, cat: string | null) => {
      if (!rows.has(id)) rows.set(id, { product_id: id, product_name: name, category_name: cat, weeks: Object.fromEntries(weekStarts.map(w => [w, { forecast: 0, planned: null }])) });
      return rows.get(id)!;
    };
    for (const r of fc.rows) {
      const it = row(r.product_id, r.product_name, r.category_name ?? null);
      for (const [d, v] of Object.entries(r.days as Record<string, { qty: number }>)) {
        const w = mondayOf(d);
        if (it.weeks[w]) it.weeks[w].forecast += Number(v?.qty ?? 0);
      }
    }
    const missing = saved.filter(s => !rows.has(s.product_id)).map(s => s.product_id);
    if (missing.length) {
      const names = await db.query(`SELECT p.id, p.name, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ANY($1::uuid[])`, [missing]);
      for (const n of names.rows) row(n.id, n.name, n.category_name);
    }
    for (const s of saved) { const it = rows.get(s.product_id); if (it?.weeks[s.week_start]) it.weeks[s.week_start].planned = s.quantity; }
    const list = [...rows.values()]
      .map(r => ({ ...r, weeks: Object.fromEntries(Object.entries(r.weeks).map(([w, v]) => [w, { forecast: Math.round(v.forecast * 1000) / 1000, planned: v.planned }])) }))
      .filter(r => Object.values(r.weeks).some(v => v.forecast > 0 || v.planned != null))
      .sort((a, b) => (a.category_name ?? '').localeCompare(b.category_name ?? '') || a.product_name.localeCompare(b.product_name));
    return { weeks: weekStarts, rows: list };
  },

  /** Enregistre des cellules (quantity null = retour à la prévision). */
  async save(storeId: string, entries: { productId: string; weekStart: string; quantity: number | null }[], userId: string) {
    return withTransaction(async () => {
      let saved = 0; let cleared = 0;
      for (const e of entries) {
        const week = mondayOf(e.weekStart);
        if (e.quantity == null) {
          cleared += (await db.query(`DELETE FROM master_schedule_entries WHERE store_id = $1 AND product_id = $2 AND week_start = $3::date`, [storeId, e.productId, week])).rowCount ?? 0;
        } else {
          await db.query(
            `INSERT INTO master_schedule_entries (store_id, product_id, week_start, quantity, updated_by)
             VALUES ($1, $2, $3::date, $4, $5)
             ON CONFLICT (store_id, product_id, week_start) DO UPDATE SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [storeId, e.productId, week, e.quantity, userId]);
          saved++;
        }
      }
      return { saved, cleared };
    });
  },

  /** Semaines saisies sur une période : produit → lundi → quantité. */
  async entries(storeId: string, from: string, to: string): Promise<Map<string, Map<string, number>>> {
    const r = await db.query(
      `SELECT product_id, week_start::text AS w, quantity::float8 AS q FROM master_schedule_entries
        WHERE store_id = $1 AND week_start BETWEEN $2::date AND $3::date`, [storeId, mondayOf(from), to]);
    const out = new Map<string, Map<string, number>>();
    for (const x of r.rows) { if (!out.has(x.product_id)) out.set(x.product_id, new Map()); out.get(x.product_id)!.set(x.w, Number(x.q)); }
    return out;
  },
};
