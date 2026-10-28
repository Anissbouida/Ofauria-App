import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';
import { tierFor } from './loyalty.js';

/**
 * Moteur de promotions (mig 372). Entrée : lignes déjà chiffrées (prix du canal, palier…).
 * Règle de cumul, simple à expliquer en caisse :
 *   1. chaque ligne reçoit la meilleure promotion « articles » qui la concerne ;
 *   2. puis la meilleure promotion « panier » s'applique sur le montant restant.
 * Produit au poids : quantité en grammes, prix au kg ; « montant » et « prix spécial »
 * s'entendent par kg ; « X achetés = Y offerts » ne vise que les produits à l'unité.
 */
type Runner = PoolClient | typeof db;
export type PromoChannel = 'pos' | 'orders' | 'quotes';
export type PromoLine = { productId: string; categoryId: number | null; quantity: number; unit: 'unit' | 'g' | 'person'; unitPrice: number; subtotal: number };
export type PromoContext = { channel: PromoChannel; storeId?: string | null; customerId?: string | null; couponCode?: string | null };
export type AppliedPromo = { promotionId: string; label: string; amount: number };
export type PromoResult = {
  lines: { discount: number; promotionId: string | null; label: string | null }[];
  applied: AppliedPromo[];
  itemsAmount: number; cartAmount: number; total: number;
  // superseded : le code est valable mais une promotion plus avantageuse s'applique déjà (non bloquant).
  coupon: { code: string; status: 'applied' | 'superseded' | 'invalid' | 'not_applicable'; message: string } | null;
  // « X achetés = Y offerts » : articles offerts auxquels le client a droit mais qui ne sont
  // pas encore dans le panier (la caisse les ajoute ; le moteur les rend gratuits ensuite).
  freeToAdd: { promotionId: string; label: string; productId: string; quantity: number }[];
};
type Promo = Record<string, any>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const qtyUnits = (l: PromoLine) => (l.unit === 'g' ? l.quantity / 1000 : l.quantity);

/** Promotions en vigueur maintenant pour ce canal et ce magasin (heure locale). */
async function candidates(runner: Runner, ctx: PromoContext) {
  const tz = getUserTimezone();
  const col = ctx.channel === 'pos' ? 'on_pos' : ctx.channel === 'orders' ? 'on_orders' : 'on_quotes';
  const r = await runner.query(
    `WITH n AS (SELECT (now() AT TIME ZONE $1) AS t)
     SELECT p.* FROM promotions p, n
      WHERE p.is_active AND p.${col}
        AND (p.store_id IS NULL OR p.store_id = $2::uuid)
        AND (p.starts_on IS NULL OR p.starts_on <= n.t::date)
        AND (p.ends_on IS NULL OR p.ends_on >= n.t::date)
        AND (cardinality(p.days_of_week) = 0 OR EXTRACT(ISODOW FROM n.t)::smallint = ANY (p.days_of_week))
        AND (p.time_from IS NULL OR p.time_to IS NULL
             OR (p.time_from <= p.time_to AND n.t::time BETWEEN p.time_from AND p.time_to)
             OR (p.time_from > p.time_to AND (n.t::time >= p.time_from OR n.t::time <= p.time_to)))
        AND (p.max_uses IS NULL OR p.uses_count < p.max_uses)
        AND (p.coupon_code IS NULL OR upper(p.coupon_code) = upper($3::text))
      ORDER BY p.priority DESC, p.created_at`,
    [tz, ctx.storeId ?? null, ctx.couponCode?.trim() || null]);
  return r.rows as Promo[];
}

async function customerFacts(runner: Runner, customerId: string | null | undefined) {
  if (!customerId) return null;
  const c = await runner.query(`SELECT id, COALESCE(customer_type, 'particulier') AS customer_type FROM customers WHERE id = $1`, [customerId]);
  if (!c.rows[0]) return null;
  const t = await tierFor(customerId, runner);
  const tiers = await runner.query(`SELECT code, min_points FROM loyalty_tiers`);
  return { type: c.rows[0].customer_type as string, points12m: t.points12m, tierMin: Object.fromEntries(tiers.rows.map(x => [x.code, x.min_points])) as Record<string, number> };
}

function customerOk(p: Promo, c: Awaited<ReturnType<typeof customerFacts>>) {
  switch (p.customer_scope) {
    case 'identified': return !!c;
    case 'particulier': return !!c && c.type === 'particulier';
    case 'professionnel': return !!c && c.type !== 'particulier';
    case 'tier': return !!c && c.points12m >= (c.tierMin[p.min_tier_code] ?? Infinity);
    default: return true;
  }
}

