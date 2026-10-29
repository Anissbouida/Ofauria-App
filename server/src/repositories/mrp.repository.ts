import { db } from '../config/database.js';
import { forecastRepository } from './forecast.repository.js';
import { productionRepository } from './production.repository.js';
import { getCategoryRole, ASSIGNED_ROLE_LABELS } from '@ofauria/shared';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

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

  /**
   * Génère des plans de production à partir des besoins nets (net_to_produce > 0),
   * un plan par atelier (rôle chef de la catégorie), les produits sans atelier dans
   * un plan « général ». Chaque produit à formats est posé sur son format par défaut
   * (le chef affinera la répartition dans l'éditeur). Comme le MRP défalque déjà le
   * « déjà planifié », régénérer après coup ne propose plus rien (auto-idempotent).
   * Un chef ne génère que le plan de son propre atelier.
   */
  async generatePlans(storeId: string, date: string, ctx: { userId: string; userRole: string }) {
    const { rows } = await this.netRequirements(storeId, date);
    const toProduce = rows.filter(r => r.net_to_produce > 0);
    if (!toProduce.length) return { plans: [], nothingToProduce: true };

    const productIds = toProduce.map(r => r.product_id);
    const categoryIds = [...new Set(toProduce.map(r => r.category_id).filter((x): x is number => x != null))];

    const [slugRes, fmtRes] = await Promise.all([
      categoryIds.length
        ? db.query(`SELECT id, slug FROM categories WHERE id = ANY($1::int[])`, [categoryIds])
        : Promise.resolve({ rows: [] as { id: number; slug: string }[] }),
      // Format par défaut de chaque produit (le premier : is_default puis ordre).
      db.query(
        `SELECT DISTINCT ON (product_id) product_id, id AS format_id
           FROM recipe_formats
          WHERE product_id = ANY($1::uuid[]) AND is_active = true
          ORDER BY product_id, is_default DESC NULLS LAST, ordre ASC NULLS LAST, created_at`,
        [productIds]),
    ]);
    const slugByCat = new Map<number, string>(slugRes.rows.map((r: { id: number; slug: string }) => [r.id, r.slug]));
    const formatByProduct = new Map<string, string>(fmtRes.rows.map((r: { product_id: string; format_id: string }) => [r.product_id, r.format_id]));

    const isChef = CHEF_ROLES.includes(ctx.userRole);
    // Regroupe les items par atelier (rôle chef, ou null = général).
    type Item = { productId: string; plannedQuantity: number; formats?: { formatId: string; plannedQuantity: number }[] };
    const groups = new Map<string, Item[]>(); // clé 'null' pour le général
    for (const r of toProduce) {
      const slug = r.category_id != null ? (slugByCat.get(r.category_id) ?? '') : '';
      const catRole = getCategoryRole(slug);
      const atelier = CHEF_ROLES.includes(catRole) ? catRole : null;
      // Un chef ne génère que son propre atelier.
      if (isChef && atelier !== ctx.userRole) continue;
      const key = atelier ?? 'null';
      const fmt = formatByProduct.get(r.product_id);
      const item: Item = fmt
        ? { productId: r.product_id, plannedQuantity: r.net_to_produce, formats: [{ formatId: fmt, plannedQuantity: r.net_to_produce }] }
        : { productId: r.product_id, plannedQuantity: r.net_to_produce };
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
    }

    const plans: { plan_id: string; target_role: string | null; atelier_label: string; item_count: number }[] = [];
    for (const [key, items] of groups) {
      const targetRole = key === 'null' ? null : key;
      const plan = await productionRepository.create({
        planDate: date, type: 'daily', notes: `Généré depuis le plan directeur (MRP) — ${date}`,
        createdBy: ctx.userId, targetRole: targetRole ?? undefined, storeId, items,
      });
      plans.push({
        plan_id: plan.id, target_role: targetRole,
        atelier_label: targetRole ? (ASSIGNED_ROLE_LABELS[targetRole] ?? targetRole) : 'Général',
        item_count: items.length,
      });
    }
    return { plans, nothingToProduce: false };
  },
};
