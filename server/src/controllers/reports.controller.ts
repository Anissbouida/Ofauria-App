import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { getUserTimezone } from '../utils/timezone.js';

export const reportsController = {
  async dashboard(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    const storeFilter = storeId ? ' AND store_id = $1' : '';
    const storeValues = storeId ? [storeId] : [];
    const tz = getUserTimezone();

    // Sales stats (daily POS)
    const todaySales = await db.query(`
      SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_revenue,
             COALESCE(AVG(total), 0) as avg_sale_value
      FROM sales WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    const totalItems = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) as total_items
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE (s.created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter.replace('store_id', 's.store_id')}
    `, storeValues);

    // Today's refunds (returns only, not exchanges)
    const todayRefunds = await db.query(`
      SELECT COALESCE(SUM(refund_amount), 0) as total_refunds
      FROM sale_returns WHERE type = 'return' AND (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    // Top products from sales (last 7 days) - subtract returned quantities
    const topProducts = await db.query(`
      SELECT p.id, p.name,
             SUM(si.quantity) - COALESCE((
               SELECT SUM(sri.quantity) FROM sale_return_items sri
               JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sri.product_id = p.id AND sr.type = 'return'
               AND sr.created_at >= (NOW() AT TIME ZONE '${tz}')::date - INTERVAL '7 days'
             ), 0) as total_sold,
             SUM(si.subtotal) - COALESCE((
               SELECT SUM(sri.subtotal) FROM sale_return_items sri
               JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sri.product_id = p.id AND sr.type = 'return'
               AND sr.created_at >= (NOW() AT TIME ZONE '${tz}')::date - INTERVAL '7 days'
             ), 0) as total_revenue
      FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= (NOW() AT TIME ZONE '${tz}')::date - INTERVAL '7 days'
      GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5
    `);

    // Pending orders count
    const pendingOrders = await db.query(`
      SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')${storeFilter.replace('store_id', 'store_id')}
    `, storeValues);

    const lowStock = await db.query(`
      SELECT COUNT(*) as count FROM inventory WHERE current_quantity <= minimum_threshold${storeFilter}
    `, storeValues);

    const grossRevenue = parseFloat(todaySales.rows[0].total_revenue);
    const totalRefunds = parseFloat(todayRefunds.rows[0].total_refunds);

    res.json({
      success: true,
      data: {
        todaySales: parseInt(todaySales.rows[0].total_sales),
        todayRevenue: grossRevenue - totalRefunds,
        todayRefunds: totalRefunds,
        avgSaleValue: parseFloat(todaySales.rows[0].avg_sale_value),
        todayItemsSold: parseInt(totalItems.rows[0].total_items),
        topProducts: topProducts.rows,
        pendingOrders: parseInt(pendingOrders.rows[0].count),
        lowStockCount: parseInt(lowStock.rows[0].count),
      },
    });
  },

  async sales(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const tz = getUserTimezone();
    const result = await db.query(`
      SELECT s.date, s.sales_count, s.revenue - COALESCE(r.refunds, 0) as revenue
      FROM (
        SELECT (created_at AT TIME ZONE '${tz}')::date as date, COUNT(*) as sales_count, SUM(total) as revenue
        FROM sales WHERE (created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
        GROUP BY (created_at AT TIME ZONE '${tz}')::date
      ) s
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE '${tz}')::date as date, SUM(refund_amount) as refunds
        FROM sale_returns WHERE type = 'return' AND (created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
        GROUP BY (created_at AT TIME ZONE '${tz}')::date
      ) r ON r.date = s.date
      ORDER BY s.date
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },

  async productPerformance(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const tz = getUserTimezone();
    const result = await db.query(`
      SELECT p.id, p.name, c.name as category,
             SUM(si.quantity) - COALESCE((
               SELECT SUM(sri.quantity) FROM sale_return_items sri
               JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sri.product_id = p.id AND sr.type = 'return'
               AND (sr.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
             ), 0) as total_sold,
             SUM(si.subtotal) - COALESCE((
               SELECT SUM(sri.subtotal) FROM sale_return_items sri
               JOIN sale_returns sr ON sr.id = sri.return_id
               WHERE sri.product_id = p.id AND sr.type = 'return'
               AND (sr.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
             ), 0) as total_revenue
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN sales s ON s.id = si.sale_id
      WHERE (s.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, c.name ORDER BY total_sold DESC
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },
};
