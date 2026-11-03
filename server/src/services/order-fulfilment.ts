/**
 * Exécution des commandes (O2C L2, mig 441) : cumuls par ligne et statut.
 *
 *   reste à livrer = commandé − livré − annulé (reliquat soldé)
 *
 * Chaque BL ajoute au livré de ses lignes de commande ; son annulation le
 * retire et rouvre la commande. La commande est « terminée » quand plus rien
 * ne reste à livrer, « partiellement livrée » sinon. Solder le reliquat le
 * passe en annulé et termine la commande. La réservation de stock (mig 389)
 * suit : consommée au fil des livraisons, reconstituée à la réouverture.
 */
import type { PoolClient } from 'pg';

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
type Fail = Error & { statusCode?: number };
const fail = (statusCode: number, message: string): Fail => Object.assign(new Error(message), { statusCode });

export type OrderLineState = { id: string; product_id: string; quantity: number; qty_delivered: number; qty_cancelled: number; qty_invoiced: number };

export const remainingOf = (l: Pick<OrderLineState, 'quantity' | 'qty_delivered' | 'qty_cancelled'>) =>
  Math.max(0, r3(Number(l.quantity) - Number(l.qty_delivered) - Number(l.qty_cancelled)));

/** Plafond livrable d'une ligne : reste majoré de la tolérance de sur-livraison du client. */
export const deliverableOf = (l: Pick<OrderLineState, 'quantity' | 'qty_delivered' | 'qty_cancelled'>, tolerancePct: number) =>
  r3(remainingOf(l) + Number(l.quantity) * Math.max(0, tolerancePct) / 100);

/** Statut d'exécution déduit des lignes (pur). */
export function fulfilmentStatus(lines: Pick<OrderLineState, 'quantity' | 'qty_delivered' | 'qty_cancelled'>[]): 'ready' | 'partially_delivered' | 'completed' {
  if (lines.every(l => remainingOf(l) <= 0)) return 'completed';
  return lines.some(l => Number(l.qty_delivered) > 0) ? 'partially_delivered' : 'ready';
}

export async function lockOrderLines(c: PoolClient, orderId: string) {
  return (await c.query(
    `SELECT id, product_id, quantity::float8 AS quantity, qty_delivered::float8 AS qty_delivered,
            qty_cancelled::float8 AS qty_cancelled, qty_invoiced::float8 AS qty_invoiced
       FROM order_items WHERE order_id = $1 ORDER BY id FOR UPDATE`, [orderId])).rows as OrderLineState[];
}

