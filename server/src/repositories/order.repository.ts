import { db } from '../config/database.js';

export const orderRepository = {
  async findAll(params: { status?: string; type?: string; customerId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.status) { conditions.push(`o.status = $${i++}`); values.push(params.status); }
    if (params.type) { conditions.push(`o.type = $${i++}`); values.push(params.type); }
    if (params.customerId) { conditions.push(`o.customer_id = $${i++}`); values.push(params.customerId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM orders o ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT o.*, c.first_name as customer_first_name, c.last_name as customer_last_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       ${where} ORDER BY o.created_at DESC LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const orderResult = await db.query(
      `SELECT o.*, c.first_name as customer_first_name, c.last_name as customer_last_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
      [id]
    );
    if (!orderResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT oi.*, p.name as product_name, p.image_url as product_image
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`,
      [id]
    );

    return { ...orderResult.rows[0], items: itemsResult.rows };
  },

  async create(data: {
    orderNumber: string; customerId?: string; userId: string; type: string;
    subtotal: number; taxAmount: number; discountAmount: number; total: number;
    paymentMethod: string; notes?: string; pickupDate?: string;
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, customer_id, user_id, type, subtotal, tax_amount, discount_amount, total, payment_method, notes, pickup_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [data.orderNumber, data.customerId || null, data.userId, data.type,
         data.subtotal, data.taxAmount, data.discountAmount, data.total,
         data.paymentMethod, data.notes || null, data.pickupDate || null]
      );

      for (const item of data.items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.subtotal, item.notes || null]
        );
      }

      // Update customer total spent and loyalty points
      if (data.customerId) {
        const loyaltyPoints = Math.floor(data.total);
        await client.query(
          `UPDATE customers SET total_spent = total_spent + $1, loyalty_points = loyalty_points + $2 WHERE id = $3`,
          [data.total, loyaltyPoints, data.customerId]
        );
      }

      await client.query('COMMIT');
      return orderResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(id: string, status: string) {
    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
    const result = await db.query(
      `UPDATE orders SET status = $1, completed_at = ${completedAt} WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0];
  },

  async generateOrderNumber() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await db.query(
      `SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE`
    );
    const seq = parseInt(result.rows[0].count, 10) + 1;
    return `OFA-${today}-${String(seq).padStart(4, '0')}`;
  },
};
