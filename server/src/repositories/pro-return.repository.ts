import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { adjustProductStock } from './product-stock.helper.js';
import { invoiceRepository } from './accounting.repository.js';

// Retour d'un professionnel (phase 7.5) : réception, décision par ligne (remise en stock
// avec le lot d'origine, ou rebut), avoir facultatif. Le retour POS reste séparé (sale_returns).

const fail = (code: number, msg: string) => Object.assign(new Error(msg), { statusCode: code });

export interface ProReturnItemInput {
  productId: string; productLotId?: string | null; deliveryNoteItemId?: string | null;
  quantity: number; unitPrice?: number; decision: 'restock' | 'scrap';
}

export const proReturnRepository = {
  async list(customerId?: string) {
    const cond = customerId ? 'WHERE r.customer_id = $1' : '';
    const vals = customerId ? [customerId] : [];
    return (await db.query(
      `SELECT r.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) AS customer_name,
              (SELECT count(*) FROM pro_return_items i WHERE i.pro_return_id = r.id) AS item_count
         FROM pro_returns r LEFT JOIN customers c ON c.id = r.customer_id
        ${cond} ORDER BY r.return_date DESC, r.created_at DESC LIMIT 200`, vals)).rows;
  },

  async get(id: string) {
    const r = (await db.query(`SELECT * FROM pro_returns WHERE id = $1`, [id])).rows[0];
    if (!r) return null;
    const items = (await db.query(
      `SELECT i.*, p.name AS product_name FROM pro_return_items i JOIN products p ON p.id = i.product_id WHERE i.pro_return_id = $1`, [id])).rows;
    return { ...r, items };
  },

  /**
   * Enregistre un retour pro. remise en stock : le lot d'origine est ré-incrémenté et le
   * stock du magasin remonte ; rebut : rien ne revient (perte). Avoir émis si une facture
   * d'origine est fournie (creditedInvoiceId).
   */
  async create(data: {
    customerId: string; deliveryNoteId?: string | null; storeId?: string | null; notes?: string | null;
    items: ProReturnItemInput[]; createdBy: string; creditedInvoiceId?: string | null;
  }) {
    const items = data.items.filter(i => i.productId && Number(i.quantity) > 0);
    if (!items.length) throw fail(400, 'Ajoutez au moins une ligne de retour');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const number = await nextDocumentNumber(client, 'pro_return');
      const head = (await client.query(
        `INSERT INTO pro_returns (number, customer_id, delivery_note_id, store_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [number, data.customerId, data.deliveryNoteId ?? null, data.storeId ?? null, data.notes ?? null, data.createdBy])).rows[0];
      for (const it of items) {
        const qty = Number(it.quantity);
        await client.query(
          `INSERT INTO pro_return_items (pro_return_id, product_id, product_lot_id, delivery_note_item_id, quantity, unit_price, decision)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [head.id, it.productId, it.productLotId ?? null, it.deliveryNoteItemId ?? null, qty, it.unitPrice ?? 0, it.decision]);
        if (it.decision === 'restock' && data.storeId) {
          // Lot d'origine ré-incrémenté (réserve) + stock magasin remonté.
          if (it.productLotId) {
            await client.query(`UPDATE product_lots SET backroom_qty = backroom_qty + $2, updated_at = now() WHERE id = $1`, [it.productLotId, qty]);
          }
          const after = await adjustProductStock(client, it.productId, qty, data.storeId);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, reference_id, store_id, performed_by)
             VALUES ($1,'return',$2,$3,$4,$5,$6)`, [it.productId, qty, after, head.id, data.storeId, data.createdBy]);
          // Trace du retour sur le lot livré (si connu).
          if (it.deliveryNoteItemId && it.productLotId) {
            await client.query(
              `UPDATE delivery_note_item_lots SET returned_qty = COALESCE(returned_qty,0) + $3
                WHERE delivery_note_item_id = $1 AND product_lot_id = $2`, [it.deliveryNoteItemId, it.productLotId, qty]);
          }
        }
        // rebut : la marchandise ne revient pas en stock (perte), seule la ligne la trace.
      }
      // Avoir (facultatif) : valeur retournée créditée au client, lié à la facture d'origine.
      if (data.creditedInvoiceId) {
        const avoir = await invoiceRepository.create({
          invoiceType: 'emitted', customerId: data.customerId, invoiceDate: new Date().toISOString().slice(0, 10),
          amount: 0, createdBy: data.createdBy, storeId: data.storeId ?? undefined,
          creditNote: { creditedInvoiceId: data.creditedInvoiceId, reason: 'return' },
          items: items.map(it => ({ productId: it.productId, description: undefined, quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice ?? 0), subtotal: Math.round(Number(it.quantity) * Number(it.unitPrice ?? 0) * 100) / 100 })),
        }, client);
        await client.query(`UPDATE pro_returns SET credit_note_id = $2 WHERE id = $1`, [head.id, avoir.id]);
      }
      await client.query('COMMIT');
      return head;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
