import type { PoolClient } from 'pg';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Facture faite directement depuis une commande (mig 353) : la livraison a
 * forcément eu lieu, elle doit avoir son bon de livraison client.
 *   - un BL « livré » existe déjà pour la commande → il est rattaché à la facture ;
 *   - un BL déjà facturé ailleurs → refus (double facturation) ;
 *   - sinon un BL « facturé » est créé avec les lignes de la facture.
 * Appelé dans la transaction de la facture : tout réussit ou tout échoue.
 */
export async function attachDeliveryNoteToOrderInvoice(
  client: PoolClient,
  params: { invoiceId: string; orderId: string; createdBy: string },
): Promise<string> {
  const existing = (await client.query(
    `SELECT id, number, status FROM delivery_notes WHERE order_id = $1 AND status <> 'cancelled' FOR UPDATE`, [params.orderId])).rows[0];
  if (existing?.status === 'invoiced') {
    throw Object.assign(new Error(`La commande est déjà facturée via le bon de livraison ${existing.number}`), { statusCode: 409 });
  }
  if (existing) {
    await client.query(`UPDATE delivery_notes SET status = 'invoiced', invoice_id = $2 WHERE id = $1`, [existing.id, params.invoiceId]);
    return existing.number as string;
  }
  const head = (await client.query(
    `SELECT i.invoice_date::text AS invoice_date, i.store_id, o.customer_id, o.order_number,
            LEAST((o.completed_at AT TIME ZONE 'Africa/Casablanca')::date, i.invoice_date)::text AS delivery_date
       FROM invoices i JOIN orders o ON o.id = $2 WHERE i.id = $1`, [params.invoiceId, params.orderId])).rows[0];
  if (!head?.customer_id) return '';
  const date = (head.delivery_date ?? head.invoice_date) as string;
  const number = await nextDocumentNumber(client, 'delivery_note', date);
  const note = (await client.query(
    `INSERT INTO delivery_notes (number, customer_id, store_id, order_id, delivery_date, status, invoice_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5::date, 'invoiced', $6, $7, $8) RETURNING id`,
    [number, head.customer_id, head.store_id ?? null, params.orderId, date, params.invoiceId,
     `Livraison de la commande ${head.order_number}, facturée directement`, params.createdBy])).rows[0];
  await client.query(
    `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, tva_rate, subtotal)
     SELECT $1, ii.product_id, COALESCE(NULLIF(btrim(ii.description), ''), p.name, 'Article'), ii.quantity, ii.unit_price, ii.tva_rate,
            ROUND(COALESCE(ii.subtotal, ii.quantity * ii.unit_price), 2)
       FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = $2 AND ii.quantity > 0 AND ii.unit_price >= 0`,
    [note.id, params.invoiceId]);
  return number;
}