/** Recalcule et pose le statut d'exécution d'une commande prête, partiellement livrée ou terminée. */
export async function refreshOrderStatus(c: PoolClient, orderId: string) {
  const o = (await c.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
  if (!o || !['ready', 'partially_delivered', 'completed'].includes(o.status)) return o?.status ?? null;
  const next = fulfilmentStatus(await lockOrderLines(c, orderId));
  if (next !== o.status) {
    await c.query(
      `UPDATE orders SET status = $2::varchar, completed_at = CASE WHEN $2::varchar = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END
        WHERE id = $1`, [orderId, next]);
  }
  return next;
}

/** Consomme la réservation de stock d'une ligne à hauteur de la quantité livrée. */
async function consumeReservation(c: PoolClient, orderItemId: string, qty: number) {
  let left = r3(qty);
  const rows = (await c.query(
    `SELECT id, product_id, store_id, quantity::float8 AS quantity FROM order_stock_reservations
      WHERE order_item_id = $1 AND status = 'reserved' ORDER BY created_at FOR UPDATE`, [orderItemId])).rows;
  for (const r of rows) {
    if (left <= 0) break;
    const take = r3(Math.min(left, r.quantity));
    await c.query(
      `UPDATE order_stock_reservations SET quantity = quantity - $2,
              status = CASE WHEN quantity - $2 <= 0 THEN 'consumed' ELSE status END,
              resolved_at = CASE WHEN quantity - $2 <= 0 THEN now() ELSE resolved_at END
        WHERE id = $1`, [r.id, take]);
    await c.query(
      `UPDATE product_store_stock SET reserved_quantity = GREATEST(reserved_quantity - $3, 0)
        WHERE product_id = $1 AND store_id = $2`, [r.product_id, r.store_id, take]);
    left = r3(left - take);
  }
}

/** Livré par un BL : cumuls de ligne bornés par la tolérance, réservation consommée, statut recalculé. */
export async function recordDelivered(c: PoolClient, orderId: string, lines: { orderItemId: string; qty: number }[], tolerancePct: number) {
  const state = new Map((await lockOrderLines(c, orderId)).map(l => [l.id, l]));
  for (const l of lines) {
    const cur = state.get(l.orderItemId);
    if (!cur) throw fail(400, 'Ligne de BL rattachée à une ligne d\'une autre commande');
    const max = deliverableOf(cur, tolerancePct);
    if (r3(l.qty) > max + 0.0005) {
      throw fail(409, `Quantité livrée (${l.qty}) au-delà du reste à livrer (${remainingOf(cur)}${tolerancePct ? `, tolérance ${tolerancePct} % comprise : ${max}` : ''})`);
    }
    await c.query(`UPDATE order_items SET qty_delivered = qty_delivered + $2 WHERE id = $1`, [l.orderItemId, r3(l.qty)]);
    cur.qty_delivered = r3(cur.qty_delivered + l.qty);
    await consumeReservation(c, l.orderItemId, l.qty);
  }
  return refreshOrderStatus(c, orderId);
}

/** Solde le reliquat : le reste à livrer passe en annulé, la commande est terminée. */
export async function closeRemainder(c: PoolClient, orderId: string) {
  for (const l of await lockOrderLines(c, orderId)) {
    const rest = remainingOf(l);
    if (rest > 0) await c.query(`UPDATE order_items SET qty_cancelled = qty_cancelled + $2 WHERE id = $1`, [l.id, rest]);
  }
  return refreshOrderStatus(c, orderId);
}

/** Annulation d'un BL : le livré redescend, le stock remis est de nouveau réservé, la commande se rouvre. */
export async function reverseDelivered(c: PoolClient, orderId: string, lines: { orderItemId: string; qty: number }[], storeId: string | null) {
  const state = new Map((await lockOrderLines(c, orderId)).map(l => [l.id, l]));
  for (const l of lines) {
    const cur = state.get(l.orderItemId);
    if (!cur) continue;
    const back = r3(Math.min(l.qty, cur.qty_delivered));
    if (back <= 0) continue;
    if (cur.qty_delivered - back < cur.qty_invoiced - 0.0005) throw fail(409, 'Quantité déjà facturée : annulez d\'abord la facture');
    // Un reliquat soldé est rouvert d'autant (la quantité revient à livrer).
    const reopenCancelled = r3(Math.min(cur.qty_cancelled, back));
    await c.query(`UPDATE order_items SET qty_delivered = qty_delivered - $2, qty_cancelled = qty_cancelled - $3 WHERE id = $1`,
      [l.orderItemId, back, reopenCancelled]);
    if (storeId) {
      await c.query(
        `INSERT INTO order_stock_reservations (order_id, order_item_id, product_id, store_id, quantity, status)
         VALUES ($1, $2, $3, $4, $5, 'reserved')`, [orderId, l.orderItemId, cur.product_id, storeId, back]);
      await c.query(
        `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, reserved_quantity) VALUES ($1, $2, 0, $3)
         ON CONFLICT (product_id, store_id) DO UPDATE SET reserved_quantity = product_store_stock.reserved_quantity + $3`,
        [cur.product_id, storeId, back]);
    }
  }
  return refreshOrderStatus(c, orderId);
}
