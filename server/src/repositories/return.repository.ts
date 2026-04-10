import { db } from '../config/database.js';
import { adjustProductStock } from './product-stock.helper.js';
import { getUserTimezone, getLocalDateString } from '../utils/timezone.js';

export const returnRepository = {
  async findAll(params: { dateFrom?: string; dateTo?: string; storeId?: string; limit?: number; offset?: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`sr.store_id = $${i++}`); values.push(params.storeId); }
    if (params.dateFrom) { conditions.push(`sr.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`sr.created_at < ($${i++}::date + 1)`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM sale_returns sr ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const limit = params.limit || 100;
    const offset = params.offset || 0;
    values.push(limit, offset);

    const result = await db.query(
      `SELECT sr.*,
              u.first_name as user_first_name, u.last_name as user_last_name,
              s.sale_number as original_sale_number
       FROM sale_returns sr
       JOIN users u ON u.id = sr.user_id
       JOIN sales s ON s.id = sr.original_sale_id
       ${where}
       ORDER BY sr.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    // Load return items for each return
    for (const ret of result.rows) {
      const itemsResult = await db.query(
        `SELECT sri.*, p.name as product_name
         FROM sale_return_items sri
         JOIN products p ON p.id = sri.product_id
         WHERE sri.return_id = $1`,
        [ret.id]
      );
      ret.items = itemsResult.rows;
    }

    return { rows: result.rows, total };
  },

  async findBySaleId(saleId: string) {
    const result = await db.query(
      `SELECT sr.*, u.first_name as user_first_name, u.last_name as user_last_name
       FROM sale_returns sr
       JOIN users u ON u.id = sr.user_id
       WHERE sr.original_sale_id = $1
       ORDER BY sr.created_at DESC`,
      [saleId]
    );

    // Load return items for each return
    for (const ret of result.rows) {
      const itemsResult = await db.query(
        `SELECT sri.*, p.name as product_name
         FROM sale_return_items sri
         JOIN products p ON p.id = sri.product_id
         WHERE sri.return_id = $1`,
        [ret.id]
      );
      ret.items = itemsResult.rows;
    }

    return result.rows;
  },

  /** Get total returned quantity per sale_item_id for a given sale */
  async getReturnedQuantities(saleId: string): Promise<Record<string, number>> {
    const result = await db.query(
      `SELECT sri.sale_item_id, SUM(sri.quantity) as returned_qty
       FROM sale_return_items sri
       JOIN sale_returns sr ON sr.id = sri.return_id
       WHERE sr.original_sale_id = $1
       GROUP BY sri.sale_item_id`,
      [saleId]
    );
    const map: Record<string, number> = {};
    for (const row of result.rows) {
      map[row.sale_item_id] = parseInt(row.returned_qty, 10);
    }
    return map;
  },

  async create(data: {
    originalSaleId: string;
    userId: string;
    sessionId?: string;
    storeId?: string;
    type: 'return' | 'exchange';
    reason?: string;
    refundAmount: number;
    items: { saleItemId: string; productId: string; quantity: number; unitPrice: number; subtotal: number }[];
    exchangeProducts?: { saleItemId: string; newProductId: string; quantity: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const returnNumber = await generateReturnNumber(client);

      let exchangeSaleId: string | null = null;
      let exchangeTotal = 0;

      // For exchanges, create a new sale with the replacement products
      if (data.type === 'exchange' && data.exchangeProducts?.length) {
        // Look up prices for replacement products
        const exchangeItems: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
        for (const ep of data.exchangeProducts) {
          const prodResult = await client.query('SELECT id, price FROM products WHERE id = $1', [ep.newProductId]);
          if (!prodResult.rows[0]) throw new Error(`Produit de remplacement ${ep.newProductId} non trouve`);
          const price = parseFloat(prodResult.rows[0].price);
          exchangeItems.push({
            productId: ep.newProductId,
            quantity: ep.quantity,
            unitPrice: price,
            subtotal: price * ep.quantity,
          });
        }

        exchangeTotal = exchangeItems.reduce((sum, it) => sum + it.subtotal, 0);

        // Generate a sale number for the exchange sale
        const tz = getUserTimezone();
        const today = getLocalDateString();
        const saleCountResult = await client.query(
          `SELECT COUNT(*) FROM sales WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date`
        );
        const saleSeq = parseInt(saleCountResult.rows[0].count, 10) + 1;
        const exchangeSaleNumber = `VNT-${today}-${String(saleSeq).padStart(4, '0')}`;

        // Determine payment: difference between exchange total and refund
        const priceDiff = exchangeTotal - data.refundAmount;

        const exchangeSaleResult = await client.query(
          `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, session_id, store_id)
           VALUES ($1, $2, $3, 0, 0, $4, 'cash', $5, $6, $7) RETURNING *`,
          [
            exchangeSaleNumber,
            data.userId,
            exchangeTotal,
            exchangeTotal,
            `Echange - Retour ${returnNumber}${priceDiff > 0 ? ` - Client paie ${priceDiff.toFixed(2)} DH` : priceDiff < 0 ? ` - Rendre ${Math.abs(priceDiff).toFixed(2)} DH au client` : ''}`,
            data.sessionId || null,
            data.storeId || null,
          ]
        );

        exchangeSaleId = exchangeSaleResult.rows[0].id;

        // Insert exchange sale items
        for (const item of exchangeItems) {
          await client.query(
            `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [exchangeSaleId, item.productId, item.quantity, item.unitPrice, item.subtotal]
          );
        }
      }

      const returnResult = await client.query(
        `INSERT INTO sale_returns (return_number, original_sale_id, user_id, session_id, type, reason, refund_amount, exchange_sale_id, store_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [returnNumber, data.originalSaleId, data.userId, data.sessionId || null,
         data.type, data.reason || null, data.refundAmount, exchangeSaleId, data.storeId || null]
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [returnResult.rows[0].id, item.saleItemId, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );

        // Restore product stock on return (store-isolated)
        const stockAfter = await adjustProductStock(client, item.productId, item.quantity, data.storeId);
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
           VALUES ($1, 'return', $2, $3, $4, $5, $6, $7)`,
          [item.productId, item.quantity, stockAfter,
           `Retour ${returnNumber}`, returnResult.rows[0].id, data.userId, data.storeId || null]
        );
      }

      // For exchanges, decrement stock for new products given
      if (data.type === 'exchange' && data.exchangeProducts?.length) {
        for (const ep of data.exchangeProducts) {
          // Decrement stock for exchanged product (store-isolated)
          const stockAfter = await adjustProductStock(client, ep.newProductId, -ep.quantity, data.storeId);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, 'exchange', $2, $3, $4, $5, $6, $7)`,
            [ep.newProductId, -ep.quantity, stockAfter,
             `Echange ${returnNumber}`, returnResult.rows[0].id, data.userId, data.storeId || null]
          );
        }
      }

      await client.query('COMMIT');

      const result = returnResult.rows[0];
      if (exchangeSaleId) {
        result.exchange_sale_id = exchangeSaleId;
        result.exchange_total = exchangeTotal;
        result.price_difference = exchangeTotal - data.refundAmount;
      }
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

async function generateReturnNumber(client: { query: (text: string) => Promise<{ rows: { count: string }[] }> }) {
  const tz = getUserTimezone();
  const today = getLocalDateString();
  const result = await client.query(
    `SELECT COUNT(*) FROM sale_returns WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date`
  );
  const seq = parseInt(result.rows[0].count, 10) + 1;
  return `RET-${today}-${String(seq).padStart(4, '0')}`;
}
