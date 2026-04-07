import { db } from '../config/database.js';
import { adjustProductStock } from './product-stock.helper.js';

export const productionRepository = {
  async findAll(params: { status?: string; type?: string; dateFrom?: string; dateTo?: string; targetRole?: string; storeId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`pp.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status) { conditions.push(`pp.status = $${i++}`); values.push(params.status); }
    if (params.type) { conditions.push(`pp.type = $${i++}`); values.push(params.type); }
    if (params.dateFrom) { conditions.push(`pp.plan_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`pp.plan_date <= $${i++}`); values.push(params.dateTo); }
    if (params.targetRole) { conditions.push(`pp.target_role = $${i++}`); values.push(params.targetRole); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM production_plans pp ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              o.order_number, o.status as order_status,
              oc.first_name || ' ' || oc.last_name as order_customer_name,
              (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count
       FROM production_plans pp
       JOIN users u ON u.id = pp.created_by
       LEFT JOIN orders o ON o.id = pp.order_id
       LEFT JOIN customers oc ON oc.id = o.customer_id
       ${where}
       ORDER BY pp.plan_date DESC, pp.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const planResult = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              o.order_number, o.status as order_status,
              oc.first_name as order_customer_first_name, oc.last_name as order_customer_last_name,
              oc.phone as order_customer_phone,
              o.pickup_date as order_pickup_date, o.total as order_total, o.advance_amount as order_advance_amount
       FROM production_plans pp
       JOIN users u ON u.id = pp.created_by
       LEFT JOIN orders o ON o.id = pp.order_id
       LEFT JOIN customers oc ON oc.id = o.customer_id
       WHERE pp.id = $1`,
      [id]
    );
    if (!planResult.rows[0]) return null;

    const itemsResult = await db.query(
      `SELECT ppi.*, p.name as product_name, p.image_url as product_image,
              c.slug as category_slug, c.name as category_name
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ppi.plan_id = $1
       ORDER BY p.name`,
      [id]
    );

    const needsResult = await db.query(
      `SELECT pin.*, ing.name as ingredient_name, ing.unit,
              p.name as product_name, c.slug as category_slug
       FROM production_ingredient_needs pin
       JOIN ingredients ing ON ing.id = pin.ingredient_id
       LEFT JOIN products p ON p.id = pin.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE pin.plan_id = $1
       ORDER BY ing.name`,
      [id]
    );

    // Fetch production transfers
    const transfersResult = await db.query(
      `SELECT pt.*,
              u.first_name || ' ' || u.last_name as transferred_by_name,
              ru.first_name || ' ' || ru.last_name as received_by_name
       FROM production_transfers pt
       JOIN users u ON u.id = pt.transferred_by
       LEFT JOIN users ru ON ru.id = pt.received_by
       WHERE pt.plan_id = $1
       ORDER BY pt.transferred_at DESC`,
      [id]
    );

    // Fetch transfer items for each transfer
    const transfers = [];
    for (const t of transfersResult.rows) {
      const tItemsResult = await db.query(
        `SELECT pti.*, p.name as product_name, p.image_url as product_image
         FROM production_transfer_items pti
         JOIN products p ON p.id = pti.product_id
         WHERE pti.transfer_id = $1
         ORDER BY p.name`,
        [t.id]
      );
      transfers.push({ ...t, items: tItemsResult.rows });
    }

    return {
      ...planResult.rows[0],
      items: itemsResult.rows,
      ingredient_needs: needsResult.rows,
      transfers,
    };
  },

  async create(data: {
    planDate: string; type: string; notes?: string; createdBy: string; targetRole?: string; storeId?: string;
    orderId?: string;
    items: { productId: string; plannedQuantity: number; notes?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const weekNumber = data.type === 'weekly' ? getISOWeek(new Date(data.planDate)) : null;
      const planResult = await client.query(
        `INSERT INTO production_plans (plan_date, type, week_number, notes, created_by, target_role, store_id, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.planDate, data.type, weekNumber, data.notes || null, data.createdBy, data.targetRole || null, data.storeId || null, data.orderId || null]
      );
      const planId = planResult.rows[0].id;

      const productIds: string[] = [];
      for (const item of data.items) {
        await client.query(
          `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
           VALUES ($1, $2, $3, $4)`,
          [planId, item.productId, item.plannedQuantity, item.notes || null]
        );
        productIds.push(item.productId);
      }

      // Mark confirmed orders for this date as in_production
      if (productIds.length > 0) {
        await client.query(
          `UPDATE orders SET status = 'in_production'
           WHERE pickup_date::date = $1::date
             AND status = 'confirmed'
             AND id IN (
               SELECT DISTINCT oi.order_id FROM order_items oi
               WHERE oi.product_id = ANY($2)
             )`,
          [data.planDate, productIds]
        );
      }

      await client.query('COMMIT');
      return planResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateItems(planId: string, items: { productId: string; plannedQuantity: number; notes?: string }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM production_plan_items WHERE plan_id = $1', [planId]);
      for (const item of items) {
        await client.query(
          `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
           VALUES ($1, $2, $3, $4)`,
          [planId, item.productId, item.plannedQuantity, item.notes || null]
        );
      }
      await client.query(`UPDATE production_plans SET updated_at = NOW() WHERE id = $1`, [planId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async confirm(planId: string) {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Get plan items
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1`,
        [planId]
      );

      // Calculate ingredient needs per ingredient per product
      const needsMap = new Map<string, { ingredientId: string; productId: string; quantity: number }>();

      async function collectNeeds(
        recipeId: string, yieldQty: number, multiplier: number,
        productId: string, acc: Map<string, { ingredientId: string; productId: string; quantity: number }>
      ) {
        const ingsResult = await client.query(
          `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`,
          [recipeId]
        );
        for (const ri of ingsResult.rows) {
          const needed = (parseFloat(ri.quantity) / yieldQty) * multiplier;
          const key = `${ri.ingredient_id}::${productId}`;
          const existing = acc.get(key);
          if (existing) {
            existing.quantity += needed;
          } else {
            acc.set(key, { ingredientId: ri.ingredient_id, productId, quantity: needed });
          }
        }

        // Recurse into sub-recipes
        const subsResult = await client.query(
          `SELECT rsr.sub_recipe_id, rsr.quantity, r.yield_quantity
           FROM recipe_sub_recipes rsr
           JOIN recipes r ON r.id = rsr.sub_recipe_id
           WHERE rsr.recipe_id = $1`,
          [recipeId]
        );
        for (const sub of subsResult.rows) {
          const subMultiplier = (parseFloat(sub.quantity) / yieldQty) * multiplier;
          await collectNeeds(sub.sub_recipe_id, sub.yield_quantity, subMultiplier, productId, acc);
        }
      }

      for (const item of itemsResult.rows) {
        const recipeResult = await client.query(
          `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) {
          warnings.push(`Le produit "${item.product_name}" n'a pas de recette, ignoré pour les besoins en ingrédients.`);
          continue;
        }
        const recipe = recipeResult.rows[0];
        await collectNeeds(recipe.id, recipe.yield_quantity, item.planned_quantity, item.product_id, needsMap);
      }

      // Delete any previous needs (in case of re-confirmation)
      await client.query('DELETE FROM production_ingredient_needs WHERE plan_id = $1', [planId]);

      // Insert ingredient needs with availability snapshot (per product)
      // First, get availability for all ingredients
      const ingredientIds = [...new Set([...needsMap.values()].map(n => n.ingredientId))];
      const availabilityMap = new Map<string, number>();
      for (const ingId of ingredientIds) {
        const invResult = await client.query(
          `SELECT COALESCE(SUM(current_quantity), 0) as total_quantity FROM inventory WHERE ingredient_id = $1`,
          [ingId]
        );
        availabilityMap.set(ingId, parseFloat(invResult.rows[0].total_quantity));
      }

      for (const entry of needsMap.values()) {
        const available = availabilityMap.get(entry.ingredientId) || 0;
        await client.query(
          `INSERT INTO production_ingredient_needs (plan_id, ingredient_id, needed_quantity, available_quantity, product_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [planId, entry.ingredientId, entry.quantity, available, entry.productId]
        );
      }

      // ═══ Modification 2: Detect per-product ingredient insufficiency → waiting list ═══
      // For each product, check if ALL its ingredients are sufficient
      const waitingProductIds: string[] = [];
      for (const item of itemsResult.rows) {
        // Get ingredient needs for this specific product
        const productNeedsResult = await client.query(
          `SELECT pin.ingredient_id, pin.needed_quantity, pin.available_quantity
           FROM production_ingredient_needs pin
           WHERE pin.plan_id = $1 AND pin.product_id = $2`,
          [planId, item.product_id]
        );
        const hasInsufficient = productNeedsResult.rows.some(
          (n: Record<string, unknown>) => parseFloat(n.available_quantity as string) < parseFloat(n.needed_quantity as string)
        );
        if (hasInsufficient) {
          waitingProductIds.push(item.product_id);
          await client.query(
            `UPDATE production_plan_items SET waiting_status = 'waiting' WHERE plan_id = $1 AND product_id = $2`,
            [planId, item.product_id]
          );
          warnings.push(`"${item.product_name}" mis en liste d'attente — ingredients insuffisants.`);
        }
      }

      // Update plan status
      await client.query(
        `UPDATE production_plans SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [planId]
      );

      await client.query('COMMIT');
      return { warnings, waitingProductIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async start(planId: string) {
    await db.query(
      `UPDATE production_plans SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [planId]
    );
  },

  async complete(planId: string, actualItems: { planItemId: string; actualQuantity: number }[], userId: string, storeId?: string, completionType?: string): Promise<{ warnings: string[] }> {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Update actual quantities
      for (const item of actualItems) {
        await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1 WHERE id = $2 AND plan_id = $3`,
          [item.actualQuantity, item.planItemId, planId]
        );
      }

      // Deduct ingredients based on actual production
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1`,
        [planId]
      );

      // Helper: collect all ingredient needs from a recipe, including sub-recipes (recursive)
      async function collectIngredientNeeds(
        recipeId: string, yieldQty: number, multiplier: number,
        acc: Map<string, number>,
      ) {
        // 1. Direct ingredients
        const ingsResult = await client.query(
          `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`,
          [recipeId],
        );
        for (const ri of ingsResult.rows) {
          const consumption = (parseFloat(ri.quantity) / yieldQty) * multiplier;
          const prev = acc.get(ri.ingredient_id) || 0;
          acc.set(ri.ingredient_id, prev + consumption);
        }

        // 2. Sub-recipes
        const subsResult = await client.query(
          `SELECT rsr.sub_recipe_id, rsr.quantity, r.yield_quantity
           FROM recipe_sub_recipes rsr
           JOIN recipes r ON r.id = rsr.sub_recipe_id
           WHERE rsr.recipe_id = $1`,
          [recipeId],
        );
        for (const sub of subsResult.rows) {
          const subMultiplier = (parseFloat(sub.quantity) / yieldQty) * multiplier;
          await collectIngredientNeeds(sub.sub_recipe_id, sub.yield_quantity, subMultiplier, acc);
        }
      }

      for (const item of itemsResult.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        const recipeResult = await client.query(
          `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) continue;

        const recipe = recipeResult.rows[0];
        const ingredientNeeds = new Map<string, number>();
        await collectIngredientNeeds(recipe.id, recipe.yield_quantity, item.actual_quantity, ingredientNeeds);

        for (const [ingredientId, consumption] of ingredientNeeds) {
          const storeFilter = storeId ? ' AND store_id = $3' : '';
          const invParams: unknown[] = [consumption, ingredientId];
          if (storeId) invParams.push(storeId);

          await client.query(
            `UPDATE inventory SET current_quantity = current_quantity - $1, updated_at = NOW()
             WHERE ingredient_id = $2${storeFilter}`,
            invParams
          );

          await client.query(
            `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
             VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
            [ingredientId, -consumption, `Production: ${item.product_name} x${item.actual_quantity}`, userId, planId, storeId || null]
          );

          // Check if stock went negative
          const checkStoreFilter = storeId ? ' AND store_id = $2' : '';
          const checkResult = await client.query(
            `SELECT current_quantity FROM inventory WHERE ingredient_id = $1${checkStoreFilter}`,
            [ingredientId, ...(storeId ? [storeId] : [])]
          );
          if (checkResult.rows[0] && parseFloat(checkResult.rows[0].current_quantity) < 0) {
            const ingNameResult = await client.query('SELECT name, unit FROM ingredients WHERE id = $1', [ingredientId]);
            const ingName = ingNameResult.rows[0]?.name || ingredientId;
            const ingUnit = ingNameResult.rows[0]?.unit || '';
            warnings.push(`Stock négatif: ${ingName} (${parseFloat(checkResult.rows[0].current_quantity).toFixed(2)} ${ingUnit})`);
          }
        }
      }

      // Update product stock (finished goods) based on actual production — store-isolated
      for (const item of itemsResult.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        const stockAfter = await adjustProductStock(client, item.product_id, item.actual_quantity, storeId);

        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
           VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
          [item.product_id, item.actual_quantity, stockAfter,
           `Production: ${item.product_name} x${item.actual_quantity}`, planId, userId, storeId || null]
        );
      }

      // Point 8: For partial closure, auto-cancel remaining pending/waiting items
      if (completionType === 'partial') {
        await client.query(
          `UPDATE production_plan_items
           SET status = 'cancelled', waiting_status = NULL, cancelled_at = NOW(), cancellation_reason = 'Cloture partielle'
           WHERE plan_id = $1 AND status = 'pending'`,
          [planId]
        );
      }

      // Determine completion_type: if any items were cancelled, it's partial
      const cancelledCheck = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_items WHERE plan_id = $1 AND status = 'cancelled'`,
        [planId]
      );
      const effectiveType = parseInt(cancelledCheck.rows[0].cnt) > 0 ? 'partial' : 'complete';

      // Update plan status
      await client.query(
        `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW(), completion_type = $2 WHERE id = $1`,
        [planId, effectiveType]
      );

      // Note: Replenishment V2 decouples production from replenishment.
      // The responsable manually manages the link between production output and replenishment preparation.

      // Mark related pre-orders as 'ready' (orders for this plan date with produced products)
      const planResult = await client.query(`SELECT plan_date FROM production_plans WHERE id = $1`, [planId]);
      if (planResult.rows[0]) {
        const planDate = planResult.rows[0].plan_date;
        const productIds = itemsResult.rows.map((it: Record<string, unknown>) => it.product_id);
        if (productIds.length > 0) {
          await client.query(
            `UPDATE orders SET status = 'ready'
             WHERE pickup_date::date = $1::date
               AND status = 'in_production'
               AND id IN (
                 SELECT DISTINCT oi.order_id FROM order_items oi
                 WHERE oi.product_id = ANY($2)
               )`,
            [planDate, productIds]
          );
        }
      }

      await client.query('COMMIT');
      return { warnings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Partial Production: produce selected items ═══
  async produceItems(planId: string, items: { planItemId: string; actualQuantity: number }[], userId: string, storeId?: string): Promise<{ warnings: string[] }> {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Verify plan status
      const planCheck = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
      if (!planCheck.rows[0] || planCheck.rows[0].status !== 'in_progress') {
        throw new Error('Le plan doit etre en cours pour produire des articles');
      }

      // Update actual quantities and status for selected items
      for (const item of items) {
        if (item.actualQuantity <= 0) continue;
        await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1, status = 'produced'
           WHERE id = $2 AND plan_id = $3 AND status = 'pending' AND (waiting_status IS NULL OR waiting_status = 'restored')`,
          [item.actualQuantity, item.planItemId, planId]
        );
      }

      // Get updated items to deduct ingredients
      const producedItems = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         WHERE ppi.plan_id = $1 AND ppi.id = ANY($2) AND ppi.status = 'produced'`,
        [planId, items.map(i => i.planItemId)]
      );

      // Deduct ingredients for produced items
      for (const item of producedItems.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        const recipeResult = await client.query(
          `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) continue;

        const recipe = recipeResult.rows[0];
        const ingredientNeeds = new Map<string, number>();

        // Recursive ingredient collection
        async function collectNeeds(recipeId: string, yieldQty: number, multiplier: number) {
          const ingsResult = await client.query(
            `SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1`, [recipeId]
          );
          for (const ri of ingsResult.rows) {
            const consumption = (parseFloat(ri.quantity) / yieldQty) * multiplier;
            ingredientNeeds.set(ri.ingredient_id, (ingredientNeeds.get(ri.ingredient_id) || 0) + consumption);
          }
          const subsResult = await client.query(
            `SELECT rsr.sub_recipe_id, rsr.quantity, r.yield_quantity
             FROM recipe_sub_recipes rsr JOIN recipes r ON r.id = rsr.sub_recipe_id
             WHERE rsr.recipe_id = $1`, [recipeId]
          );
          for (const sub of subsResult.rows) {
            await collectNeeds(sub.sub_recipe_id, sub.yield_quantity, (parseFloat(sub.quantity) / yieldQty) * multiplier);
          }
        }

        await collectNeeds(recipe.id, recipe.yield_quantity, item.actual_quantity);

        for (const [ingredientId, consumption] of ingredientNeeds) {
          const storeFilter = storeId ? ' AND store_id = $3' : '';
          const invParams: unknown[] = [consumption, ingredientId];
          if (storeId) invParams.push(storeId);

          await client.query(
            `UPDATE inventory SET current_quantity = current_quantity - $1, updated_at = NOW()
             WHERE ingredient_id = $2${storeFilter}`, invParams
          );
          await client.query(
            `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
             VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
            [ingredientId, -consumption, `Production partielle: ${item.product_name} x${item.actual_quantity}`, userId, planId, storeId || null]
          );

          // Check negative stock
          const checkFilter = storeId ? ' AND store_id = $2' : '';
          const checkResult = await client.query(
            `SELECT current_quantity FROM inventory WHERE ingredient_id = $1${checkFilter}`,
            [ingredientId, ...(storeId ? [storeId] : [])]
          );
          if (checkResult.rows[0] && parseFloat(checkResult.rows[0].current_quantity) < 0) {
            const ingName = await client.query('SELECT name, unit FROM ingredients WHERE id = $1', [ingredientId]);
            warnings.push(`Stock negatif: ${ingName.rows[0]?.name} (${parseFloat(checkResult.rows[0].current_quantity).toFixed(2)} ${ingName.rows[0]?.unit || ''})`);
          }
        }

        // Update product stock
        const stockAfter = await adjustProductStock(client, item.product_id, item.actual_quantity, storeId);
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
           VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
          [item.product_id, item.actual_quantity, stockAfter,
           `Production partielle: ${item.product_name} x${item.actual_quantity}`, planId, userId, storeId || null]
        );
      }

      // ═══ Auto-complete: if all items are now produced/cancelled (no more pending), complete the plan ═══
      const remainingPending = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_items
         WHERE plan_id = $1 AND status = 'pending'`,
        [planId]
      );
      const pendingCount = parseInt(remainingPending.rows[0].cnt);
      let autoCompleted = false;

      if (pendingCount === 0) {
        // All items are produced or cancelled — auto-complete
        const cancelledCheck = await client.query(
          `SELECT COUNT(*) as cnt FROM production_plan_items WHERE plan_id = $1 AND status = 'cancelled'`, [planId]
        );
        const completionType = parseInt(cancelledCheck.rows[0].cnt) > 0 ? 'partial' : 'complete';
        await client.query(
          `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW(), completion_type = $2 WHERE id = $1`,
          [planId, completionType]
        );
        autoCompleted = true;
      }

      await client.query('COMMIT');
      return { warnings, autoCompleted };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Partial Transfer: transfer produced items to store ═══
  async createTransfer(planId: string, itemIds: string[], userId: string, storeId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get produced items to transfer
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         WHERE ppi.plan_id = $1 AND ppi.id = ANY($2) AND ppi.status = 'produced'`,
        [planId, itemIds]
      );

      if (itemsResult.rows.length === 0) {
        throw new Error('Aucun article produit a transferer');
      }

      // Create transfer record
      const transferResult = await client.query(
        `INSERT INTO production_transfers (plan_id, store_id, transferred_by)
         VALUES ($1, $2, $3) RETURNING *`,
        [planId, storeId || null, userId]
      );
      const transferId = transferResult.rows[0].id;

      // Create transfer items and update item status
      for (const item of itemsResult.rows) {
        await client.query(
          `INSERT INTO production_transfer_items (transfer_id, plan_item_id, product_id, product_name, transferred_quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [transferId, item.id, item.product_id, item.product_name, item.actual_quantity]
        );
        await client.query(
          `UPDATE production_plan_items SET status = 'transferred' WHERE id = $1`,
          [item.id]
        );
      }

      await client.query('COMMIT');
      return transferResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Confirm transfer reception (cashier) ═══
  async confirmTransferReception(transferId: string, items: { itemId: string; qtyReceived: number; notes?: string }[], userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      let hasDiscrepancy = false;
      for (const item of items) {
        await client.query(
          `UPDATE production_transfer_items SET received_quantity = $1 WHERE id = $2 AND transfer_id = $3`,
          [item.qtyReceived, item.itemId, transferId]
        );
        // Check discrepancy
        const tItem = await client.query(
          `SELECT transferred_quantity FROM production_transfer_items WHERE id = $1`, [item.itemId]
        );
        if (tItem.rows[0] && item.qtyReceived !== tItem.rows[0].transferred_quantity) {
          hasDiscrepancy = true;
        }
        // Update plan item status to received
        const planItemResult = await client.query(
          `SELECT plan_item_id FROM production_transfer_items WHERE id = $1`, [item.itemId]
        );
        if (planItemResult.rows[0]) {
          await client.query(
            `UPDATE production_plan_items SET status = 'received' WHERE id = $1`,
            [planItemResult.rows[0].plan_item_id]
          );
        }
      }

      // Update transfer status
      const transferStatus = hasDiscrepancy ? 'received_with_discrepancy' : 'received';
      await client.query(
        `UPDATE production_transfers SET status = $1, received_by = $2, received_at = NOW() WHERE id = $3`,
        [transferStatus, userId, transferId]
      );

      // Check if ALL plan items are now received → auto-complete plan
      const transfer = await client.query(`SELECT plan_id FROM production_transfers WHERE id = $1`, [transferId]);
      const planId = transfer.rows[0].plan_id;

      const remainingResult = await client.query(
        `SELECT COUNT(*) as remaining FROM production_plan_items
         WHERE plan_id = $1 AND status NOT IN ('received', 'cancelled')`,
        [planId]
      );
      const remaining = parseInt(remainingResult.rows[0].remaining);

      let planCompleted = false;
      if (remaining === 0) {
        // Point 8: Determine completion_type based on cancelled items
        const cancelledCheck = await client.query(
          `SELECT COUNT(*) as cnt FROM production_plan_items WHERE plan_id = $1 AND status = 'cancelled'`, [planId]
        );
        const cType = parseInt(cancelledCheck.rows[0].cnt) > 0 ? 'partial' : 'complete';
        await client.query(
          `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW(), completion_type = $2 WHERE id = $1`,
          [planId, cType]
        );
        planCompleted = true;
      }

      await client.query('COMMIT');
      return { status: transferStatus, planCompleted, planId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Get pending production transfers for cashier ═══
  async getPendingProductionTransfers(storeId: string) {
    const result = await db.query(
      `SELECT pt.*,
              pp.target_role, pp.plan_date,
              u.first_name || ' ' || u.last_name as transferred_by_name
       FROM production_transfers pt
       JOIN production_plans pp ON pp.id = pt.plan_id
       JOIN users u ON u.id = pt.transferred_by
       WHERE pt.store_id = $1 AND pt.status = 'transferred'
       ORDER BY pt.transferred_at ASC`,
      [storeId]
    );

    // Fetch items for each transfer
    const transfers = [];
    for (const t of result.rows) {
      const itemsResult = await db.query(
        `SELECT pti.*, p.image_url as product_image
         FROM production_transfer_items pti
         JOIN products p ON p.id = pti.product_id
         WHERE pti.transfer_id = $1
         ORDER BY pti.product_name`,
        [t.id]
      );
      transfers.push({ ...t, items: itemsResult.rows });
    }

    return transfers;
  },

  // ═══ Modification 2: Restore items from waiting list after restock ═══
  async restoreFromWaiting(planId: string, itemIds: string[]) {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Get plan to verify status
      const planResult = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
      if (!planResult.rows[0] || !['confirmed', 'in_progress'].includes(planResult.rows[0].status)) {
        throw new Error('Le plan doit etre confirme ou en cours pour restaurer des articles');
      }

      for (const itemId of itemIds) {
        // Get the item and its product
        const itemResult = await client.query(
          `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
           JOIN products p ON p.id = ppi.product_id
           WHERE ppi.id = $1 AND ppi.plan_id = $2 AND ppi.waiting_status = 'waiting'`,
          [itemId, planId]
        );
        if (!itemResult.rows[0]) continue;
        const item = itemResult.rows[0];

        // Re-check ingredient availability for this product (SUM across all store rows)
        const needsResult = await client.query(
          `SELECT pin.ingredient_id, pin.needed_quantity,
                  COALESCE((SELECT SUM(current_quantity) FROM inventory WHERE ingredient_id = pin.ingredient_id), 0) as current_available
           FROM production_ingredient_needs pin
           WHERE pin.plan_id = $1 AND pin.product_id = $2`,
          [planId, item.product_id]
        );

        const stillInsufficient = needsResult.rows.some(
          (n: Record<string, unknown>) => parseFloat(n.current_available as string) < parseFloat(n.needed_quantity as string)
        );

        if (stillInsufficient) {
          warnings.push(`"${item.product_name}" ne peut pas etre restaure — ingredients toujours insuffisants.`);
          continue;
        }

        // Update availability snapshot in production_ingredient_needs
        for (const need of needsResult.rows) {
          await client.query(
            `UPDATE production_ingredient_needs SET available_quantity = $1
             WHERE plan_id = $2 AND ingredient_id = $3 AND product_id = $4`,
            [need.current_available, planId, need.ingredient_id, item.product_id]
          );
        }

        // Restore the item
        await client.query(
          `UPDATE production_plan_items SET waiting_status = 'restored' WHERE id = $1`,
          [itemId]
        );
      }

      await client.query('COMMIT');
      return { warnings };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Point 8: Cancel individual plan items ═══
  async cancelItems(planId: string, itemIds: string[], reason?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const planResult = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
      if (!planResult.rows[0] || !['confirmed', 'in_progress'].includes(planResult.rows[0].status)) {
        throw new Error('Le plan doit etre confirme ou en cours pour annuler des articles');
      }

      const cancelled: string[] = [];
      for (const itemId of itemIds) {
        const result = await client.query(
          `UPDATE production_plan_items
           SET status = 'cancelled', waiting_status = NULL, cancelled_at = NOW(), cancellation_reason = $1
           WHERE id = $2 AND plan_id = $3
           AND status = 'pending'
           RETURNING id`,
          [reason || 'Annule manuellement', itemId, planId]
        );
        if (result.rows[0]) cancelled.push(result.rows[0].id);
      }

      await client.query('COMMIT');
      return { cancelledCount: cancelled.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async remove(planId: string) {
    await db.query('DELETE FROM production_plans WHERE id = $1', [planId]);
  },
};

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
