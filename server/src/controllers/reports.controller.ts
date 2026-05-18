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

    // Today's losses
    const todayLosses = await db.query(`
      SELECT COUNT(*) as loss_count,
             COALESCE(SUM(quantity), 0) as loss_quantity,
             COALESCE(SUM(total_cost), 0) as loss_cost
      FROM product_losses
      WHERE (created_at AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date${storeFilter}
    `, storeValues);

    // Monthly losses (current month)
    const monthlyLosses = await db.query(`
      SELECT COALESCE(SUM(total_cost), 0) as monthly_loss_cost,
             COALESCE(SUM(quantity), 0) as monthly_loss_quantity
      FROM product_losses
      WHERE EXTRACT(MONTH FROM created_at AT TIME ZONE '${tz}') = EXTRACT(MONTH FROM NOW() AT TIME ZONE '${tz}')
        AND EXTRACT(YEAR FROM created_at AT TIME ZONE '${tz}') = EXTRACT(YEAR FROM NOW() AT TIME ZONE '${tz}')
        ${storeFilter}
    `, storeValues);

    // Top loss products (last 7 days)
    const topLossProducts = await db.query(`
      SELECT p.id, p.name, SUM(pl.quantity) as total_lost, SUM(pl.total_cost) as total_cost,
             pl.loss_type, COUNT(*) as loss_count
      FROM product_losses pl
      JOIN products p ON p.id = pl.product_id
      WHERE pl.created_at >= (NOW() AT TIME ZONE '${tz}')::date - INTERVAL '7 days'
        ${storeFilter.replace('store_id', 'pl.store_id')}
      GROUP BY p.id, p.name, pl.loss_type
      ORDER BY total_cost DESC LIMIT 5
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
        todayLossCount: parseInt(todayLosses.rows[0].loss_count),
        todayLossCost: parseFloat(todayLosses.rows[0].loss_cost),
        todayLossQuantity: parseFloat(todayLosses.rows[0].loss_quantity),
        monthlyLossCost: parseFloat(monthlyLosses.rows[0].monthly_loss_cost),
        monthlyLossQuantity: parseFloat(monthlyLosses.rows[0].monthly_loss_quantity),
        topLossProducts: topLossProducts.rows,
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

  // Prime Cost = Food Cost + Labor Cost. Cibles: Food 25-30%, Labor <30%, Prime <60%.
  async costSummary(req: AuthRequest, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;
    const storeId = req.user!.storeId;
    const tz = getUserTimezone();
    const from = startDate || '2024-01-01';
    const to = endDate || new Date().toISOString().slice(0, 10);

    const salesStoreFilter = storeId ? ' AND s.store_id = $3' : '';
    const params: (string | undefined)[] = [from, to];
    if (storeId) params.push(storeId);

    // Net sales (subtract returns)
    const salesRow = await db.query(`
      SELECT
        COALESCE(SUM(s.total), 0) - COALESCE((
          SELECT SUM(sr.refund_amount) FROM sale_returns sr
          WHERE sr.type = 'return'
            AND (sr.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
            ${storeId ? ' AND sr.store_id = $3' : ''}
        ), 0) AS net_sales
      FROM sales s
      WHERE (s.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
        ${salesStoreFilter}
    `, params);

    // Per-product breakdown matched to sales: matiere cost = qty_vendue x unit_cost
    // (unit_cost depuis production_cout_reel alloue prorata, fallback recette puis cost_price).
    // Labor/energie/pertes restent globaux (non per-produit) car production-wide.
    const planStoreFilter = storeId ? ' AND pp.store_id = $3' : '';
    const breakdownRow = await db.query(`
      WITH plan_totals AS (
        SELECT ppi.plan_id, SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS total_qty
        FROM production_plan_items ppi
        GROUP BY ppi.plan_id
      ),
      production_unit_cost AS (
        SELECT
          ppi.product_id,
          SUM(pcr.cout_matieres * (COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric
              / NULLIF(pt.total_qty, 0))) AS allocated_cost,
          SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS produced_qty
        FROM production_plans pp
        JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
        JOIN production_plan_items ppi ON ppi.plan_id = pp.id
        JOIN plan_totals pt ON pt.plan_id = pp.id
        WHERE pp.status = 'completed'
          AND pp.completed_at IS NOT NULL
          AND (pp.completed_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${planStoreFilter}
        GROUP BY ppi.product_id
      ),
      recipe_live_cost AS (
        SELECT rec.product_id,
               SUM(CASE WHEN ri.unit = 'g' AND ing.unit = 'kg' THEN (ri.quantity / 1000.0) * ing.unit_cost
                        ELSE ri.quantity * ing.unit_cost END
               ) / NULLIF(rec.yield_quantity, 0) AS unit_cost
        FROM recipes rec
        JOIN recipe_ingredients ri ON ri.recipe_id = rec.id
        JOIN ingredients ing ON ing.id = ri.ingredient_id
        GROUP BY rec.id, rec.product_id, rec.yield_quantity
      ),
      sold AS (
        SELECT p.id AS product_id, p.name, c.name AS category,
               SUM(si.quantity) AS qty_sold,
               SUM(si.subtotal) AS revenue,
               COALESCE(puc.allocated_cost / NULLIF(puc.produced_qty, 0), rlc.unit_cost, p.cost_price, 0) AS unit_food_cost,
               (puc.allocated_cost IS NOT NULL) AS cost_from_production,
               (puc.allocated_cost IS NULL AND rlc.unit_cost IS NOT NULL) AS cost_from_recipe,
               (puc.allocated_cost IS NOT NULL OR rlc.unit_cost IS NOT NULL OR p.cost_price IS NOT NULL) AS has_cost_data
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN production_unit_cost puc ON puc.product_id = p.id
        LEFT JOIN recipe_live_cost rlc ON rlc.product_id = p.id
        WHERE (s.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${salesStoreFilter}
        GROUP BY p.id, p.name, c.name, puc.allocated_cost, puc.produced_qty, rlc.unit_cost, p.cost_price
      ),
      returned AS (
        SELECT sri.product_id,
               SUM(sri.quantity) AS qty_returned,
               SUM(sri.subtotal) AS revenue_returned
        FROM sale_return_items sri
        JOIN sale_returns sr ON sr.id = sri.return_id
        WHERE sr.type = 'return'
          AND (sr.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${storeId ? ' AND sr.store_id = $3' : ''}
        GROUP BY sri.product_id
      )
      SELECT
        sold.product_id, sold.name, sold.category,
        (sold.qty_sold - COALESCE(returned.qty_returned, 0)) AS qty_sold,
        (sold.revenue - COALESCE(returned.revenue_returned, 0)) AS revenue,
        sold.unit_food_cost,
        (sold.qty_sold - COALESCE(returned.qty_returned, 0)) * sold.unit_food_cost AS food_cost,
        sold.cost_from_production, sold.cost_from_recipe, sold.has_cost_data
      FROM sold
      LEFT JOIN returned ON returned.product_id = sold.product_id
      ORDER BY (sold.revenue - COALESCE(returned.revenue_returned, 0)) DESC NULLS LAST
    `, params);

    // Labor + energie + pertes globaux depuis production_cout_reel (period-wide).
    const globalCostsRow = await db.query(`
      SELECT
        COALESCE(SUM(pcr.cout_main_oeuvre), 0) AS labor_cost,
        COALESCE(SUM(pcr.cout_energie), 0) AS energy_cost,
        COALESCE(SUM(pcr.cout_pertes), 0) AS losses_cost
      FROM production_plans pp
      JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
      WHERE pp.status = 'completed'
        AND pp.completed_at IS NOT NULL
        AND (pp.completed_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
        ${planStoreFilter}
    `, params);

    const planCoverageRow = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE pp.status = 'completed') AS plans_completed,
        COUNT(*) FILTER (WHERE pp.status = 'completed' AND pcr.id IS NOT NULL) AS plans_with_cost
      FROM production_plans pp
      LEFT JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
      WHERE pp.completed_at IS NOT NULL
        AND (pp.completed_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
        ${planStoreFilter}
    `, params);

    const breakdown = breakdownRow.rows;
    const netSales = parseFloat(salesRow.rows[0].net_sales) || 0;
    const foodCost = breakdown.reduce((s, r) => s + (parseFloat(r.food_cost) || 0), 0);
    const laborCost = parseFloat(globalCostsRow.rows[0].labor_cost) || 0;
    const energyCost = parseFloat(globalCostsRow.rows[0].energy_cost) || 0;
    const lossesCost = parseFloat(globalCostsRow.rows[0].losses_cost) || 0;
    const primeCost = foodCost + laborCost;
    const totalCost = primeCost + energyCost + lossesCost;

    const pct = (n: number) => (netSales > 0 ? (n / netSales) * 100 : 0);

    res.json({
      success: true,
      data: {
        period: { from, to },
        netSales,
        foodCost,
        laborCost,
        energyCost,
        lossesCost,
        primeCost,
        totalCost,
        foodCostPct: pct(foodCost),
        laborCostPct: pct(laborCost),
        energyCostPct: pct(energyCost),
        lossesCostPct: pct(lossesCost),
        primeCostPct: pct(primeCost),
        totalCostPct: pct(totalCost),
        breakdown,
        coverage: {
          plansCompleted: parseInt(planCoverageRow.rows[0].plans_completed) || 0,
          plansWithCost: parseInt(planCoverageRow.rows[0].plans_with_cost) || 0,
        },
        targets: {
          foodCostPctMin: 25,
          foodCostPctMax: 30,
          laborCostPctMax: 30,
          primeCostPctMax: 60,
        },
      },
    });
  },

  // Menu Engineering Matrix: classify each product by quantity sold (median) x contribution margin (median).
  // STAR = high qty + high contribution, PUZZLE = low qty + high contribution,
  // HORSE = high qty + low contribution, DOG = low qty + low contribution.
  async menuEngineering(req: AuthRequest, res: Response) {
    const { startDate, endDate, categoryId } = req.query as Record<string, string>;
    const storeId = req.user!.storeId;
    const tz = getUserTimezone();
    const from = startDate || '2024-01-01';
    const to = endDate || new Date().toISOString().slice(0, 10);

    const params: (string | undefined)[] = [from, to];
    let salesStoreFilter = '';
    let returnStoreFilter = '';
    let categoryFilter = '';
    if (storeId) {
      params.push(storeId);
      salesStoreFilter = ` AND s.store_id = $${params.length}`;
      returnStoreFilter = ` AND sr.store_id = $${params.length}`;
    }
    if (categoryId) {
      params.push(categoryId);
      categoryFilter = ` AND p.category_id = $${params.length}`;
    }

    // Plan-allocated real unit cost (cost_matieres only — labor/energy/losses stay at global level).
    // For each completed plan in period: cout_matieres is split across its items proportionally to
    // actual_quantity (fallback planned_quantity). Then per product: average unit cost.
    // Plan filter follows same store as sales (uses same param slot as salesStoreFilter / categoryFilter).
    const planStoreFilter = storeId ? ` AND pp.store_id = $${storeId ? params.indexOf(storeId) + 1 : 0}` : '';

    const result = await db.query(`
      WITH plan_totals AS (
        SELECT ppi.plan_id,
               SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS total_qty
        FROM production_plan_items ppi
        GROUP BY ppi.plan_id
      ),
      production_unit_cost AS (
        -- For each product produced in completed plans during the period:
        -- allocated_cost = SUM over plans of plan.cout_matieres * (product_qty / total_plan_qty)
        -- unit_cost = allocated_cost / total_produced_qty
        SELECT
          ppi.product_id,
          SUM(
            pcr.cout_matieres
            * (COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric / NULLIF(pt.total_qty, 0))
          ) AS allocated_cost,
          SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS produced_qty
        FROM production_plans pp
        JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
        JOIN production_plan_items ppi ON ppi.plan_id = pp.id
        JOIN plan_totals pt ON pt.plan_id = pp.id
        WHERE pp.status = 'completed'
          AND pp.completed_at IS NOT NULL
          AND (pp.completed_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${planStoreFilter}
        GROUP BY ppi.product_id
      ),
      recipe_live_cost AS (
        -- Fallback theorique (utilise seulement si production_cout_reel n'a pas de donnees pour ce produit).
        SELECT rec.product_id,
               SUM(CASE WHEN ri.unit = 'g' AND ing.unit = 'kg' THEN (ri.quantity / 1000.0) * ing.unit_cost
                        ELSE ri.quantity * ing.unit_cost END
               ) / NULLIF(rec.yield_quantity, 0) AS unit_cost
        FROM recipes rec
        JOIN recipe_ingredients ri ON ri.recipe_id = rec.id
        JOIN ingredients ing ON ing.id = ri.ingredient_id
        GROUP BY rec.id, rec.product_id, rec.yield_quantity
      ),
      sold AS (
        SELECT
          p.id AS product_id,
          p.name,
          c.name AS category,
          SUM(si.quantity) AS qty_sold,
          SUM(si.subtotal) AS revenue,
          COALESCE(
            puc.allocated_cost / NULLIF(puc.produced_qty, 0),  -- 1) prod reel
            rlc.unit_cost,                                      -- 2) recette theorique
            p.cost_price,                                       -- 3) cout manuel
            0                                                   -- 4) inconnu
          ) AS unit_food_cost,
          (puc.allocated_cost IS NOT NULL OR rlc.unit_cost IS NOT NULL OR p.cost_price IS NOT NULL) AS has_cost_data,
          (puc.allocated_cost IS NOT NULL) AS cost_from_production,
          (puc.allocated_cost IS NULL AND rlc.unit_cost IS NOT NULL) AS cost_from_recipe
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN production_unit_cost puc ON puc.product_id = p.id
        LEFT JOIN recipe_live_cost rlc ON rlc.product_id = p.id
        WHERE (s.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${salesStoreFilter}
          ${categoryFilter}
        GROUP BY p.id, p.name, c.name, puc.allocated_cost, puc.produced_qty, rlc.unit_cost, p.cost_price
      ),
      returned AS (
        SELECT
          sri.product_id,
          SUM(sri.quantity) AS qty_returned,
          SUM(sri.subtotal) AS revenue_returned
        FROM sale_return_items sri
        JOIN sale_returns sr ON sr.id = sri.return_id
        WHERE sr.type = 'return'
          AND (sr.created_at AT TIME ZONE '${tz}')::date BETWEEN $1 AND $2
          ${returnStoreFilter}
        GROUP BY sri.product_id
      ),
      net AS (
        SELECT
          sold.product_id,
          sold.name,
          sold.category,
          (sold.qty_sold - COALESCE(returned.qty_returned, 0)) AS qty_sold,
          (sold.revenue - COALESCE(returned.revenue_returned, 0)) AS revenue,
          sold.unit_food_cost,
          sold.has_cost_data,
          sold.cost_from_production,
          sold.cost_from_recipe,
          (sold.qty_sold - COALESCE(returned.qty_returned, 0)) * sold.unit_food_cost AS total_food_cost,
          (sold.revenue - COALESCE(returned.revenue_returned, 0))
            - (sold.qty_sold - COALESCE(returned.qty_returned, 0)) * sold.unit_food_cost AS total_contribution
        FROM sold
        LEFT JOIN returned ON returned.product_id = sold.product_id
      ),
      medians AS (
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qty_sold) AS median_qty,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_contribution) AS median_contribution
        FROM net
        WHERE qty_sold > 0
      )
      SELECT
        n.product_id,
        n.name,
        n.category,
        n.qty_sold,
        n.revenue,
        n.unit_food_cost,
        n.has_cost_data,
        n.cost_from_production,
        n.cost_from_recipe,
        n.total_food_cost,
        n.total_contribution,
        CASE WHEN n.revenue > 0 THEN (n.total_food_cost / n.revenue) * 100 ELSE 0 END AS food_cost_pct,
        CASE WHEN n.qty_sold > 0 THEN (n.revenue / n.qty_sold) - n.unit_food_cost ELSE 0 END AS unit_margin,
        m.median_qty,
        m.median_contribution,
        CASE
          WHEN n.qty_sold <= 0 THEN 'DOG'
          WHEN n.qty_sold >= m.median_qty AND n.total_contribution >= m.median_contribution THEN 'STAR'
          WHEN n.qty_sold <  m.median_qty AND n.total_contribution >= m.median_contribution THEN 'PUZZLE'
          WHEN n.qty_sold >= m.median_qty AND n.total_contribution <  m.median_contribution THEN 'HORSE'
          ELSE 'DOG'
        END AS classification
      FROM net n
      CROSS JOIN medians m
      ORDER BY n.total_contribution DESC NULLS LAST
    `, params);

    const items = result.rows;
    const counts = { STAR: 0, PUZZLE: 0, HORSE: 0, DOG: 0 } as Record<string, number>;
    const costSources = { production: 0, recipe: 0, manual: 0, missing: 0 };
    for (const r of items) {
      counts[r.classification] = (counts[r.classification] || 0) + 1;
      if (r.cost_from_production) costSources.production += 1;
      else if (r.cost_from_recipe) costSources.recipe += 1;
      else if (r.has_cost_data) costSources.manual += 1;
      else costSources.missing += 1;
    }

    res.json({
      success: true,
      data: {
        period: { from, to },
        items,
        thresholds: {
          medianQty: items.length > 0 ? parseFloat(items[0].median_qty) || 0 : 0,
          medianContribution: items.length > 0 ? parseFloat(items[0].median_contribution) || 0 : 0,
        },
        counts,
        costSources,
        missingCostCount: costSources.missing,
      },
    });
  },
};
