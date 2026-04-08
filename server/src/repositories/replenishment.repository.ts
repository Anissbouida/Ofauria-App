import { db } from '../config/database.js';
import { getCategoryRole } from '@ofauria/shared';

export const replenishmentRepository = {

  async generateRequestNumber(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await db.query(
      `SELECT COUNT(DISTINCT batch_id) FROM replenishment_requests WHERE DATE(created_at AT TIME ZONE 'Africa/Casablanca') = DATE(NOW() AT TIME ZONE 'Africa/Casablanca') AND batch_id IS NOT NULL`
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

      // ── Stock availability check ──
      const stockResult = await client.query(
        `SELECT product_id, COALESCE(stock_quantity, 0) as stock_quantity
         FROM product_store_stock
         WHERE product_id = ANY($1) AND store_id = $2`,
        [productIds, data.storeId]
      );
      const stockMap: Record<string, number> = {};
      for (const row of stockResult.rows) {
        stockMap[row.product_id] = Math.floor(parseFloat(row.stock_quantity));
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
      const productionPlanIds: Record<string, string> = {};
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

        // Insert items with stock availability info
        const productionNeeded: { productId: string; qty: number; itemId: string }[] = [];

        for (const item of items) {
          const available = Math.max(stockMap[item.productId] || 0, 0);
          const requested = item.requestedQuantity;
          const fromStock = Math.min(available, requested);
          const toProduce = requested - fromStock;
          const sourceType = toProduce === 0 ? 'stock' : fromStock === 0 ? 'production' : 'mixed';

          const itemResult = await client.query(
            `INSERT INTO replenishment_request_items (request_id, product_id, requested_quantity, status, source_type, qty_from_stock, qty_to_produce)
             VALUES ($1, $2, $3, 'pending', $4, $5, $6) RETURNING id`,
            [req.id, item.productId, requested, sourceType, fromStock, toProduce]
          );

          if (toProduce > 0) {
            productionNeeded.push({ productId: item.productId, qty: toProduce, itemId: itemResult.rows[0].id });
          }
        }

        // Auto-create production plan if any items need production
        if (productionNeeded.length > 0) {
          const planResult = await client.query(
            `INSERT INTO production_plans (plan_date, type, notes, created_by, target_role, store_id, replenishment_request_id)
             VALUES (CURRENT_DATE, 'daily', $1, $2, $3, $4, $5) RETURNING id`,
            [`Auto — approvisionnement ${fullNumber}`, data.requestedBy, role, data.storeId, req.id]
          );
          const planId = planResult.rows[0].id;
          productionPlanIds[role] = planId;

          // Point 4: Fetch min_production_quantity for all products needing production
          const prodIdsForMin = productionNeeded.map(pi => pi.productId);
          const minQtyResult = await client.query(
            `SELECT id, COALESCE(min_production_quantity, 0) as min_production_quantity FROM products WHERE id = ANY($1)`,
            [prodIdsForMin]
          );
          const minQtyMap: Record<string, number> = {};
          for (const row of minQtyResult.rows) {
            minQtyMap[row.id] = parseInt(row.min_production_quantity) || 0;
          }

          for (const pi of productionNeeded) {
            // Apply lot minimum: production = max(needed, minimum)
            const minQty = minQtyMap[pi.productId] || 0;
            const effectiveQty = Math.max(pi.qty, minQty);
            await client.query(
              `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity)
               VALUES ($1, $2, $3)`,
              [planId, pi.productId, effectiveQty]
            );
            await client.query(
              `UPDATE replenishment_request_items SET production_plan_id = $1 WHERE id = $2`,
              [planId, pi.itemId]
            );
          }
        }
      }

      await client.query('COMMIT');

      return { ...firstRequest, _requestIds: requestIds, _productionPlanIds: productionPlanIds, request_number: firstRequest?.request_number };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /* ─── STEP 2: Acknowledge (sub-request: submitted → acknowledged) ─── */

  async acknowledge(requestId: string, acknowledgedBy: string) {
    const result = await db.query(
      `UPDATE replenishment_requests
       SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'submitted'
       RETURNING id`,
      [acknowledgedBy, requestId]
    );
    if (!result.rows[0]) throw new Error('Invalid state transition');
    return this.findById(requestId);
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

  async cancel(requestId: string) {
    await db.query(
      `UPDATE replenishment_requests SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('submitted', 'acknowledged')`,
      [requestId]
    );
  },

  /* ─── RULE 1: Get product IDs already requested today for this store ─── */

  async findTodayRequestedProductIds(storeId: string): Promise<string[]> {
    const result = await db.query(
      `SELECT DISTINCT ri.product_id
       FROM replenishment_request_items ri
       JOIN replenishment_requests rr ON rr.id = ri.request_id
       WHERE rr.store_id = $1
         AND DATE(rr.created_at AT TIME ZONE 'Africa/Casablanca') = DATE(NOW() AT TIME ZONE 'Africa/Casablanca')
         AND rr.status NOT IN ('cancelled', 'closed', 'closed_with_discrepancy')`,
      [storeId]
    );
    return result.rows.map((r: { product_id: string }) => r.product_id);
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
             AND DATE(s.created_at AT TIME ZONE 'Africa/Casablanca') = DATE(NOW() AT TIME ZONE 'Africa/Casablanca')
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
      LEFT JOIN product_display_tracking pdt ON pdt.product_id = pss.product_id AND pdt.store_id = $1 AND pdt.status = 'active'
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
    items: { productId: string; productName: string; replenishedQty: number; soldQty: number; remainingQty: number; destination?: string; displayStatus?: string }[];
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

  async getRecommendations(storeId: string) {
    const result = await db.query(`
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.price,
        c.id as category_id,
        c.name as category_name,
        c.slug as category_slug,
        c.display_order,
        COALESCE(SUM(si.quantity), 0) as last_week_qty,
        COALESCE(pss.stock_quantity, 0) as current_stock,
        p.stock_min_threshold
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN sale_items si ON si.product_id = p.id
        AND si.sale_id IN (
          SELECT s.id FROM sales s
          WHERE s.store_id = $1
            AND EXTRACT(DOW FROM s.created_at) = EXTRACT(DOW FROM NOW())
            AND s.created_at >= NOW() - INTERVAL '14 days'
            AND s.created_at < NOW() - INTERVAL '6 days'
        )
      LEFT JOIN product_store_stock pss ON pss.product_id = p.id AND pss.store_id = $1
      WHERE p.is_available = true
      GROUP BY p.id, p.name, p.image_url, p.price, c.id, c.name, c.slug, c.display_order, pss.stock_quantity, p.stock_min_threshold
      HAVING COALESCE(SUM(si.quantity), 0) > 0
      ORDER BY c.display_order, COALESCE(SUM(si.quantity), 0) DESC
    `, [storeId]);

    return result.rows;
  },
};
