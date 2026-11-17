import { db } from '../config/database.js';
import { mrpParams } from './mrp-phased.js';

/**
 * Date de disponibilité promise d'une ligne de commande (G5-06).
 *
 * Disponible projeté = stock libre (stock magasin − déjà réservé par les commandes,
 * mig 389) + production planifiée NON affectée à une ligne de commande (M2-08), cumulée
 * jour par jour. Date promise = premier jour où il couvre la quantité :
 *   « stock »        — aujourd'hui ;
 *   « planifié »     — le jour de l'ordre de fabrication qui complète ;
 *   « à produire »   — produit fabriqué non couvert : aujourd'hui + délai de fabrication
 *                      (la commande déclenche sa production à l'enregistrement) ;
 *   « à approvisionner » — produit acheté non couvert : pas de date.
 * La capacité des ateliers n'est pas prise en compte.
 */
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type PromiseSource = 'stock' | 'planifie' | 'a_produire' | 'a_approvisionner';
export interface PromiseLine { productId: string; quantity: number; date: string | null; source: PromiseSource; available_now: number; planned: { date: string; qty: number }[] }

export async function promiseDates(storeId: string, items: { productId: string; quantity: number }[], today: string): Promise<PromiseLine[]> {
  const ids = [...new Set(items.map(i => i.productId))];
  if (!ids.length) return [];
  const prm = await mrpParams();
  const [stock, planned, made] = await Promise.all([
    db.query(
      `SELECT product_id, GREATEST(SUM(stock_quantity - reserved_quantity), 0)::float8 AS q
         FROM product_store_stock WHERE store_id = $1 AND product_id = ANY($2::uuid[]) GROUP BY product_id`, [storeId, ids]),
    db.query(
      `SELECT pi.product_id, GREATEST(p.plan_date, $3::date)::text AS d, SUM(pi.planned_quantity)::float8 AS q
         FROM production_plan_items pi JOIN production_plans p ON p.id = pi.plan_id
        WHERE pi.product_id = ANY($2::uuid[]) AND pi.order_item_id IS NULL AND pi.cancelled_at IS NULL
          AND pi.status IN ('pending', 'in_progress') AND p.status NOT IN ('completed', 'cancelled')
          AND (p.store_id = $1 OR p.store_id IS NULL) AND p.plan_date >= $3::date - 1
        GROUP BY 1, 2 ORDER BY 2`, [storeId, ids, today]),
    db.query(`SELECT DISTINCT product_id FROM recipes WHERE product_id = ANY($1::uuid[]) AND archived_at IS NULL`, [ids]),
  ]);
  const stockBy = new Map(stock.rows.map(r => [r.product_id as string, Number(r.q)]));
  const madeSet = new Set(made.rows.map(r => r.product_id as string));
  const plannedBy = new Map<string, { date: string; qty: number }[]>();
  for (const r of planned.rows) {
    if (!plannedBy.has(r.product_id)) plannedBy.set(r.product_id, []);
    plannedBy.get(r.product_id)!.push({ date: r.d, qty: Number(r.q) });
  }
  // Plusieurs lignes du même produit se partagent le disponible, dans l'ordre de saisie.
  const consumed = new Map<string, number>();
  return items.map(it => {
    const already = consumed.get(it.productId) ?? 0;
    const need = it.quantity + already;
    consumed.set(it.productId, need);
    const now = stockBy.get(it.productId) ?? 0;
    const plans = plannedBy.get(it.productId) ?? [];
    const base = { productId: it.productId, quantity: it.quantity, available_now: Math.max(0, now - already), planned: plans };
    if (now >= need - 1e-9) return { ...base, date: today, source: 'stock' as const };
    let cum = now;
    for (const p of plans) { cum += p.qty; if (cum >= need - 1e-9) return { ...base, date: p.date, source: 'planifie' as const }; }
    if (madeSet.has(it.productId)) return { ...base, date: addDays(today, prm.product_lead_days), source: 'a_produire' as const };
    return { ...base, date: null, source: 'a_approvisionner' as const };
  });
}
