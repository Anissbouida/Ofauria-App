import { db } from '../config/database.js';

export const cashRegisterRepository = {
  async findOpenSession(userId: string) {
    const result = await db.query(
      `SELECT * FROM cash_register_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  },

  async findAll(params: { userId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`cs.store_id = $${i++}`); values.push(params.storeId); }
    if (params.userId) { conditions.push(`cs.user_id = $${i++}`); values.push(params.userId); }
    if (params.status) { conditions.push(`cs.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`cs.opened_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`cs.opened_at < ($${i++}::date + 1)`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM cash_register_sessions cs ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT cs.*, u.first_name, u.last_name,
         dic.total_replenished as inv_total_replenished,
         dic.total_sold as inv_total_sold,
         dic.total_remaining as inv_total_remaining,
         dic.total_discrepancy as inv_total_discrepancy
       FROM cash_register_sessions cs
       JOIN users u ON u.id = cs.user_id
       LEFT JOIN daily_inventory_checks dic ON dic.session_id = cs.id
       ${where}
       ORDER BY cs.opened_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT cs.*, u.first_name, u.last_name,
         dic.total_replenished as inv_total_replenished,
         dic.total_sold as inv_total_sold,
         dic.total_remaining as inv_total_remaining,
         dic.total_discrepancy as inv_total_discrepancy
       FROM cash_register_sessions cs
       JOIN users u ON u.id = cs.user_id
       LEFT JOIN daily_inventory_checks dic ON dic.session_id = cs.id
       WHERE cs.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async getInventoryItems(sessionId: string) {
    const result = await db.query(
      `SELECT dici.product_name, dici.replenished_qty, dici.sold_qty, dici.remaining_qty, dici.discrepancy
       FROM daily_inventory_check_items dici
       JOIN daily_inventory_checks dic ON dic.id = dici.check_id
       WHERE dic.session_id = $1
       ORDER BY dici.product_name`,
      [sessionId]
    );
    return result.rows;
  },

  async open(userId: string, openingAmount: number, storeId?: string) {
    const result = await db.query(
      `INSERT INTO cash_register_sessions (user_id, opening_amount, store_id) VALUES ($1, $2, $3) RETURNING *`,
      [userId, openingAmount, storeId || null]
    );
    return result.rows[0];
  },

  async close(sessionId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Calculate sales stats for this session
      const statsResult = await client.query(
        `SELECT
          COUNT(*) as total_sales,
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'mobile' THEN total ELSE 0 END), 0) as mobile_revenue
        FROM sales WHERE session_id = $1`,
        [sessionId]
      );

      // Calculate refunds for this session (cash given back to customers)
      const refundsResult = await client.query(
        `SELECT COALESCE(SUM(refund_amount), 0) as total_refunds
         FROM sale_returns
         WHERE session_id = $1 AND type = 'return'`,
        [sessionId]
      );

      // Calculate order advances for this session
      const advancesResult = await client.query(
        `SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(advance_amount), 0) as total_advances
        FROM orders WHERE session_id = $1 AND advance_amount > 0`,
        [sessionId]
      );

      const stats = statsResult.rows[0];
      const advances = advancesResult.rows[0];
      const totalRefunds = parseFloat(refundsResult.rows[0].total_refunds);
      const session = await client.query(`SELECT opening_amount FROM cash_register_sessions WHERE id = $1`, [sessionId]);
      const openingAmount = parseFloat(session.rows[0].opening_amount);
      const totalAdvances = parseFloat(advances.total_advances);

      const grossCashRevenue = parseFloat(stats.cash_revenue);
      const netCashRevenue = grossCashRevenue - totalRefunds; // refunds are always cash
      const netTotalRevenue = parseFloat(stats.total_revenue) - totalRefunds;

      // Expected cash = opening + net cash sales + advances (advances are always cash)
      const expectedCash = openingAmount + netCashRevenue + totalAdvances;

      await client.query(
        `UPDATE cash_register_sessions SET
          total_sales = $1, total_revenue = $2,
          cash_revenue = $3, card_revenue = $4, mobile_revenue = $5,
          expected_cash = $6, total_advances = $7, total_orders = $8
        WHERE id = $9`,
        [parseInt(stats.total_sales), netTotalRevenue,
         netCashRevenue, parseFloat(stats.card_revenue), parseFloat(stats.mobile_revenue),
         expectedCash, totalAdvances, parseInt(advances.total_orders), sessionId]
      );

      await client.query('COMMIT');

      // Return updated session (expected_cash calculated but not yet shown to user)
      return this.findById(sessionId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async submitActualAmount(sessionId: string, actualAmount: number, notes?: string) {
    const session = await this.findById(sessionId);
    if (!session) return null;

    const expectedCash = parseFloat(session.expected_cash);
    const difference = actualAmount - expectedCash;

    const result = await db.query(
      `UPDATE cash_register_sessions SET
        actual_amount = $1, difference = $2, notes = $3,
        status = 'closed', closed_at = NOW()
      WHERE id = $4 RETURNING *`,
      [actualAmount, difference, notes || null, sessionId]
    );

    return result.rows[0];
  },
};
