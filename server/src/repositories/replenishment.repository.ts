import { db } from '../config/database.js';
import { getCategoryRole } from '@ofauria/shared';
import { getUserTimezone } from '../utils/timezone.js';

export const replenishmentRepository = {

  async generateRequestNumber(): Promise<string> {
    const tz = getUserTimezone();
    // Use the SAME timezone for both the date string and the COUNT query
    const dateResult = await db.query(`SELECT to_char(NOW() AT TIME ZONE '${tz}', 'YYYYMMDD') as today`);
    const today = dateResult.rows[0].today;
    const result = await db.query(
      `SELECT COUNT(DISTINCT batch_id) FROM replenishment_requests WHERE DATE(created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}') AND batch_id IS NOT NULL`
    );
    const num = parseInt(result.rows[0].count, 10) + 1;
    return `DRA-${today}-${String(num).padStart(3, '0')}`;
  },

  /* ─── LIST ─── */

  async findAll(params: {
    status?: string;
    storeId?: string;
    dateFrom?: string;
    dateTo?: string;
    userRole?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`r.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status) { conditions.push(`r.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`r.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`r.created_at <= $${i++}`); values.push(params.dateTo + ' 23:59:59'); }

    // Role-based filtering
    const chefRoles = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];
    if (params.userRole && chefRoles.includes(params.userRole)) {
      // Chefs see only their own requests
      conditions.push(`r.assigned_role = $${i++}`);
      values.push(params.userRole);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM replenishment_requests r ${where}`, values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const limit = params.limit || 20;
    const offset = params.offset || 0;
    values.push(limit, offset);

    const result = await db.query(
      `SELECT r.*,
        u.first_name || ' ' || u.last_name as requested_by_name,
        au.first_name || ' ' || au.last_name as acknowledged_by_name,
        tu.first_name || ' ' || tu.last_name as transferred_by_name,
        (SELECT COUNT(*) FROM replenishment_request_items WHERE request_id = r.id) as item_count,
        (SELECT COUNT(*) FROM replenishment_request_items WHERE request_id = r.id AND status IN ('received', 'received_with_discrepancy')) as completed_count,
        CASE
          WHEN r.status = 'acknowledged'
            AND (SELECT COUNT(*) FROM replenishment_request_items WHERE request_id = r.id AND status IN ('received', 'received_with_discrepancy')) > 0
          THEN 'partially_delivered'
          ELSE r.status
        END as display_status
      FROM replenishment_requests r
      LEFT JOIN users u ON u.id = r.requested_by
      LEFT JOIN users au ON au.id = r.acknowledged_by
      LEFT JOIN users tu ON tu.id = r.transferred_by
      ${where}
      ORDER BY
        CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        r.created_at DESC
      LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  /* ─── FIND BY ID ─── */

  async findById(id: string) {
    const result = await db.query(
      `SELECT r.*,
        u.first_name || ' ' || u.last_name as requested_by_name,
        au.first_name || ' ' || au.last_name as acknowledged_by_name,
        tu.first_name || ' ' || tu.last_name as transferred_by_name,
        cu.first_name || ' ' || cu.last_name as closed_by_name
      FROM replenishment_requests r
      LEFT JOIN users u ON u.id = r.requested_by
      LEFT JOIN users au ON au.id = r.acknowledged_by
      LEFT JOIN users tu ON tu.id = r.transferred_by
      LEFT JOIN users cu ON cu.id = r.closed_by
      WHERE r.id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;

    const request = result.rows[0];

    // Get request items
    const items = await db.query(
      `SELECT ri.*,
        p.name as product_name,
        p.image_url as product_image,
        p.stock_quantity as global_stock,
        c.name as category_name,
        c.slug as category_slug,
        COALESCE(pss.stock_quantity, 0) as store_stock,
        pp.status as production_status,
        ppi_linked.status as production_item_status,
        ppi_linked.actual_quantity as production_actual_quantity
      FROM replenishment_request_items ri
      LEFT JOIN products p ON p.id = ri.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_store_stock pss ON pss.product_id = ri.product_id AND pss.store_id = $2
      LEFT JOIN production_plans pp ON pp.id = ri.production_plan_id
      LEFT JOIN production_plan_items ppi_linked ON ppi_linked.plan_id = pp.id AND ppi_linked.product_id = ri.product_id
      WHERE ri.request_id = $1
      ORDER BY c.name, p.name`,
      [id, request.store_id]
    );

    // Get linked production plans
    const linkedPlans = await db.query(
      `SELECT DISTINCT pp.id, pp.status, pp.target_role, pp.plan_date,
         (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count
       FROM production_plans pp
       JOIN replenishment_request_items ri ON ri.production_plan_id = pp.id
       WHERE ri.request_id = $1`,
      [id]
    );

    // Point 7: Compute display_status for partial delivery
    const receivedCount = items.rows.filter((i: Record<string, unknown>) =>
      i.status === 'received' || i.status === 'received_with_discrepancy'
    ).length;
    const displayStatus = request.status === 'acknowledged' && receivedCount > 0
      ? 'partially_delivered'
      : request.status;

    return { ...request, items: items.rows, production_plans: linkedPlans.rows, display_status: displayStatus };
  },

  /* ─── STEP 1: CREATE (separate request per role) ─── */

  async create(data: {
    storeId: string;
    requestedBy: string;
    priority?: string;
    neededBy?: string;
    notes?: string;
    items: { productId: string; requestedQuantity: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Resolve product categories
      const productIds = data.items.map(i => i.productId);
      const catResult = await client.query(
        `SELECT p.id as product_id, c.slug as category_slug
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ANY($1)`,
        [productIds]
      );

      const productCategoryMap: Record<string, string> = {};
      for (const row of catResult.rows) {
        productCategoryMap[row.product_id] = row.category_slug || 'unknown';
      }

      // Group items by chef role
      const roleGroups: Record<string, typeof data.items> = {};
      for (const item of data.items) {
        const slug = productCategoryMap[item.productId] || 'unknown';
        const role = getCategoryRole(slug);
        if (!roleGroups[role]) roleGroups[role] = [];
        roleGroups[role].push(item);
      }

      const ROLE_SUFFIXES: Record<string, string> = {
        baker: 'BOUL',
        pastry_chef: 'PAT',
        viennoiserie: 'VIEN',
        beldi_sale: 'BELD',
        general: 'GEN',
      };

      // Create one independent request per role, all sharing the same batch_id
      const requestIds: Record<string, string> = {};
      let firstRequest: Record<string, unknown> | null = null;

      // Generate a single batch_id for all requests in this submission
      const batchResult = await client.query(`SELECT gen_random_uuid() as batch_id`);
      const batchId = batchResult.rows[0].batch_id;

      // Generate a single base request number for this batch
      const requestNumber = await this.generateRequestNumber();

      for (const [role, items] of Object.entries(roleGroups)) {
        const suffix = ROLE_SUFFIXES[role] || role.toUpperCase().slice(0, 4);
        const fullNumber = `${requestNumber}-${suffix}`;

        const reqResult = await client.query(
          `INSERT INTO replenishment_requests (request_number, store_id, requested_by, status, priority, needed_by, notes, assigned_role, is_parent, parent_id, batch_id)
           VALUES ($1, $2, $3, 'submitted', $4, $5, $6, $7, false, NULL, $8) RETURNING *`,
          [fullNumber, data.storeId, data.requestedBy, data.priority || 'normal', data.neededBy || null, data.notes || null, role, batchId]
        );
        const req = reqResult.rows[0];
        requestIds[role] = req.id;
        if (!firstRequest) firstRequest = req;

        // Insert items with requested quantity only — stock check & production deferred to acknowledge
        for (const item of items) {
          await client.query(
            `INSERT INTO replenishment_request_items (request_id, product_id, requested_quantity, status)
             VALUES ($1, $2, $3, 'pending')`,
            [req.id, item.productId, item.requestedQuantity]
          );
        }
      }

      await client.query('COMMIT');

      return { ...firstRequest, _requestIds: requestIds, request_number: firstRequest?.request_number };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── STEP 2: Acknowledge (sub-request: submitted → acknowledged) ─── */
  /* Stock availability check & production plan creation happen here, not at submission */

  async acknowledge(requestId: string, acknowledgedBy: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Transition status
      const reqResult = await client.query(
        `UPDATE replenishment_requests
         SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND status = 'submitted'
         RETURNING *`,
        [acknowledgedBy, requestId]
      );
      if (!reqResult.rows[0]) throw new Error('Invalid state transition');
      const req = reqResult.rows[0];

      // 2. Fetch items for this request
      const itemsResult = await client.query(
        `SELECT id, product_id, requested_quantity FROM replenishment_request_items WHERE request_id = $1`,
        [requestId]
      );

      // 3. Stock availability check
      const productIds = itemsResult.rows.map((r: Record<string, unknown>) => r.product_id);
      const stockResult = await client.query(
        `SELECT product_id, COALESCE(stock_quantity, 0) as stock_quantity
         FROM product_store_stock
         WHERE product_id = ANY($1) AND store_id = $2`,
        [productIds, req.store_id]
      );
      const stockMap: Record<string, number> = {};
      for (const row of stockResult.rows) {
        stockMap[row.product_id] = Math.floor(parseFloat(row.stock_quantity));
      }

      // 4. Update each item with stock split info
      const productionNeeded: { productId: string; qty: number; itemId: string }[] = [];
      for (const item of itemsResult.rows) {
        const available = Math.max(stockMap[item.product_id] || 0, 0);
        const requested = parseInt(item.requested_quantity);
        const fromStock = Math.min(available, requested);
        const toProduce = requested - fromStock;
        const sourceType = toProduce === 0 ? 'stock' : fromStock === 0 ? 'production' : 'mixed';

        await client.query(
          `UPDATE replenishment_request_items
           SET source_type = $1, qty_from_stock = $2, qty_to_produce = $3
           WHERE id = $4`,
          [sourceType, fromStock, toProduce, item.id]
        );

        if (toProduce > 0) {
          productionNeeded.push({ productId: item.product_id, qty: toProduce, itemId: item.id });
        }
      }

      // 5. Create production plan if any items need production
      let productionPlanId: string | null = null;
      if (productionNeeded.length > 0) {
        const planResult = await client.query(
          `INSERT INTO production_plans (plan_date, type, notes, created_by, target_role, store_id, replenishment_request_id)
           VALUES (CURRENT_DATE, 'daily', $1, $2, $3, $4, $5) RETURNING id`,
          [`Auto — approvisionnement ${req.request_number}`, acknowledgedBy, req.assigned_role, req.store_id, requestId]
        );
        productionPlanId = planResult.rows[0].id;

        // Fetch min_production_quantity for products needing production
        const prodIds = productionNeeded.map(pi => pi.productId);
        const minQtyResult = await client.query(
          `SELECT id, COALESCE(min_production_quantity, 0) as min_production_quantity FROM products WHERE id = ANY($1)`,
          [prodIds]
        );
        const minQtyMap: Record<string, number> = {};
        for (const row of minQtyResult.rows) {
          minQtyMap[row.id] = parseInt(row.min_production_quantity) || 0;
        }

        for (const pi of productionNeeded) {
          const minQty = minQtyMap[pi.productId] || 0;
          const effectiveQty = Math.max(pi.qty, minQty);
          await client.query(
            `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity)
             VALUES ($1, $2, $3)`,
            [productionPlanId, pi.productId, effectiveQty]
          );
          await client.query(
            `UPDATE replenishment_request_items SET production_plan_id = $1 WHERE id = $2`,
            [productionPlanId, pi.itemId]
          );
        }
      }

      await client.query('COMMIT');

      const fullRequest = await this.findById(requestId);
      return { ...fullRequest, _productionPlanId: productionPlanId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── STEP 3: Start preparing (acknowledged → preparing) ─── */
  /* Partial preparation allowed: only items passed in body are prepared.
     Items with pending production can be skipped and prepared later. */

  async startPreparing(
    requestId: string,
    items: { itemId: string; qtyToStore: number; qtyToStock: number; source: string }[]
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const reqResult = await client.query(
        `UPDATE replenishment_requests
         SET status = 'preparing', preparing_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'acknowledged'
         RETURNING id`,
        [requestId]
      );
      if (!reqResult.rows[0]) throw new Error('Invalid state transition');

      let preparedCount = 0;
      for (const item of items) {
        // Guard: only prepare items that are pending AND whose production (if any) is done
        const itemCheck = await client.query(
          `SELECT ri.id, ri.source_type, ri.production_plan_id, ri.status,
                  ppi.status as prod_item_status,
                  pp.status as plan_status
           FROM replenishment_request_items ri
           LEFT JOIN production_plan_items ppi ON ppi.plan_id = ri.production_plan_id AND ppi.product_id = ri.product_id
           LEFT JOIN production_plans pp ON pp.id = ri.production_plan_id
           WHERE ri.id = $1 AND ri.request_id = $2`,
          [item.itemId, requestId]
        );
        if (!itemCheck.rows[0]) continue;
        const row = itemCheck.rows[0];
        // Skip if item is not pending
        if (row.status !== 'pending') continue;
        // Skip if item needs production and production item is not yet produced
        // Check: has production plan AND (item not produced AND plan not completed)
        if (row.production_plan_id) {
          const itemProduced = row.prod_item_status && ['produced', 'transferred', 'received'].includes(row.prod_item_status);
          const planCompleted = row.plan_status === 'completed';
          if (!itemProduced && !planCompleted) {
            continue;
          }
        }

        const result = await client.query(
          `UPDATE replenishment_request_items
           SET qty_to_store = $1, qty_to_stock = $2, source = $3, status = 'preparing'
           WHERE id = $4 AND request_id = $5 AND status = 'pending'
           RETURNING id`,
          [item.qtyToStore, item.qtyToStock, item.source, item.itemId, requestId]
        );
        if (result.rows[0]) preparedCount++;
      }

      // If no items were actually prepared, revert request status back to acknowledged
      if (preparedCount === 0) {
        await client.query(
          `UPDATE replenishment_requests SET status = 'acknowledged', updated_at = NOW() WHERE id = $1`,
          [requestId]
        );
      }

      await client.query('COMMIT');
      return this.findById(requestId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── STEP 4: Transfer (preparing → transferred or back to acknowledged) ─── */
  /* Partial transfer: only prepared items are marked 'ready'.
     If pending items remain, request goes back to 'acknowledged' after reception. */

  async transfer(requestId: string, transferredBy: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const reqResult = await client.query(
        `UPDATE replenishment_requests
         SET status = 'transferred', transferred_by = $1, transferred_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND status = 'preparing'
         RETURNING id`,
        [transferredBy, requestId]
      );
      if (!reqResult.rows[0]) throw new Error('Invalid state transition');

      // Only mark items that were prepared as 'ready' (not pending ones)
      await client.query(
        `UPDATE replenishment_request_items SET status = 'ready'
         WHERE request_id = $1 AND status = 'preparing'`,
        [requestId]
      );

      await client.query('COMMIT');
      return this.findById(requestId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── STEP 5: Confirm reception (transferred → closed or back to acknowledged) ─── */
  /* If all items received → closed. If pending items remain → back to acknowledged. */

  async confirmReception(
    requestId: string,
    closedBy: string,
    items: { itemId: string; qtyReceived: number; notes?: string }[]
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      let hasDiscrepancy = false;

      for (const item of items) {
        const itemResult = await client.query(
          `SELECT qty_to_store FROM replenishment_request_items WHERE id = $1 AND request_id = $2`,
          [item.itemId, requestId]
        );
        if (!itemResult.rows[0]) continue;

        const expected = parseInt(itemResult.rows[0].qty_to_store, 10) || 0;
        const received = item.qtyReceived;
        const itemHasDiscrepancy = received !== expected;
        if (itemHasDiscrepancy) hasDiscrepancy = true;

        await client.query(
          `UPDATE replenishment_request_items
           SET qty_received = $1, reception_notes = $2, status = $3
           WHERE id = $4 AND request_id = $5`,
          [received, item.notes || null, itemHasDiscrepancy ? 'received_with_discrepancy' : 'received', item.itemId, requestId]
        );
      }

      // Check if there are still pending items (not yet prepared/received)
      const pendingResult = await client.query(
        `SELECT COUNT(*) as cnt FROM replenishment_request_items
         WHERE request_id = $1 AND status = 'pending'`,
        [requestId]
      );
      const hasPendingItems = parseInt(pendingResult.rows[0].cnt) > 0;

      if (hasPendingItems) {
        // Partial reception: go back to acknowledged so chef can prepare remaining items
        await client.query(
          `UPDATE replenishment_requests
           SET status = 'acknowledged', updated_at = NOW()
           WHERE id = $1 AND status = 'transferred'`,
          [requestId]
        );
      } else {
        // All items received → close the request
        const finalStatus = hasDiscrepancy ? 'closed_with_discrepancy' : 'closed';
        await client.query(
          `UPDATE replenishment_requests
           SET status = $1, closed_by = $2, closed_at = NOW(), updated_at = NOW()
           WHERE id = $3 AND status = 'transferred'`,
          [finalStatus, closedBy, requestId]
        );
      }

      await client.query('COMMIT');
      return this.findById(requestId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── Cancel ─── */

  async cancel(requestId: string): Promise<{ cancelledPlanIds: { id: string; targetRole: string; storeId: string }[] }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Cancel the replenishment request
      await client.query(
        `UPDATE replenishment_requests SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('submitted', 'acknowledged')`,
        [requestId]
      );

      // 2. Find linked production plans (via replenishment_request_items or direct FK)
      const plansResult = await client.query(
        `SELECT DISTINCT pp.id, pp.status, pp.target_role, pp.store_id
         FROM production_plans pp
         WHERE pp.replenishment_request_id = $1
           AND pp.status != 'completed'`,
        [requestId]
      );

      const cancelledPlanIds: { id: string; targetRole: string; storeId: string }[] = [];

      for (const plan of plansResult.rows) {
        if (plan.status === 'draft') {
          // Draft plans: set to cancelled directly
          await client.query(
            `UPDATE production_plans
             SET status = 'cancelled', cancelled_at = NOW(),
                 cancellation_reason = 'Annulation cascade — demande d''approvisionnement annulee',
                 updated_at = NOW()
             WHERE id = $1`,
            [plan.id]
          );
        } else if (['confirmed', 'in_progress'].includes(plan.status)) {
          // Cancel all pending items
          await client.query(
            `UPDATE production_plan_items
             SET status = 'cancelled', waiting_status = NULL,
                 cancelled_at = NOW(),
                 cancellation_reason = 'Annulation cascade — demande d''approvisionnement annulee'
             WHERE plan_id = $1 AND status = 'pending'`,
            [plan.id]
          );

          // Set plan status to cancelled
          await client.query(
            `UPDATE production_plans
             SET status = 'cancelled', cancelled_at = NOW(),
                 cancellation_reason = 'Annulation cascade — demande d''approvisionnement annulee',
                 updated_at = NOW()
             WHERE id = $1`,
            [plan.id]
          );
        }

        cancelledPlanIds.push({
          id: plan.id,
          targetRole: plan.target_role,
          storeId: plan.store_id,
        });
      }

      await client.query('COMMIT');
      return { cancelledPlanIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── RULE 1: Get product IDs already requested today for this store ─── */

  async findTodayRequestedProductIds(storeId: string): Promise<string[]> {
    const result = await db.query(
      `SELECT DISTINCT ri.product_id
       FROM replenishment_request_items ri
       JOIN replenishment_requests rr ON rr.id = ri.request_id
       WHERE rr.store_id = $1
         AND DATE(rr.created_at AT TIME ZONE '${getUserTimezone()}') = DATE(NOW() AT TIME ZONE '${getUserTimezone()}')
         AND rr.status NOT IN ('cancelled', 'closed', 'closed_with_discrepancy')`,
      [storeId]
    );
    return result.rows.map((r: { product_id: string }) => r.product_id);
  },

  /** Returns detailed info per product already requested today: last request date + current store stock */
  async findTodayRequestedDetails(storeId: string): Promise<Array<{ product_id: string; last_requested_at: string; store_stock: number }>> {
    const tz = getUserTimezone();
    const result = await db.query(
      `SELECT ri.product_id,
              MAX(rr.created_at AT TIME ZONE '${tz}') as last_requested_at,
              COALESCE(pss.stock_quantity, 0)::int as store_stock
       FROM replenishment_request_items ri
       JOIN replenishment_requests rr ON rr.id = ri.request_id
       LEFT JOIN product_store_stock pss ON pss.product_id = ri.product_id AND pss.store_id = $1
       WHERE rr.store_id = $1
         AND DATE(rr.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}')
         AND rr.status NOT IN ('cancelled', 'closed', 'closed_with_discrepancy')
       GROUP BY ri.product_id, pss.stock_quantity`,
      [storeId]
    );
    return result.rows;
  },

  /* ─── RULE 2: Check unsold items ─── */

  async checkUnsoldItems(storeId: string, productIds: string[]) {
    if (productIds.length === 0) return [];
    const result = await db.query(`
      WITH last_delivery AS (
        SELECT DISTINCT ON (sd.product_id)
          sd.product_id,
          sd.quantity as delivered_qty,
          sd.created_at as delivered_at
        FROM stock_deliveries sd
        JOIN replenishment_requests rr ON rr.id = sd.request_id
        WHERE rr.store_id = $1
          AND sd.product_id = ANY($2)
        ORDER BY sd.product_id, sd.created_at DESC
      ),
      sales_since AS (
        SELECT si.product_id, COALESCE(SUM(si.quantity), 0) as sold_qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN last_delivery ld ON ld.product_id = si.product_id
        WHERE s.store_id = $1
          AND s.created_at >= ld.delivered_at
          AND si.product_id = ANY($2)
        GROUP BY si.product_id
      )
      SELECT ld.product_id, p.name as product_name,
             ld.delivered_qty, COALESCE(ss.sold_qty, 0) as sold_qty,
             ld.delivered_qty - COALESCE(ss.sold_qty, 0) as unsold_qty
      FROM last_delivery ld
      JOIN products p ON p.id = ld.product_id
      LEFT JOIN sales_since ss ON ss.product_id = ld.product_id
      WHERE ld.delivered_qty - COALESCE(ss.sold_qty, 0) > 0
    `, [storeId, productIds]);
    return result.rows;
  },

  /* ─── RULE 3: Get replenished items today ─── */

  async getReplenishedItemsToday(storeId: string, sessionOpenedAt?: string | null) {
    // Show all products that have stock in the store (i.e. currently in the display/vitrine)
    // This is more reliable than filtering by request date, since products may have been
    // transferred across date boundaries
    const result = await db.query(`
      SELECT
        pss.product_id,
        p.name as product_name,
        p.image_url as product_image,
        c.name as category_name,
        p.shelf_life_days,
        p.display_life_hours,
        p.is_reexposable,
        p.is_recyclable,
        p.recycle_ingredient_id,
        p.max_reexpositions,
        COALESCE(pss.stock_quantity, 0)::int as replenished_qty,
        COALESCE(
          (SELECT SUM(si.quantity)
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.store_id = $1
             AND DATE(s.created_at AT TIME ZONE '${getUserTimezone()}') = DATE(NOW() AT TIME ZONE '${getUserTimezone()}')
             AND si.product_id = pss.product_id),
          0
        ) as sold_qty,
        COALESCE(pdt.current_reexposition_count, 0) as reexposition_count,
        pdt.display_expires_at,
        pdt.produced_at,
        pdt.expires_at
      FROM product_store_stock pss
      JOIN products p ON p.id = pss.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT pdt2.current_reexposition_count, pdt2.display_expires_at, pdt2.produced_at, pdt2.expires_at
        FROM product_display_tracking pdt2
        WHERE pdt2.product_id = pss.product_id AND pdt2.store_id = $1 AND pdt2.status = 'active'
        ORDER BY pdt2.produced_at DESC LIMIT 1
      ) pdt ON true
      WHERE pss.store_id = $1
        AND COALESCE(pss.stock_quantity, 0) > 0
      ORDER BY c.name, p.name
    `, [storeId]);
    return result.rows;
  },

  /* ─── RULE 3: Save daily inventory check ─── */

  async saveInventoryCheck(data: {
    storeId: string;
    sessionId?: string;
    checkedBy: string;
    items: { productId: string; productName: string; replenishedQty: number; soldQty: number; remainingQty: number; destination?: string; displayStatus?: string; lossReason?: string }[];
    notes?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      let totalReplenished = 0, totalSold = 0, totalRemaining = 0, totalDiscrepancy = 0;
      for (const it of data.items) {
        totalReplenished += it.replenishedQty;
        totalSold += it.soldQty;
        totalRemaining += it.remainingQty;
        totalDiscrepancy += (it.replenishedQty - it.soldQty - it.remainingQty);
      }

      const checkResult = await client.query(`
        INSERT INTO daily_inventory_checks (store_id, session_id, checked_by, total_replenished, total_sold, total_remaining, total_discrepancy, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [data.storeId, data.sessionId || null, data.checkedBy, totalReplenished, totalSold, totalRemaining, totalDiscrepancy, data.notes || null]);

      const checkId = checkResult.rows[0].id;

      for (const it of data.items) {
        const discrepancy = it.replenishedQty - it.soldQty - it.remainingQty;
        const destination = it.destination || 'reexpose';

        // Get current reexposition count from tracking
        const trackResult = await client.query(
          `SELECT current_reexposition_count FROM product_display_tracking
           WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
          [it.productId, data.storeId]
        );
        const reexCount = trackResult.rows[0]?.current_reexposition_count || 0;

        await client.query(`
          INSERT INTO daily_inventory_check_items (check_id, product_id, product_name, replenished_qty, sold_qty, remaining_qty, discrepancy, destination, display_status, reexposition_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [checkId, it.productId, it.productName, it.replenishedQty, it.soldQty, it.remainingQty, discrepancy, destination, it.displayStatus || 'ok', reexCount]);

        // Apply destination effects on stock
        if (it.remainingQty > 0) {
          if (destination === 'recycle') {
            // Reduce product store stock
            await client.query(
              `UPDATE product_store_stock SET stock_quantity = GREATEST(0, stock_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [it.remainingQty, it.productId, data.storeId]
            );
            // Add to recycle ingredient stock if configured
            const recycleResult = await client.query(
              `SELECT recycle_ingredient_id FROM products WHERE id = $1`, [it.productId]
            );
            if (recycleResult.rows[0]?.recycle_ingredient_id) {
              const ingId = recycleResult.rows[0].recycle_ingredient_id;
              await client.query(
                `UPDATE inventory SET current_quantity = current_quantity + $1, updated_at = NOW()
                 WHERE ingredient_id = $2 AND store_id = $3`,
                [it.remainingQty, ingId, data.storeId]
              );
              await client.query(
                `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
                 VALUES ($1, 'recycle', $2, $3, $4, $5)`,
                [ingId, it.remainingQty, `Recyclage: ${it.productName} x${it.remainingQty}`, data.checkedBy, data.storeId]
              );
            }
            // Update tracking
            await client.query(
              `UPDATE product_display_tracking SET status = 'recycled', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [it.productId, data.storeId]
            );
          } else if (destination === 'waste') {
            // Reduce product store stock — perte
            await client.query(
              `UPDATE product_store_stock SET stock_quantity = GREATEST(0, stock_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [it.remainingQty, it.productId, data.storeId]
            );
            // Record waste transaction
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
              [it.productId, -it.remainingQty, `Perte fin de journee: ${it.productName} x${it.remainingQty}`, data.checkedBy, data.storeId]
            );
            // Record in product_losses for loss history
            const lossReason = it.lossReason || 'invendu_fin_journee';
            const lossType = lossReason === 'perime' ? 'perime' : 'vitrine';
            const costResult = await client.query(`SELECT cost_price FROM products WHERE id = $1`, [it.productId]);
            const unitCost = parseFloat(costResult.rows[0]?.cost_price) || 0;
            await client.query(
              `INSERT INTO product_losses (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost, ingredients_consumed, declared_by, store_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
              [it.productId, it.remainingQty, lossType, lossReason,
               `Inventaire fin de journee: ${it.productName} x${it.remainingQty}`,
               unitCost, unitCost * it.remainingQty, data.checkedBy, data.storeId]
            );
            // Update tracking
            await client.query(
              `UPDATE product_display_tracking SET status = 'wasted', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [it.productId, data.storeId]
            );
          } else if (destination === 'reexpose') {
            // Reexpose: increment reexposition counter, stock stays
            await client.query(
              `INSERT INTO product_display_tracking (product_id, store_id, current_reexposition_count, first_displayed_at, last_reexposed_at, status)
               VALUES ($1, $2, $3, NOW(), NOW(), 'active')
               ON CONFLICT (product_id, store_id, first_displayed_at) DO UPDATE
               SET current_reexposition_count = product_display_tracking.current_reexposition_count + 1,
                   last_reexposed_at = NOW(), updated_at = NOW()`,
              [it.productId, data.storeId, reexCount + 1]
            );
          }
        }
      }

      await client.query('COMMIT');
      return { id: checkId, totalReplenished, totalSold, totalRemaining, totalDiscrepancy };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── Pending transfers for cashier ─── */

  async findPendingTransfers(storeId: string) {
    const result = await db.query(
      `SELECT r.*,
        u.first_name || ' ' || u.last_name as requested_by_name,
        tu.first_name || ' ' || tu.last_name as transferred_by_name,
        (SELECT COUNT(*) FROM replenishment_request_items WHERE request_id = r.id) as item_count
      FROM replenishment_requests r
      LEFT JOIN users u ON u.id = r.requested_by
      LEFT JOIN users tu ON tu.id = r.transferred_by
      WHERE r.store_id = $1
        AND r.status = 'transferred'
      ORDER BY r.transferred_at ASC`,
      [storeId]
    );

    // For each sub-request, get its items
    const transfers = [];
    for (const row of result.rows) {
      const items = await db.query(
        `SELECT ri.*,
          p.name as product_name,
          p.image_url as product_image,
          c.name as category_name
        FROM replenishment_request_items ri
        LEFT JOIN products p ON p.id = ri.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ri.request_id = $1
        ORDER BY p.name`,
        [row.id]
      );
      transfers.push({ ...row, items: items.rows });
    }

    return transfers;
  },

  /**
   * Recommandations intelligentes basees sur l'historique du meme jour de la semaine.
   *
   * Le jour cible est le LENDEMAIN (la demande se fait le soir pour le jour suivant).
   * Cascade de recherche :
   *   1. Ventes du meme jour J-7   → reference_type = 'j7'
   *   2. Ventes du meme jour J-14  → reference_type = 'j14'
   *   3. Moyenne des 4 dernieres occurrences du meme jour → reference_type = 'avg4'
   *   4. Aucun historique → reference_type = 'none' (saisie manuelle)
   */
  async getRecommendations(storeId: string) {
    const tz = getUserTimezone();

    // Jour cible = lendemain (demande faite le soir pour le jour suivant)
    // DOW PostgreSQL : 0=dimanche, 1=lundi, ..., 6=samedi
    const targetDowResult = await db.query(
      `SELECT EXTRACT(DOW FROM (NOW() AT TIME ZONE '${tz}') + INTERVAL '1 day')::int as target_dow`
    );
    const targetDow = targetDowResult.rows[0].target_dow;

    const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const targetDayName = DAY_NAMES[targetDow];

    // Recuperer tous les produits disponibles avec stock
    const productsResult = await db.query(`
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.price,
        c.id as category_id,
        c.name as category_name,
        c.slug as category_slug,
        c.display_order,
        COALESCE(pss.stock_quantity, 0) as current_stock,
        p.stock_min_threshold
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_store_stock pss ON pss.product_id = p.id AND pss.store_id = $1
      WHERE p.is_available = true
      ORDER BY c.display_order, p.name
    `, [storeId]);

    if (productsResult.rows.length === 0) return [];

    const productIds = productsResult.rows.map(r => r.product_id);

    // Charger les ventes par produit pour les 4 dernieres occurrences du jour cible
    // (couvre J-7, J-14, J-21, J-28)
    const salesResult = await db.query(`
      SELECT
        si.product_id,
        DATE(s.created_at AT TIME ZONE '${tz}') as sale_date,
        SUM(si.quantity) as day_qty
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.store_id = $1
        AND si.product_id = ANY($2)
        AND EXTRACT(DOW FROM s.created_at AT TIME ZONE '${tz}') = $3
        AND s.created_at AT TIME ZONE '${tz}' >= (NOW() AT TIME ZONE '${tz}') - INTERVAL '29 days'
      GROUP BY si.product_id, DATE(s.created_at AT TIME ZONE '${tz}')
      ORDER BY si.product_id, sale_date DESC
    `, [storeId, productIds, targetDow]);

    // Organiser : { productId => [{ date, qty }, ...] } trie par date desc
    const salesByProduct: Record<string, { date: string; qty: number }[]> = {};
    for (const row of salesResult.rows) {
      const pid = row.product_id as string;
      if (!salesByProduct[pid]) salesByProduct[pid] = [];
      salesByProduct[pid].push({
        date: row.sale_date,
        qty: parseInt(String(row.day_qty)) || 0,
      });
    }

    // Calculer les dates de reference
    const nowLocal = await db.query(`SELECT (NOW() AT TIME ZONE '${tz}')::date as today`);
    const today = new Date(nowLocal.rows[0].today);

    const j7Date = new Date(today);
    j7Date.setDate(j7Date.getDate() - 7 + 1); // lendemain - 7 jours
    const j7Str = j7Date.toISOString().slice(0, 10);

    const j14Date = new Date(today);
    j14Date.setDate(j14Date.getDate() - 14 + 1);
    const j14Str = j14Date.toISOString().slice(0, 10);

    // Enrichir chaque produit avec la recommandation
    const results = productsResult.rows.map(product => {
      const pid = product.product_id as string;
      const history = salesByProduct[pid] || [];

      // Cascade : J-7 → J-14 → moyenne 4 derniers → aucun
      const j7Entry = history.find(h => h.date === j7Str);
      const j14Entry = history.find(h => h.date === j14Str);

      let lastWeekQty = 0;
      let referenceType: 'j7' | 'j14' | 'avg4' | 'none' = 'none';
      let referenceDate: string | null = null;
      let referenceLabel = '';

      if (j7Entry && j7Entry.qty > 0) {
        // Priorite 1 : meme jour il y a 7 jours
        lastWeekQty = j7Entry.qty;
        referenceType = 'j7';
        referenceDate = j7Str;
        referenceLabel = `${targetDayName} dernier (J-7)`;
      } else if (j14Entry && j14Entry.qty > 0) {
        // Priorite 2 : meme jour il y a 14 jours
        lastWeekQty = j14Entry.qty;
        referenceType = 'j14';
        referenceDate = j14Str;
        referenceLabel = `${targetDayName} J-14`;
      } else if (history.length > 0) {
        // Priorite 3 : moyenne des occurrences disponibles (max 4)
        const validEntries = history.filter(h => h.qty > 0).slice(0, 4);
        if (validEntries.length > 0) {
          const avg = validEntries.reduce((s, h) => s + h.qty, 0) / validEntries.length;
          lastWeekQty = Math.ceil(avg);
          referenceType = 'avg4';
          referenceDate = null;
          referenceLabel = `Moyenne ${validEntries.length} ${targetDayName}(s)`;
        }
      }
      // sinon : referenceType = 'none', lastWeekQty = 0

      if (referenceType === 'none') {
        referenceLabel = 'Historique insuffisant';
      }

      return {
        ...product,
        last_week_qty: lastWeekQty,
        reference_type: referenceType,
        reference_date: referenceDate,
        reference_label: referenceLabel,
        target_day_name: targetDayName,
      };
    });

    // Exclure les produits sans historique — ils sont accessibles via le catalogue
    const withHistory = results.filter(r => r.reference_type !== 'none');

    // Trier par categorie puis quantite vendue desc
    withHistory.sort((a, b) => {
      if ((a.display_order || 0) !== (b.display_order || 0)) return (a.display_order || 0) - (b.display_order || 0);
      return b.last_week_qty - a.last_week_qty;
    });

    return withHistory;
  },
};
