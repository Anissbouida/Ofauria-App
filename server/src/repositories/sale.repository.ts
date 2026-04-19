import { db } from '../config/database.js';
import { adjustProductStock, adjustVitrineStock } from './product-stock.helper.js';
import { getUserTimezone, getLocalDateString } from '../utils/timezone.js';

export const saleRepository = {
  async findAll(params: {
    dateFrom?: string; dateTo?: string; customerId?: string;
    paymentMethod?: string; userId?: string; search?: string;
    categoryId?: string; productId?: string; storeId?: string;
    limit: number; offset: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    let needItemJoin = false;

    if (params.storeId) { conditions.push(`s.store_id = $${i++}`); values.push(params.storeId); }
    if (params.dateFrom) { conditions.push(`s.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`s.created_at < ($${i++}::date + 1)`); values.push(params.dateTo); }
    if (params.customerId) { conditions.push(`s.customer_id = $${i++}`); values.push(params.customerId); }
    if (params.paymentMethod) { conditions.push(`s.payment_method = $${i++}`); values.push(params.paymentMethod); }
    if (params.userId) { conditions.push(`s.user_id = $${i++}`); values.push(params.userId); }
    if (params.search) { conditions.push(`s.sale_number ILIKE $${i++}`); values.push(`%${params.search}%`); }
    if (params.productId) {
      conditions.push(`s.id IN (SELECT si2.sale_id FROM sale_items si2 WHERE si2.product_id = $${i++})`);
      values.push(params.productId);
      needItemJoin = true;
    }
    if (params.categoryId) {
      conditions.push(`s.id IN (SELECT si3.sale_id FROM sale_items si3 JOIN products p3 ON p3.id = si3.product_id WHERE p3.category_id = $${i++})`);
      values.push(params.categoryId);
      needItemJoin = true;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(DISTINCT s.id) FROM sales s ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT DISTINCT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const saleResult = await db.query(
      `SELECT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [id]
    );
    if (!saleResult.rows[0]) return null;

    const sale = saleResult.rows[0];

    // For advance/delivery sales linked to an order, fetch order items (with real quantities)
    if (sale.order_id && (sale.sale_type === 'advance' || sale.sale_type === 'delivery')) {
      const orderResult = await db.query(
        `SELECT o.subtotal as order_subtotal, o.total as order_total, o.discount_amount as order_discount,
                o.advance_amount as order_advance, o.order_number
         FROM orders o WHERE o.id = $1`,
        [sale.order_id]
      );
      const orderItemsResult = await db.query(
        `SELECT oi.*, p.name as product_name, p.image_url as product_image
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [sale.order_id]
      );
      const orderData = orderResult.rows[0] || {};
      return {
        ...sale,
        items: orderItemsResult.rows,
        order_subtotal: orderData.order_subtotal,
        order_total: orderData.order_total,
        order_discount: orderData.order_discount,
        order_advance: orderData.order_advance,
        order_number: orderData.order_number,
      };
    }

    const itemsResult = await db.query(
      `SELECT si.*, p.name as product_name, p.image_url as product_image
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [id]
    );

    return { ...sale, items: itemsResult.rows };
  },

  async findBySaleNumber(saleNumber: string) {
    const saleResult = await db.query(
      `SELECT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE s.sale_number = $1`,
      [saleNumber]
    );
    if (!saleResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT si.*, p.name as product_name, p.image_url as product_image
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [saleResult.rows[0].id]
    );

    return { ...saleResult.rows[0], items: itemsResult.rows };
  },

  async create(data: {
    customerId?: string; userId: string;
    subtotal: number; taxAmount: number; discountAmount: number; total: number;
    paymentMethod: string; notes?: string; sessionId?: string; storeId?: string;
    advanceAmount?: number; advanceDate?: string | null; orderId?: string;
    skipStockDeduction?: boolean;
    saleType?: 'standard' | 'advance' | 'delivery';
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const saleNumber = await generateSaleNumber(client);

      const saleResult = await client.query(
        `INSERT INTO sales (sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, session_id, store_id, advance_amount, advance_date, order_id, sale_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [saleNumber, data.customerId || null, data.userId, data.subtotal,
         data.taxAmount, data.discountAmount, data.total, data.paymentMethod, data.notes || null, data.sessionId || null, data.storeId || null,
         data.advanceAmount || 0, data.advanceDate || null, data.orderId || null, data.saleType || 'standard']
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [saleResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );

        // Decrement vitrine (display) stock — skip for advance sales (stock deducted at delivery).
        // POS sells strictly from the vitrine: stock_quantity is backroom reserve
        // and is only moved via replenishment reception (transferBackroomToVitrine).
        // Derive skip logic from saleType rather than trusting the caller's flag.
        const shouldSkipStock = data.saleType === 'advance' || (data.skipStockDeduction && data.saleType !== 'standard');
        if (!shouldSkipStock) {
          if (!data.storeId) {
            throw new Error('storeId requis pour une vente POS (vitrine strictement par magasin)');
          }
          const stockAfter = await adjustVitrineStock(client, item.productId, data.storeId, -item.quantity);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, 'sale', $2, $3, $4, $5, $6, $7)`,
            [item.productId, -item.quantity, stockAfter,
             `Vente ${saleNumber}`, saleResult.rows[0].id, data.userId, data.storeId]
          );
        }
      }

      // Update customer loyalty
      if (data.customerId) {
        const loyaltyPoints = Math.floor(data.total);
        await client.query(
          `UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3`,
          [data.total, loyaltyPoints, data.customerId]
        );
      }

      await client.query('COMMIT');
      return saleResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async todayStats(storeId?: string) {
    const storeFilter = storeId ? ' AND store_id = $1' : '';
    const storeValues = storeId ? [storeId] : [];
    const tz = getUserTimezone();

    const result = await db.query(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_sale_value
      FROM sales
      WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    const itemsResult = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) as total_items
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE (s.created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    // Subtract today's refunds from revenue
    const returnsResult = await db.query(`
      SELECT COALESCE(SUM(refund_amount), 0) as total_refunds,
             COUNT(*) as total_returns
      FROM sale_returns
      WHERE type = 'return' AND (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    const totalRefunds = parseFloat(returnsResult.rows[0].total_refunds);
    const grossRevenue = parseFloat(result.rows[0].total_revenue);

    return {
      totalSales: parseInt(result.rows[0].total_sales),
      totalRevenue: grossRevenue - totalRefunds,
      avgSaleValue: parseFloat(result.rows[0].avg_sale_value),
      totalItems: parseInt(itemsResult.rows[0].total_items),
      totalRefunds,
      totalReturns: parseInt(returnsResult.rows[0].total_returns),
    };
  },

  async summary(params: { dateFrom?: string; dateTo?: string; groupBy: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`s.store_id = $${i++}`); values.push(params.storeId); }
    if (params.dateFrom) { conditions.push(`s.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`s.created_at < ($${i++}::date + 1)`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build return conditions for the same date range
    const retConditions: string[] = [];
    const retValues: unknown[] = [];
    let ri = 1;
    if (params.dateFrom) { retConditions.push(`sr.created_at >= $${ri++}`); retValues.push(params.dateFrom); }
    if (params.dateTo) { retConditions.push(`sr.created_at < ($${ri++}::date + 1)`); retValues.push(params.dateTo); }
    const retWhere = retConditions.length ? `WHERE sr.type = 'return' AND ${retConditions.join(' AND ')}` : `WHERE sr.type = 'return'`;

    if (params.groupBy === 'category') {
      const result = await db.query(
        `SELECT cat.id, cat.name as label,
                COUNT(DISTINCT s.id) as sale_count,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         JOIN categories cat ON cat.id = p.category_id
         ${where}
         GROUP BY cat.id, cat.name
         ORDER BY total_revenue DESC`,
        values
      );
      // Subtract returned quantities and amounts per category
      const retResult = await db.query(
        `SELECT cat.id,
                COALESCE(SUM(sri.quantity), 0) as returned_qty,
                COALESCE(SUM(sri.subtotal), 0) as returned_amount
         FROM sale_return_items sri
         JOIN sale_returns sr ON sr.id = sri.return_id
         JOIN products p ON p.id = sri.product_id
         JOIN categories cat ON cat.id = p.category_id
         ${retWhere}
         GROUP BY cat.id`,
        retValues
      );
      const retMap: Record<string, { qty: number; amount: number }> = {};
      for (const r of retResult.rows) {
        retMap[r.id] = { qty: parseFloat(r.returned_qty), amount: parseFloat(r.returned_amount) };
      }
      return result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        total_quantity: parseInt(row.total_quantity as string) - (retMap[row.id as string]?.qty || 0),
        total_revenue: parseFloat(row.total_revenue as string) - (retMap[row.id as string]?.amount || 0),
      }));
    }

    if (params.groupBy === 'product') {
      const result = await db.query(
        `SELECT p.id, p.name as label, cat.name as category_name,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue,
                COUNT(DISTINCT s.id) as sale_count
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         ${where}
         GROUP BY p.id, p.name, cat.name
         ORDER BY total_quantity DESC`,
        values
      );
      // Subtract returned quantities and amounts per product
      const retResult = await db.query(
        `SELECT sri.product_id as id,
                COALESCE(SUM(sri.quantity), 0) as returned_qty,
                COALESCE(SUM(sri.subtotal), 0) as returned_amount
         FROM sale_return_items sri
         JOIN sale_returns sr ON sr.id = sri.return_id
         ${retWhere}
         GROUP BY sri.product_id`,
        retValues
      );
      const retMap: Record<string, { qty: number; amount: number }> = {};
      for (const r of retResult.rows) {
        retMap[r.id] = { qty: parseFloat(r.returned_qty), amount: parseFloat(r.returned_amount) };
      }
      return result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        total_quantity: parseInt(row.total_quantity as string) - (retMap[row.id as string]?.qty || 0),
        total_revenue: parseFloat(row.total_revenue as string) - (retMap[row.id as string]?.amount || 0),
      }));
    }

    if (params.groupBy === 'cashier') {
      const result = await db.query(
        `SELECT u.id, u.first_name || ' ' || u.last_name as label, u.role,
                COUNT(s.id) as sale_count,
                SUM(s.total) as total_revenue
         FROM sales s
         JOIN users u ON u.id = s.user_id
         ${where}
         GROUP BY u.id, u.first_name, u.last_name, u.role
         ORDER BY total_revenue DESC`,
        values
      );
      return result.rows;
    }

    if (params.groupBy === 'payment') {
      const result = await db.query(
        `SELECT s.payment_method as label,
                COUNT(s.id) as sale_count,
                SUM(s.total) as total_revenue
         FROM sales s
         ${where}
         GROUP BY s.payment_method
         ORDER BY total_revenue DESC`,
        values
      );
      return result.rows;
    }

    return [];
  },

  async importDailySales(data: {
    date: string;
    userId: string;
    storeId?: string;
    items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[];
  }) {
    // Validate CSV items before any DB work
    const invalidItems: string[] = [];
    for (const item of data.items) {
      if (!item.quantity || item.quantity <= 0) {
        invalidItems.push(`${item.productName}: quantité invalide (${item.quantity})`);
      }
      if (item.unitPrice < 0) {
        invalidItems.push(`${item.productName}: prix unitaire négatif (${item.unitPrice})`);
      }
      if (item.netSales < 0) {
        invalidItems.push(`${item.productName}: ventes nettes négatives (${item.netSales})`);
      }
    }
    if (invalidItems.length > 0) {
      return { created: false, unmatchedItems: [], invalidItems, saleNumber: null };
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Match products by SKU or name
      const matchedItems: { productId: string; quantity: number; unitPrice: number; subtotal: number; costOfGoods: number }[] = [];
      const unmatchedItems: string[] = [];

      for (const item of data.items) {
        // Try matching by SKU first, then by name
        let productResult = await client.query(
          `SELECT id, price FROM products WHERE sku = $1 LIMIT 1`,
          [item.sku]
        );
        if (!productResult.rows[0]) {
          productResult = await client.query(
            `SELECT id, price FROM products WHERE UPPER(name) = UPPER($1) LIMIT 1`,
            [item.productName]
          );
        }
        if (productResult.rows[0]) {
          matchedItems.push({
            productId: productResult.rows[0].id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.netSales,
            costOfGoods: item.costOfGoods || 0,
          });
          // Update SKU if not set
          if (item.sku) {
            await client.query(
              `UPDATE products SET sku = $1 WHERE id = $2 AND sku IS NULL`,
              [item.sku, productResult.rows[0].id]
            );
          }
        } else {
          unmatchedItems.push(`${item.productName} (UGS: ${item.sku})`);
        }
      }

      if (matchedItems.length === 0) {
        await client.query('ROLLBACK');
        return { created: false, unmatchedItems, invalidItems: [], saleNumber: null };
      }

      const subtotal = matchedItems.reduce((sum, i) => sum + i.subtotal, 0);
      const total = subtotal;

      // Generate sale number for the import date (advisory lock prevents race)
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('sale_number'))`);
      const prefix = `IMP-${data.date}-`;
      const seqResult = await client.query(
        `SELECT sale_number FROM sales WHERE sale_number LIKE $1 ORDER BY sale_number DESC LIMIT 1`,
        [prefix + '%']
      );
      let seq = 1;
      if (seqResult.rows.length > 0) {
        const lastSeq = parseInt(seqResult.rows[0].sale_number.split('-').pop() || '0', 10);
        seq = lastSeq + 1;
      }
      const saleNumber = `${prefix}${String(seq).padStart(4, '0')}`;

      const saleResult = await client.query(
        `INSERT INTO sales (sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, store_id, created_at)
         VALUES ($1, NULL, $2, $3, 0, 0, $4, 'cash', $5, $6, $7::date + TIME '23:59:00') RETURNING *`,
        [saleNumber, data.userId, subtotal, total, `Import CSV du ${data.date}`, data.storeId || null, data.date]
      );

      for (const item of matchedItems) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [saleResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );
      }

      await client.query('COMMIT');
      return {
        created: true,
        saleNumber,
        saleId: saleResult.rows[0].id,
        matchedCount: matchedItems.length,
        unmatchedItems,
        total,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

async function generateSaleNumber(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }) {
  // Advisory lock prevents concurrent transactions from reading the same max sequence
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('sale_number'))`);
  const today = getLocalDateString();
  const prefix = `VNT-${today}-`;
  const result = await client.query(
    `SELECT sale_number FROM sales WHERE sale_number LIKE $1 ORDER BY sale_number DESC LIMIT 1`,
    [prefix + '%']
  );
  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].sale_number;
    const lastSeq = parseInt(lastNum.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
