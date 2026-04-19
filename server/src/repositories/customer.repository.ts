import { db } from '../config/database.js';

export const customerRepository = {
  async findAll(params: { search?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.search) {
      conditions.push(`(c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone ILIKE $${i})`);
      values.push(`%${params.search}%`);
      i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM customers c ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT c.*,
        COALESCE(os.orders_count, 0)::int AS orders_count,
        COALESCE(ss.sales_count, 0)::int AS sales_count,
        GREATEST(os.last_order, ss.last_sale) AS last_purchase_at
      FROM customers c
      LEFT JOIN (
        SELECT customer_id, COUNT(*)::int AS orders_count, MAX(created_at) AS last_order
        FROM orders GROUP BY customer_id
      ) os ON os.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, COUNT(*)::int AS sales_count, MAX(created_at) AS last_sale
        FROM sales GROUP BY customer_id
      ) ss ON ss.customer_id = c.id
      ${where}
      ORDER BY c.created_at DESC LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByPhone(phone: string) {
    const result = await db.query('SELECT * FROM customers WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  },

  async create(data: Record<string, unknown>) {
    const result = await db.query(
      `INSERT INTO customers (first_name, last_name, email, phone, notes, customer_type, company_name, address, city, birthday, preferred_contact, allergies)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        data.firstName, data.lastName, data.email || null, data.phone || null, data.notes || null,
        data.customerType || 'particulier', data.companyName || null, data.address || null,
        data.city || null, data.birthday || null, data.preferredContact || 'phone', data.allergies || null,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', notes: 'notes',
      customerType: 'customer_type', companyName: 'company_name', address: 'address',
      city: 'city', birthday: 'birthday', preferredContact: 'preferred_contact', allergies: 'allergies',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);

    const result = await db.query(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async stats(id: string) {
    const [ordersRes, salesRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS count,
          COALESCE(SUM(total), 0) AS total_amount,
          MAX(created_at) AS last_date
        FROM orders WHERE customer_id = $1`, [id]),
      db.query(
        `SELECT COUNT(*)::int AS count,
          COALESCE(SUM(total), 0) AS total_amount,
          MAX(created_at) AS last_date
        FROM sales WHERE customer_id = $1`, [id]),
    ]);

    const orderHistory = await db.query(
      `SELECT id, order_number, total, status, payment_method, created_at
      FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]);

    const salesHistory = await db.query(
      `SELECT s.id, s.sale_number, s.total, s.payment_method, s.created_at,
        json_agg(json_build_object('name', p.name, 'quantity', si.quantity, 'unit_price', si.unit_price)) AS items
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.customer_id = $1
      GROUP BY s.id
      ORDER BY s.created_at DESC LIMIT 20`, [id]);

    return {
      orders: { ...ordersRes.rows[0], history: orderHistory.rows },
      sales: { ...salesRes.rows[0], history: salesHistory.rows },
    };
  },

  async globalStats() {
    const result = await db.query(
      `SELECT
        COUNT(*)::int AS total_clients,
        COALESCE(SUM(loyalty_points), 0)::int AS total_loyalty_points,
        COALESCE(SUM(total_spent), 0) AS total_ca_clients
      FROM customers`
    );
    const bestClient = await db.query(
      `SELECT id, first_name, last_name, total_spent, loyalty_points
      FROM customers ORDER BY total_spent DESC LIMIT 1`
    );
    return { ...result.rows[0], best_client: bestClient.rows[0] || null };
  },

  async delete(id: string) {
    await db.query('DELETE FROM customers WHERE id = $1', [id]);
  },
};
