import { db } from '../config/database.js';

export const saleRepository = {
  async findAll(params: { dateFrom?: string; dateTo?: string; customerId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.dateFrom) { conditions.push(`s.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`s.created_at < ($${i++}::date + 1)`); values.push(params.dateTo); }
    if (params.customerId) { conditions.push(`s.customer_id = $${i++}`); values.push(params.customerId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM sales s ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT s.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
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

    const itemsResult = await db.query(
      `SELECT si.*, p.name as product_name, p.image_url as product_image
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [id]
    );

    return { ...saleResult.rows[0], items: itemsResult.rows };
  },

  async create(data: {
    customerId?: string; userId: string;
    subtotal: number; taxAmount: number; discountAmount: number; total: number;
    paymentMethod: string; notes?: string;
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const saleNumber = await generateSaleNumber(client);

      const saleResult = await client.query(
        `INSERT INTO sales (sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [saleNumber, data.customerId || null, data.userId, data.subtotal,
         data.taxAmount, data.discountAmount, data.total, data.paymentMethod, data.notes || null]
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [saleResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );
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

  async todayStats() {
    const result = await db.query(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_sale_value
      FROM sales
      WHERE created_at::date = CURRENT_DATE
    `);

    const itemsResult = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) as total_items
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at::date = CURRENT_DATE
    `);

    return {
      totalSales: parseInt(result.rows[0].total_sales),
      totalRevenue: parseFloat(result.rows[0].total_revenue),
      avgSaleValue: parseFloat(result.rows[0].avg_sale_value),
      totalItems: parseInt(itemsResult.rows[0].total_items),
    };
  },
};

async function generateSaleNumber(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: { count: string }[] }> }) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await client.query(
    `SELECT COUNT(*) FROM sales WHERE created_at::date = CURRENT_DATE`
  );
  const seq = parseInt(result.rows[0].count, 10) + 1;
  return `VNT-${today}-${String(seq).padStart(4, '0')}`;
}