const eligible = (p: Promo, l: PromoLine) => {
  const prods: string[] = p.product_ids ?? []; const cats: number[] = (p.category_ids ?? []).map(Number);
  if (!prods.length && !cats.length) return true;
  return prods.includes(l.productId) || (l.categoryId != null && cats.includes(Number(l.categoryId)));
};

/** Remise par ligne que donnerait une promotion « articles » (0 si conditions non remplies). */
function itemDiscounts(p: Promo, lines: PromoLine[]): number[] {
  const idx = lines.map((l, i) => (eligible(p, l) ? i : -1)).filter(i => i >= 0);
  const out = lines.map(() => 0);
  if (!idx.length) return out;
  const qty = idx.reduce((s, i) => s + qtyUnits(lines[i]), 0);
  const amount = idx.reduce((s, i) => s + lines[i].subtotal, 0);
  if (p.min_quantity && qty < Number(p.min_quantity)) return out;
  if (p.min_amount && amount < Number(p.min_amount)) return out;
  const v = Number(p.value);
  if (p.kind === 'buy_x_get_y') {
    // Les unités offertes sont les moins chères du lot éligible.
    const units: { i: number; price: number }[] = [];
    for (const i of idx) if (lines[i].unit === 'unit') for (let k = 0; k < lines[i].quantity; k++) units.push({ i, price: lines[i].unitPrice });
    const group = Number(p.buy_qty) + Number(p.get_qty);
    let free = Math.floor(units.length / group) * Number(p.get_qty);
    units.sort((a, b) => a.price - b.price);
    for (const u of units) { if (free-- <= 0) break; out[u.i] += u.price; }
  } else {
    for (const i of idx) {
      const l = lines[i];
      out[i] = p.kind === 'percent' ? l.subtotal * v / 100
        : p.kind === 'amount' ? v * qtyUnits(l)
        : Math.max(0, l.unitPrice - v) * qtyUnits(l); // fixed_price
    }
  }
  return out.map((d, i) => round2(Math.min(d, lines[i].subtotal)));
}

/**
 * Articles offerts manquants : le panier contient de quoi déclencher l'offre (au moins
 * « X achetés » dans le dernier groupe) mais pas encore les Y articles offerts. L'article
 * à ajouter est le moins cher des articles concernés, celui que le moteur rendra gratuit.
 */
