/**
 * Sortie de produits finis à l'expédition (O2C L1, mig 440) : bon de livraison
 * professionnel et remise en caisse d'une commande préparée en réserve.
 *
 *   - Affectation FEFO sur la DLC effective (dlc_effective du lot décongelé,
 *     sinon expires_at), réserve d'abord (là où la production pour commande est
 *     rangée), vitrine ensuite. Lots expirés et lots surgelés exclus : on
 *     n'expédie pas un produit encore congelé ni périmé.
 *   - Chaque affectation décrémente le lot (backroom_qty ou vitrine_qty →
 *     sold_qty), trace un mouvement 'delivery', et décrémente le stock du
 *     magasin (stock_quantity pour la réserve, vitrine_quantity pour la vitrine).
 *   - Produit suivi par lots (durée de vie définie ou lots déjà produits) :
 *     en mode strict (B2B), un reliquat non couvert bloque l'expédition.
 *     Produit sans suivi (revente) : sortie du stock sans lot.
 */
import type { PoolClient } from 'pg';

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
type Fail = Error & { statusCode?: number; code?: string };
const fail = (statusCode: number, message: string, code?: string): Fail => Object.assign(new Error(message), { statusCode, code });

export type LotStock = { id: string; backroom_qty: number; vitrine_qty: number; dlc: string | null };
export type Allocation = { lotId: string; qty: number; source: 'backroom' | 'vitrine'; dlc: string | null };

/** Plan FEFO pur : réserve d'abord, vitrine ensuite, lots déjà triés par DLC. */
export function allocateFefo(lots: LotStock[], qtyNeeded: number): { steps: Allocation[]; missing: number } {
  const steps: Allocation[] = [];
  let remaining = r3(qtyNeeded);
  for (const source of ['backroom', 'vitrine'] as const) {
    for (const lot of lots) {
      if (remaining <= 0) break;
      const avail = Number(source === 'backroom' ? lot.backroom_qty : lot.vitrine_qty);
      const take = r3(Math.min(avail, remaining));
      if (take > 0) { steps.push({ lotId: lot.id, qty: take, source, dlc: lot.dlc }); remaining = r3(remaining - take); }
    }
  }
  return { steps, missing: Math.max(0, remaining) };
}

/** Produit suivi par lots : durée de vie définie, ou lots déjà produits. */
export async function requiresLots(c: PoolClient, productId: string) {
  const r = await c.query(
    `SELECT p.shelf_life_days IS NOT NULL OR EXISTS (SELECT 1 FROM product_lots l WHERE l.product_id = p.id) AS req
       FROM products p WHERE p.id = $1`, [productId]);
  return Boolean(r.rows[0]?.req);
}

export type ShipResult = { allocations: Allocation[]; requiresLots: boolean; missing: number; shortfall?: number };

/**
 * Sort `quantity` d'un produit du magasin. `strict` : refuse un produit suivi
 * par lots dont les lots ne couvrent pas la quantité (409 LOTS_INSUFFISANTS).
 */
