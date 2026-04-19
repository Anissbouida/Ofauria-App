import { db } from '../config/database.js';
import { adjustProductStock } from './product-stock.helper.js';
import { ingredientLotRepository } from './ingredient-lot.repository.js';
import { bonSortieRepository } from './bon-sortie.repository.js';
import { getLocalNow } from '../utils/timezone.js';
import { productionEtapesRepository } from './production-etapes.repository.js';

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

    // Exclude semi-finished plans from the main list – they are accessed via their parent plan
    conditions.push(`COALESCE(pp.is_semi_finished_plan, false) = false`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM production_plans pp ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT pp.*, u.first_name || ' ' || u.last_name as created_by_name,
              o.order_number, o.status as order_status,
              oc.first_name || ' ' || oc.last_name as order_customer_name,
              (SELECT COUNT(*) FROM production_plan_items WHERE plan_id = pp.id) as item_count,
              (SELECT COUNT(*) FROM production_plan_dependencies WHERE parent_plan_id = pp.id) as dep_total,
              (SELECT COUNT(*) FROM production_plan_dependencies WHERE parent_plan_id = pp.id AND status = 'fulfilled') as dep_fulfilled
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
      `SELECT ppi.*, COALESCE(p.name, br.name) as product_name, p.image_url as product_image,
              c.slug as category_slug, c.name as category_name,
              p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.cost_price,
              pdt.produced_at, pdt.expires_at, pdt.display_expires_at,
              pst.created_at as production_timestamp,
              pu.first_name as produced_by_first_name, pu.last_name as produced_by_last_name,
              su.first_name as started_by_first_name, su.last_name as started_by_last_name,
              pln.lot_number,
              br.name as base_recipe_name, br.yield_unit as base_recipe_unit,
              pc.nom as contenant_nom, pc.type_production as contenant_type
       FROM production_plan_items ppi
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes br ON br.id = ppi.base_recipe_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN production_contenants pc ON pc.id = ppi.contenant_id
       LEFT JOIN users su ON su.id = ppi.started_by
       LEFT JOIN production_lot_numbers pln ON pln.plan_item_id = ppi.id
       LEFT JOIN LATERAL (
         SELECT pdt2.produced_at, pdt2.expires_at, pdt2.display_expires_at
         FROM product_display_tracking pdt2
         WHERE pdt2.product_id = ppi.product_id AND pdt2.status = 'active'
         ORDER BY pdt2.produced_at DESC LIMIT 1
       ) pdt ON true
       LEFT JOIN LATERAL (
         SELECT pst2.created_at, pst2.performed_by
         FROM product_stock_transactions pst2
         WHERE pst2.product_id = ppi.product_id AND pst2.type = 'production' AND pst2.reference_id = $1
         ORDER BY pst2.created_at DESC LIMIT 1
       ) pst ON true
       LEFT JOIN users pu ON pu.id = pst.performed_by
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

    // Fetch dependencies (this plan depends on semi-finished plans)
    const depsResult = await db.query(
      `SELECT ppd.*, r.name as sub_recipe_name,
              dp.status as dep_plan_status, dp.is_semi_finished_plan
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       LEFT JOIN production_plans dp ON dp.id = ppd.dependency_plan_id
       WHERE ppd.parent_plan_id = $1
       ORDER BY ppd.created_at`,
      [id]
    );

    // Fetch reverse dependencies (this plan is a dependency of parent plans)
    const depOfResult = await db.query(
      `SELECT ppd.parent_plan_id, ppd.sub_recipe_id, ppd.quantity_needed, ppd.quantity_to_produce, ppd.quantity_from_stock, ppd.status,
              r.name as sub_recipe_name, r.yield_quantity, r.yield_unit, r.instructions, r.is_base,
              pp_parent.plan_date as parent_plan_date, pp_parent.status as parent_status, pp_parent.notes as parent_notes,
              SUBSTRING(ppd.parent_plan_id::text, 1, 8) as parent_short_id,
              u_parent.first_name || ' ' || u_parent.last_name as parent_created_by_name
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       JOIN production_plans pp_parent ON pp_parent.id = ppd.parent_plan_id
       JOIN users u_parent ON u_parent.id = pp_parent.created_by
       WHERE ppd.dependency_plan_id = $1`,
      [id]
    );

    // For semi-fini plans, also fetch the recipe ingredients
    let recipeIngredients: Record<string, unknown>[] = [];
    if (depOfResult.rows.length > 0 && depOfResult.rows[0].sub_recipe_id) {
      const riResult = await db.query(
        `SELECT ri.ingredient_id, ing.name as ingredient_name, ri.quantity, COALESCE(NULLIF(ri.unit, ''), ing.unit) as unit, ing.unit as base_unit
         FROM recipe_ingredients ri
         JOIN ingredients ing ON ing.id = ri.ingredient_id
         WHERE ri.recipe_id = $1
         ORDER BY ing.name`,
        [depOfResult.rows[0].sub_recipe_id]
      );
      recipeIngredients = riResult.rows;
    }

    return {
      ...planResult.rows[0],
      items: itemsResult.rows,
      ingredient_needs: needsResult.rows,
      transfers,
      dependencies: depsResult.rows,
      dependency_of: depOfResult.rows,
      recipe_ingredients: recipeIngredients,
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

      // Enrich items with calcul inverse (for direct plans without contenant info)
      const itemProductIds = itemsResult.rows.map((r: Record<string, unknown>) => r.product_id);
      const profilesResult = await client.query(
        `SELECT pp.produit_id, pp.contenant_id,
                COALESCE(pp.surcharge_quantite_theorique, pc.quantite_theorique) as quantite_theorique,
                COALESCE(pp.surcharge_pertes_fixes, pc.pertes_fixes) as pertes_fixes,
                (COALESCE(pp.surcharge_quantite_theorique, pc.quantite_theorique) - COALESCE(pp.surcharge_pertes_fixes, pc.pertes_fixes)) as quantite_nette_cible
         FROM produit_profil_production pp
         JOIN production_contenants pc ON pc.id = pp.contenant_id
         WHERE pp.produit_id = ANY($1)`,
        [itemProductIds]
      );
      const profileMap: Record<string, { contenantId: string; qnc: number; qt: number }> = {};
      for (const row of profilesResult.rows) {
        profileMap[row.produit_id] = { contenantId: row.contenant_id, qnc: parseFloat(row.quantite_nette_cible), qt: parseFloat(row.quantite_theorique) };
      }

      for (const item of itemsResult.rows) {
        if (item.contenant_id) continue; // Already enriched (from acknowledge)
        const profile = profileMap[item.product_id as string];
        if (profile && profile.qnc > 0) {
          const plannedQty = parseInt(item.planned_quantity);
          const nbContenants = Math.ceil(plannedQty / profile.qnc);
          const effectiveQty = nbContenants * profile.qnc;
          const surplus = effectiveQty - plannedQty;
          await client.query(
            `UPDATE production_plan_items
             SET contenant_id = $1, nb_contenants = $2, quantite_nette_cible = $3, quantite_brute_totale = $4, surplus_frigo = $5,
                 planned_quantity = $6
             WHERE id = $7`,
            [profile.contenantId, nbContenants, profile.qnc, nbContenants * profile.qt, surplus, effectiveQty, item.id]
          );
          item.planned_quantity = effectiveQty;
        }
      }

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

      // Update plan status and persist warnings
      await client.query(
        `UPDATE production_plans SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW(), warnings = $2 WHERE id = $1`,
        [planId, warnings]
      );

      // Assign lot numbers (LOT-AAMMJJ-NNN) to plan items
      const planDateResult = await client.query(`SELECT plan_date, store_id FROM production_plans WHERE id = $1`, [planId]);
      if (planDateResult.rows[0]) {
        await assignLotNumbersInternal(client, planId, planDateResult.rows[0].plan_date);
      }

      await client.query('COMMIT');

      // ═══ Phase 3: Auto-generate bon de sortie after confirmation ═══
      try {
        const storeId = planDateResult.rows[0]?.store_id;
        if (storeId && needsMap.size > 0) {
          await bonSortieRepository.generate(planId, storeId, '');
        }
      } catch (bonErr) {
        // Non-blocking: bon de sortie generation failure should not fail confirmation
        warnings.push('Le bon de sortie n\'a pas pu etre genere automatiquement.');
      }

      return { warnings, waitingProductIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async start(planId: string) {
    // Check if this plan has unfulfilled semi-finished dependencies
    const depsResult = await db.query(
      `SELECT ppd.status, r.name as sub_recipe_name
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       WHERE ppd.parent_plan_id = $1 AND ppd.status NOT IN ('fulfilled', 'cancelled')`,
      [planId]
    );
    if (depsResult.rows.length > 0) {
      const pending = depsResult.rows.map((r: Record<string, unknown>) => r.sub_recipe_name as string).join(', ');
      throw new Error(`Semi-finis en attente: ${pending}. Produisez-les d'abord.`);
    }

    // Check BSI status — production cannot start until ingredients are delivered (BSI clôturé)
    // Semi-finished plans don't have their own BSI, so skip this check for them
    const planInfo = await db.query(
      `SELECT is_semi_finished_plan FROM production_plans WHERE id = $1`, [planId]
    );
    if (!planInfo.rows[0]?.is_semi_finished_plan) {
      const bsiResult = await db.query(
        `SELECT id, status, numero FROM production_bons_sortie
         WHERE plan_id = $1 AND status != 'annule'
         ORDER BY created_at DESC LIMIT 1`,
        [planId]
      );
      if (bsiResult.rows.length === 0) {
        throw new Error('Aucun bon de sortie genere. Generez le BSI avant de demarrer la production.');
      }
      const bsi = bsiResult.rows[0];
      if (bsi.status !== 'cloture') {
        const statusLabels: Record<string, string> = {
          genere: 'genere', prelevement: 'en prelevement', verifie: 'verifie'
        };
        throw new Error(`Le bon de sortie ${bsi.numero} est "${statusLabels[bsi.status] || bsi.status}". Les ingredients doivent etre livres (BSI cloture) avant de demarrer la production.`);
      }
    }

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

      // Update actual quantities and mark as produced
      for (const item of actualItems) {
        await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1, status = CASE WHEN $1 > 0 THEN 'produced' ELSE status END WHERE id = $2 AND plan_id = $3`,
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
          const lockStoreFilter = storeId ? ' AND store_id = $2' : '';
          const invParams: unknown[] = [consumption, ingredientId];
          if (storeId) invParams.push(storeId);

          // Lock row and check stock BEFORE deducting to prevent negative inventory
          const lockResult = await client.query(
            `SELECT current_quantity FROM inventory WHERE ingredient_id = $1${lockStoreFilter} FOR UPDATE`,
            [ingredientId, ...(storeId ? [storeId] : [])]
          );
          const currentStock = lockResult.rows[0] ? parseFloat(lockResult.rows[0].current_quantity) : 0;
          const actualConsumption = Math.min(consumption, Math.max(currentStock, 0));

          if (currentStock < consumption) {
            const ingNameResult = await client.query('SELECT name, unit FROM ingredients WHERE id = $1', [ingredientId]);
            const ingName = ingNameResult.rows[0]?.name || ingredientId;
            const ingUnit = ingNameResult.rows[0]?.unit || '';
            warnings.push(`Stock insuffisant: ${ingName} — besoin ${consumption.toFixed(2)} ${ingUnit}, disponible ${currentStock.toFixed(2)} ${ingUnit}`);
          }

          // Clamp to 0: never allow negative stock
          await client.query(
            `UPDATE inventory SET current_quantity = GREATEST(current_quantity - $1, 0), updated_at = NOW()
             WHERE ingredient_id = $2${storeFilter}`,
            invParams
          );

          await client.query(
            `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
             VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
            [ingredientId, -consumption, `Production: ${item.product_name} x${item.actual_quantity}`, userId, planId, storeId || null]
          );

          // FEFO lot consumption for ONSSA traceability — consume only what's actually available
          if (actualConsumption > 0) {
            try {
              await ingredientLotRepository.consumeFEFO(client, ingredientId, actualConsumption, planId, storeId);
            } catch (fefoErr) {
              const ingNameFEFO = await client.query('SELECT name FROM ingredients WHERE id = $1', [ingredientId]);
              console.error(`[consumeFEFO] Erreur pour ${ingNameFEFO.rows[0]?.name || ingredientId}:`, fefoErr);
              warnings.push(`Traçabilité lots: erreur FEFO pour ${ingNameFEFO.rows[0]?.name || ingredientId}`);
            }
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

        // Create product_display_tracking for lifecycle management
        if (storeId) {
          const productLifecycle = await client.query(
            `SELECT shelf_life_days, display_life_hours FROM products WHERE id = $1`,
            [item.product_id]
          );
          if (productLifecycle.rows[0]?.shelf_life_days) {
            const { shelf_life_days, display_life_hours } = productLifecycle.rows[0];
            const shelfDays = parseInt(shelf_life_days);
            const displayHours = display_life_hours ? parseInt(display_life_hours) : null;
            await client.query(
              `INSERT INTO product_display_tracking (product_id, store_id, produced_at, expires_at, display_expires_at, status)
               VALUES ($1, $2, NOW(), NOW() + ($3 * INTERVAL '1 day'), ${displayHours !== null ? `NOW() + ($4 * INTERVAL '1 hour')` : 'NULL'}, 'active')`,
              displayHours !== null ? [item.product_id, storeId, shelfDays, displayHours] : [item.product_id, storeId, shelfDays]
            );
          }
        }
      }

      // Point 8: For partial closure, auto-cancel remaining non-produced items (pending AND in_progress)
      if (completionType === 'partial') {
        await client.query(
          `UPDATE production_plan_items
           SET status = 'cancelled', waiting_status = NULL, cancelled_at = NOW(), cancellation_reason = 'Cloture partielle'
           WHERE plan_id = $1 AND status IN ('pending', 'in_progress')`,
          [planId]
        );
      }

      // Determine completion_type: if any items were cancelled, it's partial
      const cancelledCheck = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_items WHERE plan_id = $1 AND status = 'cancelled'`,
        [planId]
      );
      const effectiveType = parseInt(cancelledCheck.rows[0].cnt) > 0 ? 'partial' : 'complete';

      // Update plan status and append warnings
      await client.query(
        `UPDATE production_plans SET status = 'completed', completed_at = NOW(), updated_at = NOW(), completion_type = $2,
         warnings = COALESCE(warnings, '{}') || $3::text[]
         WHERE id = $1`,
        [planId, effectiveType, warnings]
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

  // ═══ Start items: pending → in_progress (chef launches production) ═══
  async startItems(planId: string, itemIds: string[], userId: string, startedAt?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const planCheck = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
      if (!planCheck.rows[0] || planCheck.rows[0].status !== 'in_progress') {
        throw new Error('Le plan doit etre en cours pour lancer des productions');
      }

      const startTime = startedAt || getLocalNow().toISOString();
      const started: string[] = [];

      for (const itemId of itemIds) {
        const result = await client.query(
          `UPDATE production_plan_items SET status = 'in_progress', started_at = $1, started_by = $2
           WHERE id = $3 AND plan_id = $4 AND status = 'pending' AND (waiting_status IS NULL OR waiting_status = 'restored')
           RETURNING id`,
          [startTime, userId, itemId, planId]
        );
        if (result.rows[0]) {
          started.push(result.rows[0].id);
          // Initialize production steps from contenant/profile (Phase 4)
          try {
            await productionEtapesRepository.initializeForItem(result.rows[0].id, client);
          } catch (_) { /* steps are optional — don't block production start */ }
        }
      }

      await client.query('COMMIT');
      return { startedIds: started };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══ Partial Production: produce selected items (in_progress → produced) ═══
  async produceItems(planId: string, items: { planItemId: string; actualQuantity: number }[], userId: string, storeId?: string, producedAt?: string): Promise<{ warnings: string[]; autoCompleted: boolean }> {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');

      // Verify plan status
      const planCheck = await client.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
      if (!planCheck.rows[0] || planCheck.rows[0].status !== 'in_progress') {
        throw new Error('Le plan doit etre en cours pour produire des articles');
      }

      // Check if blocking steps guard is enabled (column may not exist before migration 089)
      // Use SAVEPOINT so a failed query doesn't abort the entire transaction
      let stepsBlocking = false;
      try {
        await client.query('SAVEPOINT check_steps_blocking');
        const settingsResult = await client.query(`SELECT production_steps_blocking FROM company_settings LIMIT 1`);
        stepsBlocking = settingsResult.rows[0]?.production_steps_blocking === true;
        await client.query('RELEASE SAVEPOINT check_steps_blocking');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT check_steps_blocking');
        /* column doesn't exist yet — feature disabled */
      }

      // Update actual quantities and status for selected items
      for (const item of items) {
        if (item.actualQuantity <= 0) continue;

        // Phase 4: guard — if blocking steps are enforced, verify all are complete
        if (stepsBlocking) {
          const allDone = await productionEtapesRepository.areBlockingStepsComplete(item.planItemId);
          if (!allDone) {
            warnings.push(`Etapes bloquantes non terminees pour l'article ${item.planItemId}`);
            continue;
          }
        }

        await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1, status = 'produced'
           WHERE id = $2 AND plan_id = $3 AND status IN ('pending', 'in_progress') AND (waiting_status IS NULL OR waiting_status = 'restored')`,
          [item.actualQuantity, item.planItemId, planId]
        );
      }

      // Check if this is a semi-finished plan
      const planInfo = await client.query(
        `SELECT is_semi_finished_plan, store_id FROM production_plans WHERE id = $1`, [planId]
      );
      const isSemiFinishedPlan = planInfo.rows[0]?.is_semi_finished_plan === true;

      // Get sub-recipe IDs fulfilled from stock for this plan (to skip during ingredient deduction)
      const fulfilledSubRecipes = new Set<string>();
      const depsResult = await client.query(
        `SELECT sub_recipe_id FROM production_plan_dependencies
         WHERE parent_plan_id = $1 AND status = 'fulfilled' AND quantity_from_stock > 0`,
        [planId]
      );
      for (const dep of depsResult.rows) {
        fulfilledSubRecipes.add(dep.sub_recipe_id);
      }

      // Get updated items to deduct ingredients
      const producedItems = await client.query(
        `SELECT ppi.*, COALESCE(p.name, r.name) as product_name, ppi.base_recipe_id
         FROM production_plan_items ppi
         LEFT JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
         WHERE ppi.plan_id = $1 AND ppi.id = ANY($2) AND ppi.status = 'produced'`,
        [planId, items.map(i => i.planItemId)]
      );

      // Deduct ingredients for produced items
      for (const item of producedItems.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        // Determine recipe: either from product_id (normal) or base_recipe_id (semi-finished)
        let recipeResult;
        if (isSemiFinishedPlan && item.base_recipe_id) {
          recipeResult = await client.query(
            `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.id = $1`,
            [item.base_recipe_id]
          );
        } else {
          recipeResult = await client.query(
            `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.product_id = $1`,
            [item.product_id]
          );
        }
        if (recipeResult.rows[0]) {
          const recipe = recipeResult.rows[0];
          const ingredientNeeds = new Map<string, number>();

          // Recursive ingredient collection — skips sub-recipes already fulfilled from semi-finished stock
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
              // Skip sub-recipes whose semi-finished stock was already consumed
              if (fulfilledSubRecipes.has(sub.sub_recipe_id)) continue;
              await collectNeeds(sub.sub_recipe_id, sub.yield_quantity, (parseFloat(sub.quantity) / yieldQty) * multiplier);
            }
          }

          await collectNeeds(recipe.id, recipe.yield_quantity, item.actual_quantity);

          for (const [ingredientId, consumption] of ingredientNeeds) {
            const storeFilter = storeId ? ' AND store_id = $3' : '';
            const lockFilter = storeId ? ' AND store_id = $2' : '';
            const lockParams: unknown[] = [ingredientId];
            if (storeId) lockParams.push(storeId);

            // Lock row and read current stock before deduction
            const lockResult = await client.query(
              `SELECT current_quantity FROM inventory WHERE ingredient_id = $1${lockFilter} FOR UPDATE`,
              lockParams
            );
            const currentStock = lockResult.rows[0] ? parseFloat(lockResult.rows[0].current_quantity) : 0;
            const actualConsumption = Math.min(consumption, Math.max(currentStock, 0));

            if (actualConsumption < consumption) {
              const ingName = await client.query('SELECT name, unit FROM ingredients WHERE id = $1', [ingredientId]);
              warnings.push(`Stock insuffisant: ${ingName.rows[0]?.name} — disponible ${currentStock.toFixed(2)} ${ingName.rows[0]?.unit || ''}, requis ${consumption.toFixed(2)}`);
            }

            const invParams: unknown[] = [actualConsumption, ingredientId];
            if (storeId) invParams.push(storeId);

            await client.query(
              `UPDATE inventory SET current_quantity = GREATEST(current_quantity - $1, 0), updated_at = NOW()
               WHERE ingredient_id = $2${storeFilter}`, invParams
            );
            await client.query(
              `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
               VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
              [ingredientId, -actualConsumption, `Production partielle: ${item.product_name} x${item.actual_quantity}`, userId, planId, storeId || null]
            );
          }
        }

        // For semi-finished plans: feed semi_finished_stock instead of product stock
        if (isSemiFinishedPlan && item.base_recipe_id) {
          const effectiveStoreId = storeId || planInfo.rows[0]?.store_id || '00000000-0000-0000-0000-000000000000';
          const yieldUnit = recipeResult.rows[0] ? (await client.query(`SELECT yield_unit FROM recipes WHERE id = $1`, [item.base_recipe_id])).rows[0]?.yield_unit || 'unit' : 'unit';

          // Upsert semi_finished_stock
          await client.query(
            `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit, last_produced_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (recipe_id, store_id)
             DO UPDATE SET quantity_available = semi_finished_stock.quantity_available + $3,
                           last_produced_at = NOW(), updated_at = NOW()`,
            [item.base_recipe_id, effectiveStoreId, item.actual_quantity, yieldUnit]
          );

          // Record transaction
          await client.query(
            `INSERT INTO semi_finished_transactions (recipe_id, store_id, type, quantity_change, production_plan_id, performed_by, notes)
             VALUES ($1, $2, 'production', $3, $4, $5, $6)`,
            [item.base_recipe_id, effectiveStoreId, item.actual_quantity, planId, userId,
             `Production semi-fini: ${item.product_name} x${item.actual_quantity}`]
          );

          // Fulfill dependencies pointing to this plan
          await client.query(
            `UPDATE production_plan_dependencies SET status = 'fulfilled'
             WHERE dependency_plan_id = (SELECT id FROM production_plans WHERE id = $1 AND is_semi_finished_plan = true)
               AND status = 'pending'`,
            [planId]
          );
        } else if (item.product_id) {
          // Normal flow: update product stock
          const stockAfter = await adjustProductStock(client, item.product_id, item.actual_quantity, storeId);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
            [item.product_id, item.actual_quantity, stockAfter,
             `Production partielle: ${item.product_name} x${item.actual_quantity}`, planId, userId, storeId || null]
          );
        }

        // Calculate and store expiration date based on shelf_life_days
        if (storeId && item.product_id) {
          const productLifecycle = await client.query(
            `SELECT shelf_life_days, display_life_hours FROM products WHERE id = $1`,
            [item.product_id]
          );
          if (productLifecycle.rows[0]?.shelf_life_days) {
            const { shelf_life_days, display_life_hours } = productLifecycle.rows[0];
            const shelfDays = parseInt(shelf_life_days);
            const displayHours = display_life_hours ? parseInt(display_life_hours) : null;
            const baseTime = producedAt ? `$3::timestamptz` : 'NOW()';
            const params: unknown[] = [item.product_id, storeId];
            if (producedAt) params.push(producedAt);
            const shelfIdx = params.length + 1;
            params.push(shelfDays);
            const expiresExpr = `${baseTime} + ($${shelfIdx} * INTERVAL '1 day')`;
            let displayExpiresExpr = 'NULL';
            if (displayHours !== null) {
              const displayIdx = params.length + 1;
              params.push(displayHours);
              displayExpiresExpr = `${baseTime} + ($${displayIdx} * INTERVAL '1 hour')`;
            }
            await client.query(
              `INSERT INTO product_display_tracking (product_id, store_id, produced_at, expires_at, display_expires_at, status)
               VALUES ($1, $2, ${baseTime}, ${expiresExpr}, ${displayExpiresExpr}, 'active')`,
              params
            );
          }
        }
      }

      // ═══ Auto-complete: if all items are now produced/cancelled (no more pending or in_progress), complete the plan ═══
      const remainingActive = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_items
         WHERE plan_id = $1 AND status IN ('pending', 'in_progress')`,
        [planId]
      );
      const pendingCount = parseInt(remainingActive.rows[0].cnt);
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

        // Mark related pre-orders as 'ready' when plan is auto-completed
        const planResult = await client.query(
          `SELECT plan_date, order_id FROM production_plans WHERE id = $1`, [planId]
        );
        if (planResult.rows[0]) {
          const { plan_date: planDate, order_id: directOrderId } = planResult.rows[0];

          // If plan is directly linked to an order, update that order
          if (directOrderId) {
            await client.query(
              `UPDATE orders SET status = 'ready' WHERE id = $1 AND status = 'in_production'`,
              [directOrderId]
            );
          }

          // Also update any orders matched by date + product
          const planProductIds = await client.query(
            `SELECT DISTINCT product_id FROM production_plan_items WHERE plan_id = $1 AND status IN ('produced', 'transferred', 'received')`,
            [planId]
          );
          const prodIds = planProductIds.rows.map((r: Record<string, unknown>) => r.product_id);
          if (prodIds.length > 0) {
            await client.query(
              `UPDATE orders SET status = 'ready'
               WHERE pickup_date::date = $1::date
                 AND status = 'in_production'
                 AND id IN (
                   SELECT DISTINCT oi.order_id FROM order_items oi
                   WHERE oi.product_id = ANY($2)
                 )`,
              [planDate, prodIds]
            );
          }
        }
      }

      // Persist new warnings
      if (warnings.length > 0) {
        await client.query(
          `UPDATE production_plans SET warnings = COALESCE(warnings, '{}') || $2::text[], updated_at = NOW() WHERE id = $1`,
          [planId, warnings]
        );
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

        // Mark related pre-orders as 'ready' when plan is auto-completed via receive
        const planResult = await client.query(
          `SELECT plan_date, order_id FROM production_plans WHERE id = $1`, [planId]
        );
        if (planResult.rows[0]) {
          const { plan_date: planDate, order_id: directOrderId } = planResult.rows[0];
          if (directOrderId) {
            await client.query(
              `UPDATE orders SET status = 'ready' WHERE id = $1 AND status = 'in_production'`,
              [directOrderId]
            );
          }
          const planProductIds = await client.query(
            `SELECT DISTINCT product_id FROM production_plan_items WHERE plan_id = $1 AND status IN ('produced', 'transferred', 'received')`,
            [planId]
          );
          const prodIds = planProductIds.rows.map((r: Record<string, unknown>) => r.product_id);
          if (prodIds.length > 0) {
            await client.query(
              `UPDATE orders SET status = 'ready'
               WHERE pickup_date::date = $1::date
                 AND status = 'in_production'
                 AND id IN (
                   SELECT DISTINCT oi.order_id FROM order_items oi
                   WHERE oi.product_id = ANY($2)
                 )`,
              [planDate, prodIds]
            );
          }
        }
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

        // Clean up old warnings related to this product
        await client.query(
          `UPDATE production_plans SET warnings = array_remove(warnings, $2), updated_at = NOW() WHERE id = $1`,
          [planId, `"${item.product_name}" mis en liste d'attente — ingredients insuffisants.`]
        );
        await client.query(
          `UPDATE production_plans SET warnings = array_remove(warnings, $2), updated_at = NOW() WHERE id = $1`,
          [planId, `"${item.product_name}" ne peut pas etre restaure — ingredients toujours insuffisants.`]
        );
      }

      if (warnings.length > 0) {
        await client.query(
          `UPDATE production_plans SET warnings = COALESCE(warnings, '{}') || $2::text[], updated_at = NOW() WHERE id = $1`,
          [planId, warnings]
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

      const planResult = await client.query(`SELECT status, store_id FROM production_plans WHERE id = $1`, [planId]);
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

      // If no more active items remain on this plan, release any
      // semi-finished stock that was reserved when the plan was created.
      // Without this, cancelled plans leave stock locked forever.
      const stillActive = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_items
         WHERE plan_id = $1 AND status IN ('pending', 'in_progress')`,
        [planId]
      );
      if (parseInt(stillActive.rows[0].cnt) === 0) {
        await releaseSemiFinishedReservations(client, planId, planResult.rows[0].store_id, 'Liberee (plan annule)');
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

  // ═══ Assign lot numbers in LOT-AAMMJJ-NNN format ═══
  async assignLotNumbers(client: import('pg').PoolClient, planId: string, planDate: string): Promise<void> {
    await assignLotNumbersInternal(client, planId, planDate);
  },

  async analyzeSubRecipes(planId: string) {
    // Get plan items with their recipes
    const itemsResult = await db.query(
      `SELECT ppi.id as plan_item_id, ppi.product_id, ppi.planned_quantity,
              p.name as product_name,
              r.id as recipe_id, r.yield_quantity, r.yield_unit
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.product_id = ppi.product_id
       WHERE ppi.plan_id = $1 AND ppi.status = 'pending'
         AND (ppi.waiting_status IS NULL OR ppi.waiting_status = 'restored')`,
      [planId]
    );

    // For each item, find sub-recipes
    const baseMap = new Map<string, {
      subRecipeId: string;
      subRecipeName: string;
      yieldQuantity: number;
      yieldUnit: string;
      totalNeeded: number;
      usedBy: { planItemId: string; productName: string; quantityNeeded: number }[];
      ingredients: { ingredientId: string; ingredientName: string; unit: string; quantity: number }[];
    }>();

    for (const item of itemsResult.rows) {
      if (!item.recipe_id) continue;

      const subsResult = await db.query(
        `SELECT rsr.sub_recipe_id, rsr.quantity,
                sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
                sr.yield_unit as sub_yield_unit
         FROM recipe_sub_recipes rsr
         JOIN recipes sr ON sr.id = rsr.sub_recipe_id
         WHERE rsr.recipe_id = $1`,
        [item.recipe_id]
      );

      for (const sub of subsResult.rows) {
        const qtyNeeded = (parseFloat(sub.quantity) / item.yield_quantity) * item.planned_quantity;

        const existing = baseMap.get(sub.sub_recipe_id);
        if (existing) {
          existing.totalNeeded += qtyNeeded;
          existing.usedBy.push({
            planItemId: item.plan_item_id,
            productName: item.product_name,
            quantityNeeded: qtyNeeded,
          });
        } else {
          // Get ingredients for this sub-recipe
          const ingsResult = await db.query(
            `SELECT ri.ingredient_id, ing.name as ingredient_name, ing.unit, ri.quantity
             FROM recipe_ingredients ri
             JOIN ingredients ing ON ing.id = ri.ingredient_id
             WHERE ri.recipe_id = $1`,
            [sub.sub_recipe_id]
          );

          baseMap.set(sub.sub_recipe_id, {
            subRecipeId: sub.sub_recipe_id,
            subRecipeName: sub.sub_recipe_name,
            yieldQuantity: parseFloat(sub.sub_yield_quantity),
            yieldUnit: sub.sub_yield_unit || 'unit',
            totalNeeded: qtyNeeded,
            usedBy: [{
              planItemId: item.plan_item_id,
              productName: item.product_name,
              quantityNeeded: qtyNeeded,
            }],
            ingredients: ingsResult.rows.map((ing: any) => ({
              ingredientId: ing.ingredient_id,
              ingredientName: ing.ingredient_name,
              unit: ing.unit,
              quantity: parseFloat(ing.quantity),
            })),
          });
        }
      }
    }

    return [...baseMap.values()];
  },

  async remove(planId: string) {
    await db.query('DELETE FROM production_plans WHERE id = $1', [planId]);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Semi-finished detection: detect sub-recipes, check stock, create dependency plans
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detect semi-finished needs for a production plan.
   * For each product's recipe, find sub-recipes (is_base=true).
   * Check semi_finished_stock. If deficit, create a dependency plan.
   * Consolidate needs when multiple products share the same sub-recipe.
   * Returns created dependency plan IDs (empty if none needed).
   */
  async detectAndCreateSemiFinishedPlans(planId: string, createdBy: string): Promise<{ dependencyPlanIds: string[]; dependencies: { subRecipeName: string; needed: number; fromStock: number; toProduce: number }[] }> {
    const client = await db.getClient();
    const dependencyPlanIds: string[] = [];
    const dependencySummary: { subRecipeName: string; needed: number; fromStock: number; toProduce: number }[] = [];

    try {
      await client.query('BEGIN');

      // 0. Guard: skip if detection already ran for this plan
      const existingDeps = await client.query(
        `SELECT COUNT(*) as cnt FROM production_plan_dependencies WHERE parent_plan_id = $1`,
        [planId]
      );
      if (parseInt(existingDeps.rows[0].cnt) > 0) {
        await client.query('COMMIT');
        return { dependencyPlanIds, dependencies: dependencySummary };
      }

      // 1. Get plan info
      const planResult = await client.query(
        `SELECT id, plan_date, target_role, store_id FROM production_plans WHERE id = $1`,
        [planId]
      );
      if (!planResult.rows[0]) { await client.query('ROLLBACK'); return { dependencyPlanIds, dependencies: dependencySummary }; }
      const plan = planResult.rows[0];

      // 2. Get all plan items with their recipes
      const itemsResult = await client.query(
        `SELECT ppi.id as plan_item_id, ppi.product_id, ppi.planned_quantity,
                p.name as product_name,
                r.id as recipe_id, r.yield_quantity
         FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes r ON r.product_id = ppi.product_id
         WHERE ppi.plan_id = $1 AND ppi.status = 'pending'`,
        [planId]
      );

      // 3. Consolidate sub-recipe needs across all items
      const subRecipeNeeds = new Map<string, {
        subRecipeId: string;
        subRecipeName: string;
        yieldQuantity: number;
        yieldUnit: string;
        totalNeeded: number;
        usedBy: { planItemId: string; productName: string; qty: number }[];
      }>();

      for (const item of itemsResult.rows) {
        if (!item.recipe_id) continue;

        const subsResult = await client.query(
          `SELECT rsr.sub_recipe_id, rsr.quantity,
                  sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
                  sr.yield_unit as sub_yield_unit, sr.is_base
           FROM recipe_sub_recipes rsr
           JOIN recipes sr ON sr.id = rsr.sub_recipe_id
           WHERE rsr.recipe_id = $1 AND sr.is_base = true`,
          [item.recipe_id]
        );

        for (const sub of subsResult.rows) {
          const qtyNeeded = (parseFloat(sub.quantity) / parseFloat(item.yield_quantity)) * parseInt(item.planned_quantity);

          const existing = subRecipeNeeds.get(sub.sub_recipe_id);
          if (existing) {
            existing.totalNeeded += qtyNeeded;
            existing.usedBy.push({ planItemId: item.plan_item_id, productName: item.product_name, qty: qtyNeeded });
          } else {
            subRecipeNeeds.set(sub.sub_recipe_id, {
              subRecipeId: sub.sub_recipe_id,
              subRecipeName: sub.sub_recipe_name,
              yieldQuantity: parseFloat(sub.sub_yield_quantity),
              yieldUnit: sub.sub_yield_unit || 'unit',
              totalNeeded: qtyNeeded,
              usedBy: [{ planItemId: item.plan_item_id, productName: item.product_name, qty: qtyNeeded }],
            });
          }
        }
      }

      if (subRecipeNeeds.size === 0) {
        await client.query('COMMIT');
        return { dependencyPlanIds, dependencies: dependencySummary };
      }

      // 4. For each sub-recipe need, check stock and create dependency if needed
      for (const [subRecipeId, need] of subRecipeNeeds) {
        // Lock the row for update so concurrent plan creations cannot both
        // read the same available qty and over-reserve it. Without FOR UPDATE,
        // two plans reading 2kg in parallel could each reserve 2kg → -2kg.
        const stockResult = await client.query(
          `SELECT COALESCE(quantity_available, 0) as qty
           FROM semi_finished_stock
           WHERE recipe_id = $1 AND (store_id = $2 OR $2 IS NULL)
             AND (expires_at IS NULL OR expires_at > NOW())
           FOR UPDATE`,
          [subRecipeId, plan.store_id]
        );
        const available = stockResult.rows[0] ? parseFloat(stockResult.rows[0].qty) : 0;
        const fromStock = Math.min(available, need.totalNeeded);
        const toProduce = Math.max(0, need.totalNeeded - fromStock);

        dependencySummary.push({
          subRecipeName: need.subRecipeName,
          needed: Math.round(need.totalNeeded * 100) / 100,
          fromStock: Math.round(fromStock * 100) / 100,
          toProduce: Math.round(toProduce * 100) / 100,
        });

        // Reserve stock if available
        if (fromStock > 0) {
          await client.query(
            `UPDATE semi_finished_stock
             SET quantity_available = quantity_available - $1, updated_at = NOW()
             WHERE recipe_id = $2 AND (store_id = $3 OR $3 IS NULL)`,
            [fromStock, subRecipeId, plan.store_id]
          );
          await client.query(
            `INSERT INTO semi_finished_transactions (recipe_id, store_id, type, quantity_change, production_plan_id, performed_by, notes)
             VALUES ($1, $2, 'reservation', $3, $4, $5, $6)`,
            [subRecipeId, plan.store_id || '00000000-0000-0000-0000-000000000000', -fromStock, planId, createdBy,
             `Reserve pour production: ${need.usedBy.map(u => u.productName).join(', ')}`]
          );
        }

        if (toProduce <= 0) {
          // Fully covered by stock — record dependency as fulfilled
          await client.query(
            `INSERT INTO production_plan_dependencies (parent_plan_id, dependency_plan_id, sub_recipe_id, quantity_needed, quantity_from_stock, quantity_to_produce, status)
             VALUES ($1, NULL, $2, $3, $4, 0, 'fulfilled')`,
            [planId, subRecipeId, need.totalNeeded, fromStock]
          );
          continue;
        }

        // 5. Create semi-finished production plan
        const sfPlanResult = await client.query(
          `INSERT INTO production_plans (plan_date, type, notes, created_by, target_role, store_id, is_semi_finished_plan)
           VALUES ($1, 'daily', $2, $3, $4, $5, true) RETURNING id`,
          [plan.plan_date, `Auto — Semi-fini: ${need.subRecipeName}`, createdBy, plan.target_role, plan.store_id]
        );
        const sfPlanId = sfPlanResult.rows[0].id;
        dependencyPlanIds.push(sfPlanId);

        // Create plan item for the semi-finished product
        await client.query(
          `INSERT INTO production_plan_items (plan_id, base_recipe_id, planned_quantity)
           VALUES ($1, $2, $3)`,
          [sfPlanId, subRecipeId, Math.ceil(toProduce)]
        );

        // Record dependency
        await client.query(
          `INSERT INTO production_plan_dependencies (parent_plan_id, dependency_plan_id, sub_recipe_id, quantity_needed, quantity_from_stock, quantity_to_produce, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [planId, sfPlanId, subRecipeId, need.totalNeeded, fromStock, toProduce]
        );
      }

      await client.query('COMMIT');
      return { dependencyPlanIds, dependencies: dependencySummary };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Get all dependencies for a plan (as parent or as dependency).
   */
  async getPlanDependencies(planId: string) {
    const asParent = await db.query(
      `SELECT ppd.*, r.name as sub_recipe_name,
              dp.id as dep_plan_id, dp.status as dep_plan_status, dp.is_semi_finished_plan
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       LEFT JOIN production_plans dp ON dp.id = ppd.dependency_plan_id
       WHERE ppd.parent_plan_id = $1
       ORDER BY ppd.created_at`,
      [planId]
    );
    const asDepOf = await db.query(
      `SELECT ppd.*, r.name as sub_recipe_name,
              pp.id as parent_plan_id
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       JOIN production_plans pp ON pp.id = ppd.parent_plan_id
       WHERE ppd.dependency_plan_id = $1
       ORDER BY ppd.created_at`,
      [planId]
    );
    return { dependencies: asParent.rows, dependencyOf: asDepOf.rows };
  },

  /**
   * Check if a plan has all dependencies fulfilled (can start).
   */
  async checkDependenciesFulfilled(planId: string): Promise<{ allFulfilled: boolean; pending: { subRecipeName: string; status: string; depPlanId: string | null }[] }> {
    const result = await db.query(
      `SELECT ppd.status, ppd.dependency_plan_id, r.name as sub_recipe_name
       FROM production_plan_dependencies ppd
       JOIN recipes r ON r.id = ppd.sub_recipe_id
       WHERE ppd.parent_plan_id = $1 AND ppd.status != 'fulfilled' AND ppd.status != 'cancelled'`,
      [planId]
    );
    return {
      allFulfilled: result.rows.length === 0,
      pending: result.rows.map((r: Record<string, unknown>) => ({
        subRecipeName: r.sub_recipe_name as string,
        status: r.status as string,
        depPlanId: r.dependency_plan_id as string | null,
      })),
    };
  },

  /**
   * When a semi-finished plan completes, fulfill its dependencies and feed stock.
   */
  async fulfillSemiFinishedPlan(planId: string, storeId?: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get all items produced in this semi-finished plan
      const itemsResult = await client.query(
        `SELECT ppi.base_recipe_id, ppi.actual_quantity, r.yield_unit
         FROM production_plan_items ppi
         JOIN recipes r ON r.id = ppi.base_recipe_id
         WHERE ppi.plan_id = $1 AND ppi.status = 'produced' AND ppi.base_recipe_id IS NOT NULL`,
        [planId]
      );

      for (const item of itemsResult.rows) {
        const qty = parseFloat(item.actual_quantity);
        if (qty <= 0) continue;

        const effectiveStoreId = storeId || '00000000-0000-0000-0000-000000000000';

        // Upsert semi_finished_stock
        await client.query(
          `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit, last_produced_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (recipe_id, store_id)
           DO UPDATE SET quantity_available = semi_finished_stock.quantity_available + $3,
                         last_produced_at = NOW(), updated_at = NOW()`,
          [item.base_recipe_id, effectiveStoreId, qty, item.yield_unit || 'unit']
        );

        // Record transaction
        await client.query(
          `INSERT INTO semi_finished_transactions (recipe_id, store_id, type, quantity_change, production_plan_id, notes)
           VALUES ($1, $2, 'production', $3, $4, 'Production semi-fini terminee')`,
          [item.base_recipe_id, effectiveStoreId, qty, planId]
        );
      }

      // Mark all dependencies pointing to this plan as fulfilled
      await client.query(
        `UPDATE production_plan_dependencies SET status = 'fulfilled'
         WHERE dependency_plan_id = $1 AND status = 'pending'`,
        [planId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ═══════════ ACTIVITY FEED ═══════════

  async addActivity(planId: string, activityType: string, message: string, createdBy?: string) {
    const result = await db.query(
      `INSERT INTO production_plan_activity (plan_id, activity_type, message, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [planId, activityType, message, createdBy || null]
    );
    return result.rows[0];
  },

  async getActivities(planId: string) {
    const result = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.role
       FROM production_plan_activity a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.plan_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [planId]
    );
    return result.rows;
  },
};

/**
 * Release semi_finished_stock reservations held by `planId` (fulfilled deps
 * with quantity_from_stock > 0). Refunds the reserved qty back to
 * semi_finished_stock, marks the dep as 'cancelled', and logs a transaction.
 *
 * Must be called from within a transaction.
 */
async function releaseSemiFinishedReservations(
  client: import('pg').PoolClient,
  planId: string,
  storeId: string | null,
  reason: string,
): Promise<void> {
  const depsResult = await client.query(
    `SELECT id, sub_recipe_id, quantity_from_stock
     FROM production_plan_dependencies
     WHERE parent_plan_id = $1 AND status = 'fulfilled' AND quantity_from_stock > 0`,
    [planId],
  );
  for (const dep of depsResult.rows) {
    const qty = parseFloat(dep.quantity_from_stock);
    if (qty <= 0) continue;

    await client.query(
      `UPDATE semi_finished_stock
       SET quantity_available = quantity_available + $1, updated_at = NOW()
       WHERE recipe_id = $2 AND (store_id = $3 OR $3 IS NULL)`,
      [qty, dep.sub_recipe_id, storeId],
    );
    await client.query(
      `INSERT INTO semi_finished_transactions (recipe_id, store_id, type, quantity_change, production_plan_id, notes)
       VALUES ($1, $2, 'release', $3, $4, $5)`,
      [dep.sub_recipe_id, storeId || '00000000-0000-0000-0000-000000000000', qty, planId, reason],
    );
    await client.query(
      `UPDATE production_plan_dependencies
       SET status = 'cancelled', quantity_from_stock = 0
       WHERE id = $1`,
      [dep.id],
    );
  }
}

async function assignLotNumbersInternal(client: import('pg').PoolClient, planId: string, planDate: string | Date): Promise<void> {
  // Get items that don't yet have lot numbers
  const itemsResult = await client.query(
    `SELECT ppi.id FROM production_plan_items ppi
     LEFT JOIN production_lot_numbers pln ON pln.plan_item_id = ppi.id
     WHERE ppi.plan_id = $1 AND ppi.status != 'cancelled' AND pln.id IS NULL
     ORDER BY ppi.id`,
    [planId]
  );

  if (itemsResult.rows.length === 0) return;

  const date = planDate instanceof Date ? planDate : new Date(planDate);
  const dateStr = `${String(date.getFullYear() % 100).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

  // Format planDate as ISO string for the query (lot_date is DATE column)
  const lotDateStr = date.toISOString().slice(0, 10);

  // Advisory lock prevents concurrent confirms from generating duplicate LOT numbers
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('lot_number_' || $1))`, [lotDateStr]);
  // Get current max sequence for this date
  const seqResult = await client.query(
    `SELECT COALESCE(MAX(sequence_number), 0) as max_seq FROM production_lot_numbers WHERE lot_date = $1`,
    [lotDateStr]
  );
  let seq = parseInt(seqResult.rows[0].max_seq);

  for (const item of itemsResult.rows) {
    seq++;
    const lotNumber = `LOT-${dateStr}-${String(seq).padStart(3, '0')}`;
    await client.query(
      `INSERT INTO production_lot_numbers (plan_item_id, plan_id, lot_number, lot_date, sequence_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.id, planId, lotNumber, lotDateStr, seq]
    );
  }
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
