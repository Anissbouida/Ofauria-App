import { db } from '../config/database.js';
import { forecastRepository } from './forecast.repository.js';

/**
 * MRP — calcul des besoins nets de production (plan directeur / MPS).
 *
 * Répond : « pour une date, combien produire de chaque article, net de ce que
 * j'ai déjà en stock et de ce que je prévois déjà de produire ? ». Additif et en
 * lecture seule : il ne touche pas le moteur de plans. Il consolide la demande
 * (prévision de vente + commandes fermes dues) et la défalque du stock fini
 * disponible et des plans ouverts, pour proposer la quantité nette à produire.
 *
 *   à produire = max(0, (prévision + commandes) − stock disponible − déjà planifié)
 *
 * Pas de double comptage : la demande est brute (prévision + commandes en plein),
 * l'offre est brute (tout le stock + tout le planifié non encore produit).
 */
export const mrpRepository = {
  async netRequirements(storeId: string, date: string) {
    const [fc, ordersRes, stockRes, plannedRes] = await Promise.all([
      // 1. Prévision de vente (demande walk-in) du jour, majorée (comme la fiche de besoin).
      forecastRepository.compute(storeId, date, date, { withMarkup: true }),
      // 2. Commandes fermes dues ce jour (hors annulées / livrées).
      db.query(
        `SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::float AS qty
           FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE o.pickup_date::date = $1::date AND o.status NOT IN ('completed', 'cancelled')
            AND (o.store_id = $2 OR o.store_id IS NULL)
          GROUP BY oi.product_id`, [date, storeId]),
      // 3. Stock fini disponible (arrière-boutique + vitrine).
      db.query(
        `SELECT product_id, COALESCE(SUM(stock_quantity + vitrine_quantity), 0)::float AS qty
           FROM product_store_stock WHERE store_id = $1 GROUP BY product_id`, [storeId]),
      // 4. Déjà planifié : items non annulés / non produits de plans ouverts du jour.
      db.query(
        `SELECT pi.product_id, COALESCE(SUM(pi.planned_quantity), 0)::float AS qty
           FROM production_plan_items pi JOIN production_plans p ON p.id = pi.plan_id
          WHERE p.plan_date = $1::date AND p.status NOT IN ('completed', 'cancelled')
            AND (p.store_id = $2 OR p.store_id IS NULL)
            AND pi.cancelled_at IS NULL AND pi.status <> 'produced'
          GROUP BY pi.product_id`, [date, storeId]),
    ]);

    const forecastByProduct = new Map<string, { qty: number; name: string; category_id: number | null; category_name: string | null }>();
    for (const r of fc.rows) {
      forecastByProduct.set(r.product_id, {
        qty: Number(r.days[date]?.qty ?? 0),
        name: r.product_name, category_id: r.category_id, category_name: r.category_name,
      });
    }
    const toMap = (rows: Record<string, any>[]) => new Map(rows.map(r => [r.product_id as string, Number(r.qty)]));
    const orders = toMap(ordersRes.rows);
    const stock = toMap(stockRes.rows);
    const planned = toMap(plannedRes.rows);

    // Union de tous les produits concernés.
    const ids = new Set<string>([...forecastByProduct.keys(), ...orders.keys(), ...planned.keys()]);
    // Métadonnées des produits absents de la prévision (commandes / planifiés seuls).
    const missing = [...ids].filter(id => !forecastByProduct.has(id));
    const meta = new Map<string, { name: string; category_id: number | null; category_name: string | null; display_order: number | null }>();
    if (missing.length) {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.category_id, c.name AS category_name, c.display_order
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = ANY($1::uuid[])`, [missing]);
      for (const r of rows) meta.set(r.id, { name: r.name, category_id: r.category_id, category_name: r.category_name, display_order: r.display_order });
    }

    const round = (n: number) => Math.round(n * 1000) / 1000;
    const rows = [...ids].map(id => {
      const f = forecastByProduct.get(id);
      const m = meta.get(id);
      // known = l'id correspond à un vrai produit fini (prévision ou catalogue).
      const known = !!f || !!m;
      const forecastQty = f?.qty ?? 0;
      const orderQty = orders.get(id) ?? 0;
      // Stock négatif = artefact de saisie : plancher à 0 (ne gonfle pas le besoin).
      const onHand = Math.max(0, stock.get(id) ?? 0);
      const plannedQty = planned.get(id) ?? 0;
      const demand = forecastQty + orderQty;
      const net = Math.max(0, demand - onHand - plannedQty);
      return {
        product_id: id,
        known,
        product_name: f?.name ?? m?.name ?? '—',
        category_id: f?.category_id ?? m?.category_id ?? null,
        category_name: f?.category_name ?? m?.category_name ?? null,
        display_order: m?.display_order ?? null,
        forecast_qty: round(forecastQty),
        order_qty: round(orderQty),
        demand: round(demand),
        on_hand: round(onHand),
        planned_qty: round(plannedQty),
        net_to_produce: round(net),
      };
    })
      // On garde les produits finis réels avec une demande ou un plan ; on écarte le
      // bruit « stock seul » et les lignes non résolues (ex. semi-fini / produit supprimé).
      .filter(r => r.known && (r.demand > 0 || r.planned_qty > 0))
      .sort((a, b) =>
        (a.display_order ?? 9999) - (b.display_order ?? 9999) ||
        (a.category_name ?? '').localeCompare(b.category_name ?? '') ||
        a.product_name.localeCompare(b.product_name));

    const totals = rows.reduce(
      (t, r) => ({
        demand: round(t.demand + r.demand),
        on_hand: round(t.on_hand + r.on_hand),
        planned_qty: round(t.planned_qty + r.planned_qty),
        net_to_produce: round(t.net_to_produce + r.net_to_produce),
      }),
      { demand: 0, on_hand: 0, planned_qty: 0, net_to_produce: 0 });

    return { store_id: storeId, date, rows, totals };
  },
};