export async function shipProduct(c: PoolClient, p: {
  productId: string; storeId: string; quantity: number; strict: boolean;
  ref: { type: string; id: string }; label: string; userId: string | null;
}): Promise<ShipResult> {
  const qty = r3(p.quantity);
  if (qty <= 0) return { allocations: [], requiresLots: false, missing: 0 };
  const req = await requiresLots(c, p.productId);
  const lots = (await c.query(
    `SELECT id, backroom_qty::float8 AS backroom_qty, vitrine_qty::float8 AS vitrine_qty,
            COALESCE(dlc_effective, expires_at::timestamptz)::text AS dlc
       FROM product_lots
      WHERE product_id = $1 AND store_id = $2 AND status = 'active' AND (backroom_qty > 0 OR vitrine_qty > 0)
        AND etat_thermique IS DISTINCT FROM 'surgele'
        AND ((dlc_effective IS NOT NULL AND dlc_effective > now())
             OR (dlc_effective IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_DATE)))
      ORDER BY COALESCE(dlc_effective, expires_at::timestamptz) ASC NULLS LAST, produced_at ASC, id
      FOR UPDATE`, [p.productId, p.storeId])).rows as LotStock[];
  const plan = allocateFefo(lots, qty);
  if (req && p.strict && plan.missing > 0) {
    const name = (await c.query(`SELECT name FROM products WHERE id = $1`, [p.productId])).rows[0]?.name ?? p.productId;
    throw fail(409, `« ${name} » : ${r3(qty - plan.missing)} disponible(s) en lots valides sur ${qty} à expédier (lots expirés et surgelés exclus)`, 'LOTS_INSUFFISANTS');
  }
  let fromBackroom = 0, fromVitrine = 0;
  for (const s of plan.steps) {
    await c.query(
      `UPDATE product_lots SET ${s.source === 'backroom' ? 'backroom_qty = backroom_qty' : 'vitrine_qty = vitrine_qty'} - $2,
              sold_qty = sold_qty + $2 WHERE id = $1`, [s.lotId, s.qty]);
    await c.query(
      `INSERT INTO product_lot_movements (product_lot_id, store_id, kind, quantity, ref_type, ref_id)
       VALUES ($1, $2, 'delivery', $3, $4, $5)`, [s.lotId, p.storeId, s.qty, p.ref.type, p.ref.id]);
    if (s.source === 'backroom') fromBackroom = r3(fromBackroom + s.qty); else fromVitrine = r3(fromVitrine + s.qty);
  }
  // Produit sans suivi par lots (ou reliquat toléré) : la sortie porte sur la réserve.
  if (plan.missing > 0) fromBackroom = r3(fromBackroom + plan.missing);
  // On capture le stock AVANT décrément pour repérer un dépassement : le GREATEST(…,0)
  // borne le stock à zéro, mais on ne veut plus que ce manque passe en silence
  // (signalé, non bloquant — décision produit 2026-11-09).
  const row = (await c.query(
    `WITH cur AS (SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2)
     INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (product_id, store_id) DO UPDATE
       SET stock_quantity = GREATEST(product_store_stock.stock_quantity - $3, 0),
           vitrine_quantity = GREATEST(product_store_stock.vitrine_quantity - $4, 0), updated_at = now()
     RETURNING stock_quantity::float8 AS s,
               COALESCE((SELECT stock_quantity FROM cur), 0)::float8 AS old_backroom,
               COALESCE((SELECT vitrine_quantity FROM cur), 0)::float8 AS old_vitrine`,
    [p.productId, p.storeId, fromBackroom, fromVitrine])).rows[0];
  const stock = row.s;
  const shortfall = r3(Math.max(0, fromBackroom - row.old_backroom) + Math.max(0, fromVitrine - row.old_vitrine));
  if (shortfall > 0) {
    console.warn(`[product-shipment] Sortie supérieure au stock — produit ${p.productId}, magasin ${p.storeId}, manque ${shortfall} (réf ${p.ref.type}:${p.ref.id}). Stock borné à 0.`);
  }
  await c.query(
    `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
     VALUES ($1, 'delivery', $2, $3, $4, $5, $6, $7)`,
    [p.productId, -qty, stock, shortfall > 0 ? `${p.label} (sortie > stock : manque ${shortfall}, borné à 0)` : p.label, p.ref.id, p.userId, p.storeId]);
  return { allocations: plan.steps, requiresLots: req, missing: plan.missing, shortfall };
}

/** Remet des affectations dans leurs lots et le stock du magasin (annulation d'expédition). */
export async function reverseAllocations(c: PoolClient, p: {
  productId: string; storeId: string; allocations: { lotId: string; qty: number; source: 'backroom' | 'vitrine' }[];
  untracked?: number; ref: { type: string; id: string }; label: string; userId: string | null;
}) {
  let toBackroom = r3(p.untracked ?? 0), toVitrine = 0;
  for (const a of p.allocations) {
    await c.query(
      `UPDATE product_lots SET ${a.source === 'backroom' ? 'backroom_qty = backroom_qty' : 'vitrine_qty = vitrine_qty'} + $2,
              sold_qty = GREATEST(sold_qty - $2, 0) WHERE id = $1`, [a.lotId, a.qty]);
    await c.query(
      `INSERT INTO product_lot_movements (product_lot_id, store_id, kind, quantity, ref_type, ref_id)
       VALUES ($1, $2, 'delivery_reversal', $3, $4, $5)`, [a.lotId, p.storeId, a.qty, p.ref.type, p.ref.id]);
    if (a.source === 'backroom') toBackroom = r3(toBackroom + a.qty); else toVitrine = r3(toVitrine + a.qty);
  }
  const total = r3(toBackroom + toVitrine);
  if (total <= 0) return;
  const stock = (await c.query(
    `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, store_id) DO UPDATE
       SET stock_quantity = product_store_stock.stock_quantity + $3,
           vitrine_quantity = product_store_stock.vitrine_quantity + $4, updated_at = now()
     RETURNING stock_quantity::float8 AS s`, [p.productId, p.storeId, toBackroom, toVitrine])).rows[0].s;
  await c.query(
    `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
     VALUES ($1, 'delivery_reversal', $2, $3, $4, $5, $6, $7)`,
    [p.productId, total, stock, p.label, p.ref.id, p.userId, p.storeId]);
}
