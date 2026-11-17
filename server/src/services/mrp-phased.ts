import { db, withTransaction } from '../config/database.js';
import { forecastRepository } from '../repositories/forecast.repository.js';
import { getCompositionForNeeds } from '../repositories/recipe-composition.helper.js';
import { getParameter } from './module-parameters.service.js';

/**
 * Calcul des besoins phasé dans le temps (G5-04).
 *
 * Horizon découpé en jours. Pour chaque article (produit fini, base, ingrédient), du
 * niveau le plus haut au plus bas de la nomenclature :
 *   disponible(j) = disponible(j−1) + réceptions prévues(j) + ordres proposés(j) − besoin brut(j)
 *   s'il passe sous le stock de sécurité, un ordre est proposé pour le jour j, arrondi par
 *   les règles de lot (minimum, multiple), lancé j − délai (fabrication ou achat) ;
 *   son lancement crée le besoin brut des composants au jour de lancement.
 * Besoin brut des produits : prévision de vente + commandes fermes à leur date de retrait.
 * Réceptions prévues : ordres de fabrication non produits (date du plan), semi-finis en
 * stock, bons de commande ouverts à leur date de livraison prévue.
 * Messages d'action sur les réceptions prévues : avancer, retarder, annuler.
 *
 * planPhased() est le calcul pur (sans base), loadMrpInput() lit les données,
 * mrpPhased() enchaîne les deux. Lecture seule ; validateProposals() crée, à la demande,
 * les ordres de fabrication et les demandes d'achat choisis.
 */

