import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';

export const reportsController = {
  async dashboard(_req: AuthRequest, res: Response) {
    const today = await db.query(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_order_value
      FROM orders
      WHERE created_at::date = CURRENT_DATE AND status != 'cancelled'
    `);

    const totalItems = await db.query(`
      SELECT COALESCE(SUM(oi.quantity), 0) as total_items
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at::date = CURRENT_DATE AND o.status != 'cancelled'
    `);

    const topProducts = await db.query(`
      SELECT p.id, p.name, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue
      FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= CURRENT_DATE - INTERVAL '7 days' AND o.status != 'cancelled'
      GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5
    `);

    const lowStock = await db.query(`
      SELECT COUNT(*) as count FROM inventory WHERE current_quantity <= minimum_threshold
    `);

    res.json({
      success: true,
      data: {
        todayOrders: parseInt(today.rows[0].total_orders),
        todayRevenue: parseFloat(today.rows[0].total_revenue),
        avgOrderValue: parseFloat(today.rows[0].avg_order_value),
        todayItemsSold: parseInt(totalItems.rows[0].total_items),
        topProducts: topProducts.rows,
        lowStockCount: parseInt(lowStock.rows[0].count),
      },
    });
  },

  async sales(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const result = await db.query(`
      SELECT created_at::date as date, COUNT(*) as orders, SUM(total) as revenue
      FROM orders WHERE created_at::date BETWEEN $1 AND $2 AND status != 'cancelled'
      GROUP BY created_at::date ORDER BY date
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },

  async productPerformance(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const result = await db.query(`
      SELECT p.id, p.name, c.name as category, SUM(oi.quantity) as total_sold,
             SUM(oi.subtotal) as total_revenue
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status != 'cancelled'
      GROUP BY p.id, p.name, c.name ORDER BY total_sold DESC
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },
};
