import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';

export const reportsController = {
  async dashboard(_req: AuthRequest, res: Response) {
    // Sales stats (daily POS)
    const todaySales = await db.query(`
      SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_revenue,
             COALESCE(AVG(total), 0) as avg_sale_value
      FROM sales WHERE created_at::date = CURRENT_DATE
    `);

    const totalItems = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) as total_items
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at::date = CURRENT_DATE
    `);

    // Top products from sales (last 7 days)
    const topProducts = await db.query(`
      SELECT p.id, p.name, SUM(si.quantity) as total_sold, SUM(si.subtotal) as total_revenue
      FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5
    `);

    // Pending orders count
    const pendingOrders = await db.query(`
      SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
    `);

    const lowStock = await db.query(`
      SELECT COUNT(*) as count FROM inventory WHERE current_quantity <= minimum_threshold
    `);

    res.json({
      success: true,
      data: {
        todaySales: parseInt(todaySales.rows[0].total_sales),
        todayRevenue: parseFloat(todaySales.rows[0].total_revenue),
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
    const result = await db.query(`
      SELECT created_at::date as date, COUNT(*) as sales_count, SUM(total) as revenue
      FROM sales WHERE created_at::date BETWEEN $1 AND $2
      GROUP BY created_at::date ORDER BY date
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },

  async productPerformance(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const result = await db.query(`
      SELECT p.id, p.name, c.name as category, SUM(si.quantity) as total_sold,
             SUM(si.subtotal) as total_revenue
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at::date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, c.name ORDER BY total_sold DESC
    `, [startDate || '2024-01-01', endDate || 'now']);

    res.json({ success: true, data: result.rows });
  },
};
