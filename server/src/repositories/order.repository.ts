import { db } from '../config/database.js';
import { getUserTimezone, getLocalDateString } from '../utils/timezone.js';

export const orderRepository = {
  async findAll(params: { status?: string; type?: string; customerId?: string; storeId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`o.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status) { conditions.push(`o.status = $${i++}`); values.push(params.status); }
    if (params.type) { conditions.push(`o.type = $${i++}`); values.push(params.type); }
    if (params.customerId) { conditions.push(`o.customer_id = $${i++}`); values.push(params.customerId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM orders o ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT o.*, COALESCE(c.first_name, o.customer_name) as customer_first_name, c.last_name as customer_last_name, COALESCE(c.phone, o.customer_phone) as customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       ${where} ORDER BY o.created_at DESC LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const orderResult = await db.query(
      `SELECT o.*, COALESCE(c.first_name, o.customer_name) as customer_first_name, c.last_name as customer_last_name, COALESCE(c.phone, o.customer_phone) as customer_phone
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
    orderNumber: string; customerId?: string; customerName?: string; customerPhone?: string;
    userId: string; type: string;
    subtotal: number; taxAmount: number; discountAmount: number; total: number;
    advanceAmount?: number; paymentMethod: string; notes?: string; pickupDate?: string;
    sessionId?: string; storeId?: string;
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, user_id, type, subtotal, tax_amount, discount_amount, total, advance_amount, payment_method, notes, pickup_date, session_id, store_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [data.orderNumber, data.customerId || null, data.customerName || null, data.customerPhone || null,
         data.userId, data.type,
         data.subtotal, data.taxAmount, data.discountAmount, data.total,
         data.advanceAmount || 0, data.paymentMethod, data.notes || null, data.pickupDate || null, data.sessionId || null, data.storeId || null]
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

  async update(id: string, data: {
    customerId?: string; customerName?: string; customerPhone?: string;
    type?: string; subtotal: number; taxAmount: number;
    discountAmount: number; total: number; advanceAmount?: number;
    paymentMethod?: string; notes?: string; pickupDate?: string;
    items: { productId: string; quantity: number; unitPrice: number; subtotal: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `UPDATE orders SET customer_id = $1, customer_name = $2, customer_phone = $3,
         type = COALESCE($4, type),
         subtotal = $5, tax_amount = $6, discount_amount = $7, total = $8, advance_amount = $9,
         payment_method = COALESCE($10, payment_method), notes = $11, pickup_date = COALESCE($12, pickup_date)
         WHERE id = $13 AND status IN ('pending', 'confirmed') RETURNING *`,
        [data.customerId || null, data.customerName || null, data.customerPhone || null,
         data.type || null, data.subtotal, data.taxAmount,
         data.discountAmount, data.total, data.advanceAmount || 0,
         data.paymentMethod || null, data.notes || null, data.pickupDate || null, id]
      );

      if (!orderResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      // Replace items
      await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
      for (const item of data.items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, item.productId, item.quantity, item.unitPrice, item.subtotal, item.notes || null]
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
    const tz = getUserTimezone();
    const today = getLocalDateString();
    const result = await db.query(
      `SELECT COUNT(*) FROM orders WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date`
    );
    const seq = parseInt(result.rows[0].count, 10) + 1;
    return `CMD-${today}-${String(seq).padStart(4, '0')}`;
  },

  async findByPickupDate(date: string, storeId?: string) {
    const conditions = [`o.pickup_date::date = $1`, `o.status IN ('confirmed', 'in_production')`];
    const values: unknown[] = [date];
    if (storeId) { conditions.push(`o.store_id = $2`); values.push(storeId); }

    const result = await db.query(
      `SELECT o.*, COALESCE(c.first_name, o.customer_name) as customer_first_name, c.last_name as customer_last_name,
              json_agg(json_build_object(
                'id', oi.id, 'product_id', oi.product_id, 'product_name', p.name,
                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'notes', oi.notes
              )) as items
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY o.id, c.first_name, c.last_name
       ORDER BY o.created_at`,
      values
    );
    return result.rows;
  },
};