function missingFree(p: Promo, lines: PromoLine[]) {
  const idx = lines.map((l, i) => (eligible(p, l) && l.unit === 'unit' ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  const buy = Number(p.buy_qty), get = Number(p.get_qty);
  const n = idx.reduce((s, i) => s + lines[i].quantity, 0);
  const rem = n % (buy + get);
  if (rem < buy) return null;
  const quantity = get - (rem - buy);
  if (quantity <= 0) return null;
  if (p.min_amount && idx.reduce((s, i) => s + lines[i].subtotal, 0) < Number(p.min_amount)) return null;
  if (p.min_quantity && n + quantity < Number(p.min_quantity)) return null;
  const cheapest = idx.reduce((a, i) => (lines[i].unitPrice < lines[a].unitPrice ? i : a), idx[0]);
  return { promotionId: p.id as string, label: promoLabel(p), productId: lines[cheapest].productId, quantity };
}

/** Libellé lisible d'une promotion, pour le ticket et les documents. */
export function promoLabel(p: Promo) {
  const v = Number(p.value);
  const dh = (n: number) => n.toFixed(2).replace('.', ',');
  const what = p.kind === 'percent' ? `−${String(v).replace('.', ',')} %` : p.kind === 'amount' ? `−${dh(v)} DH${p.target === 'items' ? '/u' : ''}`
    : p.kind === 'fixed_price' ? `à ${dh(v)} DH` : `${p.buy_qty} + ${p.get_qty} offert${Number(p.get_qty) > 1 ? 's' : ''}`;
  return `${p.name} (${what})`.slice(0, 160);
}

export async function evaluate(lines: PromoLine[], ctx: PromoContext, runner: Runner = db): Promise<PromoResult> {
  const code = ctx.couponCode?.trim() || null;
  const [promos, cust] = await Promise.all([candidates(runner, ctx), customerFacts(runner, ctx.customerId)]);
  const usable = promos.filter(p => customerOk(p, cust));

  // À remise égale, le code présenté par le client l'emporte ; sinon l'ordre de tri (priorité).
  const beats = (d: number, p: Promo, cur: { discount: number; promo: Promo | null }) =>
    d > cur.discount || (d > 0 && d === cur.discount && !!p.coupon_code && !cur.promo?.coupon_code);
  const eligibleCoupon = new Set<string>();

  // 1. Meilleure promotion article par ligne.
  const best = lines.map(() => ({ discount: 0, promo: null as Promo | null }));
  for (const p of usable.filter(x => x.target === 'items')) {
    const ds = itemDiscounts(p, lines);
    if (p.coupon_code && ds.some(d => d > 0)) eligibleCoupon.add(p.id);
    ds.forEach((d, i) => { if (beats(d, p, best[i])) best[i] = { discount: d, promo: p }; });
  }
  const itemsAmount = round2(best.reduce((s, b) => s + b.discount, 0));
  const base = round2(lines.reduce((s, l) => s + l.subtotal, 0) - itemsAmount);

  // 2. Meilleure promotion panier sur le reste.
  let cart: { amount: number; promo: Promo } | null = null;
  for (const p of usable.filter(x => x.target === 'cart')) {
    if (p.min_amount && base < Number(p.min_amount)) continue;
    if (p.min_quantity && lines.reduce((s, l) => s + qtyUnits(l), 0) < Number(p.min_quantity)) continue;
    const a = round2(Math.min(base, p.kind === 'percent' ? base * Number(p.value) / 100 : Number(p.value)));
    if (a > 0 && p.coupon_code) eligibleCoupon.add(p.id);
    if (a > 0 && (!cart || beats(a, p, { discount: cart.amount, promo: cart.promo }))) cart = { amount: a, promo: p };
  }

  const byPromo = new Map<string, AppliedPromo>();
  for (const b of best) {
    if (!b.promo || b.discount <= 0) continue;
    const cur = byPromo.get(b.promo.id) ?? { promotionId: b.promo.id, label: promoLabel(b.promo), amount: 0 };
    cur.amount = round2(cur.amount + b.discount);
    byPromo.set(b.promo.id, cur);
  }
  if (cart) byPromo.set(cart.promo.id, { promotionId: cart.promo.id, label: promoLabel(cart.promo), amount: cart.amount });
  const applied = [...byPromo.values()];

  let coupon: PromoResult['coupon'] = null;
  if (code) {
    const withCode = promos.filter(p => p.coupon_code && p.coupon_code.toUpperCase() === code.toUpperCase());
    if (applied.some(a => withCode.some(p => p.id === a.promotionId))) coupon = { code, status: 'applied', message: 'Code promo appliqué' };
    else if (!withCode.length) coupon = { code, status: 'invalid', message: 'Code promo inconnu, expiré ou épuisé' };
    else if (withCode.some(p => eligibleCoupon.has(p.id))) coupon = { code, status: 'superseded', message: 'Une promotion plus avantageuse s\'applique déjà' };
    else coupon = { code, status: 'not_applicable', message: 'Les conditions du code promo ne sont pas remplies' };
  }

  const cartAmount = cart?.amount ?? 0;
  const freeToAdd = usable.filter(p => p.target === 'items' && p.kind === 'buy_x_get_y')
    .map(p => missingFree(p, lines)).filter((x): x is NonNullable<typeof x> => !!x);
  return {
    lines: best.map(b => ({ discount: b.discount, promotionId: b.promo?.id ?? null, label: b.promo ? promoLabel(b.promo) : null })),
    applied, itemsAmount, cartAmount, total: round2(itemsAmount + cartAmount), coupon, freeToAdd,
  };
}

/**
 * Trace les promotions appliquées à un document ; une vente ou une commande compte une
 * utilisation (un devis non : il sera compté à sa conversion en commande ; une commande
 * modifiée non plus, countUse = false).
 */
export async function recordApplied(client: Runner, doc: { saleId?: string; orderId?: string; quoteId?: string }, applied: AppliedPromo[], countUse = !doc.quoteId) {
  if (doc.quoteId) await client.query(`DELETE FROM document_promotions WHERE quote_id = $1`, [doc.quoteId]);
  if (doc.orderId) await client.query(`DELETE FROM document_promotions WHERE order_id = $1`, [doc.orderId]);
  for (const a of applied) {
    await client.query(
      `INSERT INTO document_promotions (promotion_id, sale_id, order_id, quote_id, label, amount) VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.promotionId, doc.saleId ?? null, doc.orderId ?? null, doc.quoteId ?? null, a.label, a.amount]);
  }
  if (countUse && applied.length) {
    await client.query(`UPDATE promotions SET uses_count = uses_count + 1 WHERE id = ANY ($1::uuid[])`, [applied.map(a => a.promotionId)]);
  }
}