export type ItemKind = 'product' | 'base' | 'ingredient';
export interface MrpItem {
  key: string;
  kind: ItemKind;
  id: string;
  name: string;
  unit: string;
  onHand: number;
  safety: number;
  leadDays: number;
  lotMin: number;
  lotMultiple: number;
  /** Composants par unité de l'article. */
  bom: { child: string; qty: number }[];
}
export interface ScheduledReceipt { key: string; date: string; qty: number; ref: string }
export interface MrpInput {
  days: string[];
  items: MrpItem[];
  /** Besoin brut indépendant : clé → date → quantité. */
  demand: Record<string, Record<string, number>>;
  receipts: ScheduledReceipt[];
}
export interface Proposal {
  key: string; kind: ItemKind; id: string; name: string; unit: string;
  qty: number; needDate: string; releaseDate: string; late: boolean;
}
export interface ActionMessage {
  key: string; name: string; ref: string; date: string; qty: number;
  action: 'avancer' | 'retarder' | 'annuler'; newDate: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Quantité d'ordre : au moins le besoin, au moins le minimum, multiple du conditionnement. */
export function lotSize(net: number, min: number, multiple: number): number {
  let q = Math.max(net, min);
  if (multiple > 0) q = Math.ceil(q / multiple - 1e-9) * multiple;
  return r3(q);
}

/** Profondeur dans la nomenclature (plus long chemin depuis un article sans parent). */
function levels(items: MrpItem[]): Map<string, number> {
  const byKey = new Map(items.map(i => [i.key, i]));
  const level = new Map<string, number>(items.map(i => [i.key, 0]));
  // Relaxation bornée (une nomenclature cyclique est coupée à 20 niveaux).
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const it of items) for (const c of it.bom) {
      if (!byKey.has(c.child)) continue;
      const want = Math.min((level.get(it.key) ?? 0) + 1, 20);
      if ((level.get(c.child) ?? 0) < want) { level.set(c.child, want); changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

export function planPhased(input: MrpInput) {
  const { days } = input;
  const items = [...input.items];
  const lv = levels(items);
  items.sort((a, b) => (lv.get(a.key)! - lv.get(b.key)!) || a.name.localeCompare(b.name));
  const gross = new Map<string, Map<string, number>>();
  const addGross = (key: string, date: string, qty: number) => {
    if (!gross.has(key)) gross.set(key, new Map());
    const m = gross.get(key)!;
    const d = date < days[0] ? days[0] : date;
    m.set(d, (m.get(d) ?? 0) + qty);
  };
  for (const [key, byDay] of Object.entries(input.demand)) for (const [d, q] of Object.entries(byDay)) if (q > 0) addGross(key, d, q);
  const receiptsBy = new Map<string, ScheduledReceipt[]>();
  for (const r of input.receipts) {
    const rr = { ...r, date: r.date < days[0] ? days[0] : r.date };
    if (!receiptsBy.has(r.key)) receiptsBy.set(r.key, []);
    receiptsBy.get(r.key)!.push(rr);
  }

  const proposals: Proposal[] = [];
  const messages: ActionMessage[] = [];
  const table: Array<{
    key: string; kind: ItemKind; id: string; name: string; unit: string; level: number; onHand: number; safety: number; leadDays: number;
    days: { date: string; gross: number; receipts: number; planned: number; projected: number }[];
  }> = [];

  for (const it of items) {
    const g = gross.get(it.key) ?? new Map<string, number>();
    const recs = (receiptsBy.get(it.key) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const recByDay = new Map<string, number>();
    for (const r of recs) recByDay.set(r.date, (recByDay.get(r.date) ?? 0) + r.qty);

    // Messages d'action : besoin de chaque réception prévue, l'une après l'autre.
    {
      const need = (exclude: Set<number>) => {
        let p = it.onHand; const firstShort = { day: null as string | null };
        for (const d of days) {
          p += recs.reduce((t, r, i) => t + (!exclude.has(i) && r.date === d ? r.qty : 0), 0) - (g.get(d) ?? 0);
          if (p < it.safety - 1e-9 && !firstShort.day) firstShort.day = d;
        }
        return firstShort.day;
      };
      const excluded = new Set<number>();
      recs.forEach((r, i) => {
        // Sans cette réception (et sans celles déjà jugées inutiles), quand manque-t-on ?
        const short = need(new Set([...excluded, i]));
        if (!short) { excluded.add(i); messages.push({ key: it.key, name: it.name, ref: r.ref, date: r.date, qty: r.qty, action: 'annuler', newDate: null }); return; }
        if (short < r.date) messages.push({ key: it.key, name: it.name, ref: r.ref, date: r.date, qty: r.qty, action: 'avancer', newDate: short });
        else if (short > r.date) messages.push({ key: it.key, name: it.name, ref: r.ref, date: r.date, qty: r.qty, action: 'retarder', newDate: short });
      });
    }

    let projected = it.onHand;
    const row: typeof table[number]['days'] = [];
    for (const d of days) {
      const gr = g.get(d) ?? 0;
      const rc = recByDay.get(d) ?? 0;
      projected += rc - gr;
      let planned = 0;
      if (projected < it.safety - 1e-9) {
        planned = lotSize(it.safety - projected, it.lotMin, it.lotMultiple);
        projected += planned;
        const release = addDays(d, -it.leadDays);
        const late = release < days[0];
        proposals.push({ key: it.key, kind: it.kind, id: it.id, name: it.name, unit: it.unit, qty: planned, needDate: d, releaseDate: late ? days[0] : release, late });
        for (const c of it.bom) addGross(c.child, late ? days[0] : release, planned * c.qty);
      }
      row.push({ date: d, gross: r3(gr), receipts: r3(rc), planned: r3(planned), projected: r3(projected) });
    }
    table.push({ key: it.key, kind: it.kind, id: it.id, name: it.name, unit: it.unit, level: lv.get(it.key)!, onHand: r3(it.onHand), safety: r3(it.safety), leadDays: it.leadDays, days: row });
  }
  return { days, items: table, proposals, messages };
}

/* ─── Chargement ─────────────────────────────────────────────────────────── */

type MrpParams = { horizon_days: number; product_lead_days: number; base_lead_days: number; default_purchase_lead_days: number };
export async function mrpParams(): Promise<MrpParams> {
  const p = await getParameter<Partial<MrpParams>>('production.mrp_phased');
  return {
    horizon_days: Math.min(Math.max(Number(p?.horizon_days ?? 14), 1), 60),
    product_lead_days: Number(p?.product_lead_days ?? 0),
    base_lead_days: Number(p?.base_lead_days ?? 1),
    default_purchase_lead_days: Number(p?.default_purchase_lead_days ?? 2),
  };
}

export async function loadMrpInput(storeId: string, from: string, horizon?: number): Promise<MrpInput> {
  const prm = await mrpParams();
  const n = horizon ?? prm.horizon_days;
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  const to = days[days.length - 1];
  const items = new Map<string, MrpItem>();
  const demand: Record<string, Record<string, number>> = {};
  const receipts: ScheduledReceipt[] = [];
  const addDemand = (key: string, d: string, q: number) => { demand[key] ??= {}; demand[key][d] = (demand[key][d] ?? 0) + q; };

  // Demande indépendante : prévision + commandes fermes (reste à livrer) à leur retrait.
  const fc = await forecastRepository.compute(storeId, from, to, { withMarkup: true });
  for (const r of fc.rows) for (const d of days) { const q = Number(r.days[d]?.qty ?? 0); if (q > 0) addDemand(`p:${r.product_id}`, d, q); }
  const orders = await db.query(
    `SELECT oi.product_id, o.pickup_date::date::text AS d,
            SUM(GREATEST(oi.quantity - oi.qty_delivered - oi.qty_cancelled, 0))::float8 AS q
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status NOT IN ('completed', 'cancelled') AND (o.store_id = $1 OR o.store_id IS NULL)
        AND o.pickup_date::date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`, [storeId, from, to]);
  for (const r of orders.rows) if (r.q > 0) addDemand(`p:${r.product_id}`, r.d, Number(r.q));

  const productIds = [...new Set(Object.keys(demand).map(k => k.slice(2)))];
  if (!productIds.length) return { days, items: [], demand, receipts };

  // Produits : stock fini, minimum de fabrication, ordres ouverts non produits.
  const prods = await db.query(
    `SELECT p.id, p.name, COALESCE(p.min_production_quantity, 0)::float8 AS lot_min,
            COALESCE((SELECT SUM(s.stock_quantity + s.vitrine_quantity) FROM product_store_stock s WHERE s.product_id = p.id AND s.store_id = $2), 0)::float8 AS on_hand,
            (SELECT r.id FROM recipes r WHERE r.product_id = p.id AND r.archived_at IS NULL LIMIT 1) AS recipe_id,
            (SELECT rf.id FROM recipe_formats rf WHERE rf.product_id = p.id AND rf.is_active ORDER BY rf.is_default DESC NULLS LAST, rf.ordre NULLS LAST, rf.created_at LIMIT 1) AS format_id
       FROM products p WHERE p.id = ANY($1::uuid[])`, [productIds, storeId]);
  const planned = await db.query(
    `SELECT pi.product_id, p.plan_date::text AS d, SUM(pi.planned_quantity)::float8 AS q, MIN(COALESCE(p.of_number, p.id::text)) AS ref
       FROM production_plan_items pi JOIN production_plans p ON p.id = pi.plan_id
      WHERE pi.product_id = ANY($1::uuid[]) AND p.status NOT IN ('completed', 'cancelled')
        AND (p.store_id = $2 OR p.store_id IS NULL) AND pi.cancelled_at IS NULL AND pi.status IN ('pending', 'in_progress')
        AND p.plan_date <= $3::date
      GROUP BY 1, 2`, [productIds, storeId, to]);
  for (const r of planned.rows) receipts.push({ key: `p:${r.product_id}`, date: r.d, qty: Number(r.q), ref: r.ref });

  // Nomenclature : produits → bases et ingrédients ; bases → bases et ingrédients.
  type Comp = NonNullable<Awaited<ReturnType<typeof getCompositionForNeeds>>>;
  const compCache = new Map<string, Comp | null>();
  const compOf = async (recipeId: string, formatId: string | null = null) => {
    const k = `${recipeId}|${formatId ?? ''}`;
    if (!compCache.has(k)) compCache.set(k, await getCompositionForNeeds(db as never, recipeId, formatId));
    return compCache.get(k) ?? null;
  };
  const ingredientIds = new Set<string>();
  const baseInfo = new Map<string, { name: string; unit: string; yieldQty: number }>();
  /** Composants par unité d'un article : ingrédients directs, bases ; sous-recettes non bases dépliées. */
  const bomOf = async (comp: Comp, factor: number, depth = 0): Promise<{ child: string; qty: number }[]> => {
    const out: { child: string; qty: number }[] = [];
    for (const ing of comp.ingredients) { ingredientIds.add(ing.ingredientId); out.push({ child: `i:${ing.ingredientId}`, qty: ing.qtyPerBatch * factor / comp.batchDivisor }); }
    for (const sub of comp.subRecipes) {
      if (sub.isBase) { baseInfo.set(sub.subRecipeId, { name: sub.name, unit: sub.yieldUnit, yieldQty: Number(sub.yieldQuantity) || 0 }); out.push({ child: `b:${sub.subRecipeId}`, qty: sub.netQtyPerBatch * factor / comp.batchDivisor }); continue; }
      if (depth > 10) continue;
      const child = await compOf(sub.subRecipeId);
      if (child) out.push(...await bomOf(child, sub.grossQtyPerBatch * factor / comp.batchDivisor, depth + 1));
    }
    const merged = new Map<string, number>();
    for (const c of out) merged.set(c.child, (merged.get(c.child) ?? 0) + c.qty);
    return [...merged].map(([child, qty]) => ({ child, qty }));
  };

  for (const p of prods.rows) {
    const comp = p.recipe_id ? await compOf(p.recipe_id, p.format_id) : null;
    items.set(`p:${p.id}`, {
      key: `p:${p.id}`, kind: 'product', id: p.id, name: p.name, unit: 'pièce', onHand: Math.max(0, Number(p.on_hand)), safety: 0,
      leadDays: prm.product_lead_days, lotMin: Number(p.lot_min), lotMultiple: 0, bom: comp ? await bomOf(comp, 1) : [],
    });
  }
  // Bases, de proche en proche.
  const seen = new Set<string>();
  for (let guard = 0; guard < 15; guard++) {
    const todo = [...baseInfo.keys()].filter(id => !seen.has(id));
    if (!todo.length) break;
    for (const id of todo) {
      seen.add(id);
      const comp = await compOf(id);
      items.set(`b:${id}`, {
        key: `b:${id}`, kind: 'base', id, name: baseInfo.get(id)!.name, unit: baseInfo.get(id)!.unit, onHand: 0, safety: 0,
        // La base est demandée dans son unité de rendement (g, kg…) ; sa composition décrit un
        // lot qui rend yieldQty : composants par unité = quantité du lot / rendement.
        leadDays: prm.base_lead_days, lotMin: 0, lotMultiple: 0,
        bom: comp ? await bomOf(comp, baseInfo.get(id)!.yieldQty > 0 ? comp.batchDivisor / baseInfo.get(id)!.yieldQty : 1) : [],
      });
    }
  }
  if (seen.size) {
    const sf = await db.query(
      `SELECT recipe_id, COALESCE(SUM(quantity_available), 0)::float8 AS q FROM semi_finished_stock
        WHERE recipe_id = ANY($1::uuid[]) AND (store_id = $2 OR $2 IS NULL) AND (expires_at IS NULL OR expires_at > now())
        GROUP BY recipe_id`, [[...seen], storeId]);
    for (const r of sf.rows) { const it = items.get(`b:${r.recipe_id}`); if (it) it.onHand = Number(r.q); }
  }
  // Ingrédients : stock, stock de sécurité (G5-02), délai et conditionnement du fournisseur préféré.
  if (ingredientIds.size) {
    const ings = await db.query(
      `SELECT g.id, g.name, g.unit, COALESCE(inv.current_quantity, 0)::float8 AS on_hand, COALESCE(inv.safety_stock, 0)::float8 AS safety,
              si.lead_time_days, COALESCE(si.moq, 0)::float8 AS moq, COALESCE(si.qty_per_container, 0)::float8 AS multiple
         FROM ingredients g
         LEFT JOIN inventory inv ON inv.ingredient_id = g.id AND inv.store_id = $2
         LEFT JOIN LATERAL (SELECT lead_time_days, moq, qty_per_container FROM supplier_items s
                             WHERE s.purchasable_kind = 'ingredient' AND s.purchasable_id = g.id AND NOT s.is_blocked
                             ORDER BY s.is_preferred DESC, s.lead_time_days NULLS LAST LIMIT 1) si ON true
        WHERE g.id = ANY($1::uuid[])`, [[...ingredientIds], storeId]);
    for (const g of ings.rows) {
      items.set(`i:${g.id}`, {
        key: `i:${g.id}`, kind: 'ingredient', id: g.id, name: g.name, unit: g.unit, onHand: Math.max(0, Number(g.on_hand)), safety: Number(g.safety),
        leadDays: g.lead_time_days ?? prm.default_purchase_lead_days, lotMin: Number(g.moq), lotMultiple: Number(g.multiple), bom: [],
      });
    }
    const pos = await db.query(
      `SELECT poi.ingredient_id, COALESCE(po.expected_delivery_date, po.order_date)::text AS d, po.order_number AS ref,
              SUM(GREATEST(poi.quantity_ordered - poi.quantity_delivered, 0))::float8 AS q
         FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.ingredient_id = ANY($1::uuid[]) AND po.status IN ('en_attente', 'envoye', 'livre_partiel')
          AND (po.store_id = $2 OR po.store_id IS NULL)
        GROUP BY 1, 2, 3`, [[...ingredientIds], storeId]);
    for (const r of pos.rows) if (r.q > 0) receipts.push({ key: `i:${r.ingredient_id}`, date: r.d, qty: Number(r.q), ref: r.ref });
  }
  return { days, items: [...items.values()], demand, receipts };
}

export async function mrpPhased(storeId: string, from: string, horizon?: number) {
  return planPhased(await loadMrpInput(storeId, from, horizon));
}

/**
 * Validation des propositions choisies : ordres de fabrication (un par jour de lancement,
 * produits finis) et demandes d'achat (ingrédients). Les bases suivent leurs produits
 * (dépendances semi-finis créées à la confirmation de l'ordre, mécanisme existant).
 */
export async function validateProposals(storeId: string, userId: string, picks: { kind: ItemKind; id: string; qty: number; releaseDate: string; needDate: string; unit: string }[]) {
  const { productionRepository } = await import('../repositories/production.repository.js');
  const { purchaseRequestRepository } = await import('../repositories/purchase-request.repository.js');
  return withTransaction(async () => {
    const byDay = new Map<string, { productId: string; plannedQuantity: number }[]>();
    for (const p of picks.filter(x => x.kind === 'product')) {
      if (!byDay.has(p.releaseDate)) byDay.set(p.releaseDate, []);
      byDay.get(p.releaseDate)!.push({ productId: p.id, plannedQuantity: Math.ceil(p.qty) });
    }
    const plans: string[] = [];
    for (const [d, items] of byDay) {
      const plan = await productionRepository.create({ planDate: d, type: 'daily', notes: 'Proposé par le calcul des besoins (MRP phasé)', createdBy: userId, storeId, items });
      plans.push(plan.of_number ?? plan.id);
    }
    let requests = 0;
    for (const p of picks.filter(x => x.kind === 'ingredient')) {
      await purchaseRequestRepository.create({
        ingredientId: p.id, quantity: p.qty, unit: p.unit, reason: 'production',
        note: `MRP phasé — à commander le ${p.releaseDate} pour le ${p.needDate}`, requestedBy: userId, storeId,
      });
      requests++;
    }
    return { plans, requests };
  });
}
