import { db } from '../config/database.js';
import { format } from 'date-fns';
import { adjustProductStock } from './product-stock.helper.js';
import { productMaterialsUnitCost } from './product-cost.helper.js';
import { ingredientLotRepository } from './ingredient-lot.repository.js';
import { bonSortieRepository } from './bon-sortie.repository.js';
import { notificationRepository } from './notification.repository.js';
import { getLocalNow } from '../utils/timezone.js';
import { productionEtapesRepository } from './production-etapes.repository.js';
import { productLotRepository } from './product-lot.repository.js';
import { packagingItemRepository } from './packaging-item.repository.js';
import { setActor, setReason, transitionPlan, transitionBon, withActor } from '../services/production-state.js';
import { collectIngredientNeedsForUnits, getCompositionForNeeds } from './recipe-composition.helper.js';

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
              -- Articles relancables (annules ou en liste d'attente) : pilote le bouton "Relancer"
              (SELECT COUNT(*) FROM production_plan_items
                WHERE plan_id = pp.id AND (status = 'cancelled' OR waiting_status = 'waiting')) as relaunchable_count,
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
              p.shelf_life_days, p.display_life_hours, p.is_reexposable, p.is_recyclable,
              p.sale_type, p.sale_unit, p.cost_price,
              pdt.produced_at, pdt.expires_at, pdt.display_expires_at,
              pst.created_at as production_timestamp,
              pu.first_name as produced_by_first_name, pu.last_name as produced_by_last_name,
              su.first_name as started_by_first_name, su.last_name as started_by_last_name,
              pln.lot_number,
              br.name as base_recipe_name, br.yield_unit as base_recipe_unit,
              pc.nom as contenant_nom, pc.type_production as contenant_type,
              -- Format de production (recipe_formats) si l'item est multi-format
              rf.quantite_par_format as format_qte_par_unite,
              rf.quantite_par_format_unite as format_unite,
              rf.nb_par_defaut as format_nb_par_defaut,
              fpc.nom as format_nom,
              -- Coupe (mig 302) : format applicable (contenant, rendement), suggestions
              -- de sorties et ce qui a ete reellement sorti a la production.
              cf.cut_format_id, cf.cut_rendement, cf.cut_contenant_nom,
              -- Suggestions : sorties deja utilisees pour ce produit (derniere equivalence connue).
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'product_id', h.product_id, 'label', h.label, 'equiv_pieces', h.equiv_pieces)), '[]'::jsonb)
                 FROM (
                   SELECT DISTINCT ON (io2.product_id) io2.product_id, p3.name AS label, io2.equiv_pieces
                     FROM production_item_outputs io2
                     JOIN production_plan_items i2 ON i2.id = io2.plan_item_id
                     JOIN products p3 ON p3.id = io2.product_id
                    WHERE i2.product_id = ppi.product_id AND io2.product_id <> ppi.product_id
                    ORDER BY io2.product_id, io2.created_at DESC
                 ) h) AS cut_presets,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'label', io.label, 'quantity', io.quantity, 'equiv_pieces', io.equiv_pieces,
                        'lot_number', pl2.lot_number) ORDER BY io.id), '[]'::jsonb)
                 FROM production_item_outputs io LEFT JOIN product_lots pl2 ON pl2.id = io.product_lot_id
                WHERE io.plan_item_id = ppi.id) AS outputs
       FROM production_plan_items ppi
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes br ON br.id = ppi.base_recipe_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN production_contenants pc ON pc.id = ppi.contenant_id
       LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
       LEFT JOIN production_contenants fpc ON fpc.id = rf.contenant_id
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
       LEFT JOIN LATERAL (
         SELECT rf2.id AS cut_format_id, rf2.nb_par_defaut AS cut_rendement, pc2.nom AS cut_contenant_nom
           FROM recipe_formats rf2
           JOIN recipes r2 ON r2.id = rf2.recipe_id
           LEFT JOIN production_contenants pc2 ON pc2.id = rf2.contenant_id
          WHERE rf2.is_active AND ppi.product_id IS NOT NULL
            AND (rf2.id = ppi.format_id
                 OR (ppi.format_id IS NULL AND (rf2.product_id = ppi.product_id
                                                OR (r2.product_id = ppi.product_id AND rf2.is_default))))
          ORDER BY (rf2.id = ppi.format_id) DESC NULLS LAST,
                   (rf2.product_id = ppi.product_id) DESC NULLS LAST, rf2.is_default DESC
          LIMIT 1
       ) cf ON true
       WHERE ppi.plan_id = $1
       ORDER BY p.name`,
      [id]
    );

    // available_quantity calcule en temps reel a partir de ingredient_lots, en utilisant
    // exactement la meme source que la generation du BSI (bon-sortie.repository#generate) :
    //   - pesage_quantity des lots actifs/expires (consommable directement)
    //   - economat_quantity des lots actifs (transferable au pesage)
    // Cela garantit que l'affichage "Besoins en ingredients" reflete ce que le BSI
    // trouvera reellement au moment de la generation, et tient compte des reapprovisionnements
    // sans necessiter de rafraichir le snapshot de production_ingredient_needs.
    const needsResult = await db.query(
      `SELECT pin.*,
              COALESCE((
                SELECT SUM(
                  CASE WHEN il.status IN ('active', 'expired') THEN COALESCE(il.pesage_quantity, 0) ELSE 0 END
                  + CASE WHEN il.status = 'active' THEN COALESCE(il.economat_quantity, 0) ELSE 0 END
                )
                FROM ingredient_lots il
                WHERE il.ingredient_id = pin.ingredient_id
                  AND il.store_id = (SELECT store_id FROM production_plans WHERE id = pin.plan_id)
              ), 0) as available_quantity,
              ing.name as ingredient_name, ing.unit,
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
    // Multi-format : un item peut avoir formats[] (chaque entry = 1 plan_item avec son format_id).
    // Si pas de formats fournis, on cree 1 ligne legacy avec format_id NULL (compat descendante).
    items: {
      productId: string;
      plannedQuantity: number;
      notes?: string;
      formats?: { formatId: string; plannedQuantity: number; notes?: string }[];
    }[];
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
        // Mode multi-format : une ligne par format choisi
        if (item.formats && item.formats.length > 0) {
          for (const fmt of item.formats) {
            await client.query(
              `INSERT INTO production_plan_items (plan_id, product_id, format_id, planned_quantity, notes)
               VALUES ($1, $2, $3, $4, $5)`,
              [planId, item.productId, fmt.formatId, fmt.plannedQuantity, fmt.notes || item.notes || null]
            );
          }
        } else {
          // Mode legacy : 1 ligne par (plan, product), format_id NULL
          await client.query(
            `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
             VALUES ($1, $2, $3, $4)`,
            [planId, item.productId, item.plannedQuantity, item.notes || null]
          );
        }
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

  async updateItems(planId: string, items: {
    productId: string;
    plannedQuantity: number;
    notes?: string;
    formats?: { formatId: string; plannedQuantity: number; notes?: string }[];
  }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM production_plan_items WHERE plan_id = $1', [planId]);
      for (const item of items) {
        if (item.formats && item.formats.length > 0) {
          for (const fmt of item.formats) {
            await client.query(
              `INSERT INTO production_plan_items (plan_id, product_id, format_id, planned_quantity, notes)
               VALUES ($1, $2, $3, $4, $5)`,
              [planId, item.productId, fmt.formatId, fmt.plannedQuantity, fmt.notes || item.notes || null]
            );
          }
        } else {
          await client.query(
            `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, notes)
             VALUES ($1, $2, $3, $4)`,
            [planId, item.productId, item.plannedQuantity, item.notes || null]
          );
        }
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

  async confirm(planId: string, userId?: string) {
    // F-044 (modele B) — On detecte les semi-finis AVANT de calculer les besoins,
    // pour que le BSI du parent n'aplatisse PAS en matieres les bases qui sont
    // produites separement (plan fils) ou servies depuis le stock semi-fini.
    // Idempotente (guard sur dependances existantes) et best-effort : si elle
    // echoue ou ne cree aucune dependance, aucune base n'est "sautee" et le parent
    // consomme les matieres comme avant — donc jamais de sous-consommation.
    if (userId) {
      try {
        const semi = await db.query(`SELECT COALESCE(is_semi_finished_plan, false) AS s FROM production_plans WHERE id = $1`, [planId]);
        if (semi.rows[0] && semi.rows[0].s !== true) {
          await productionRepository.detectAndCreateSemiFinishedPlans(planId, userId);
        }
      } catch (detErr) {
        console.error('[production.confirm] detection semi-finis (modele B) echouee:', detErr);
      }
    }

    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');
      await setActor(client, userId, 'Confirmation du plan');
      // Verrou : deux confirmations simultanees se serialisent ici (la 2e echoue
      // sur la transition au lieu de remettre le plan en 'confirmed').
      await client.query(`SELECT id FROM production_plans WHERE id = $1 FOR UPDATE`, [planId]);

      // Verrou de transition : le controleur a lu le statut hors transaction, on
      // le relit sous FOR UPDATE pour que deux confirm concurrents ne generent
      // pas deux fois les besoins / le BSI / les numeros de lot.
      const lockResult = await client.query(
        `SELECT status FROM production_plans WHERE id = $1 FOR UPDATE`,
        [planId]
      );
      if (lockResult.rows.length === 0) throw new Error('Plan introuvable');
      if (lockResult.rows[0].status !== 'draft') {
        throw new Error(`Le plan est deja en statut "${lockResult.rows[0].status}" : il ne peut pas etre confirme une seconde fois.`);
      }

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

      // Calculate ingredient needs per ingredient per product.
      // La nomenclature est resolue par le helper (legacy OU compose) : les
      // quantites arrivent deja converties en unite de base de l'ingredient
      // pour que l'agregation et les consommateurs aval (BSI, FEFO) comparent
      // des kg avec des kg.
      const needsMap = new Map<string, { ingredientId: string; productId: string; quantity: number }>();
      let semiFlag: boolean | null = null;
      const isSemiFinishedPlanQ = async () => {
        if (semiFlag === null) {
          const r = await client.query(`SELECT COALESCE(is_semi_finished_plan, false) AS is_semi FROM production_plans WHERE id = $1`, [planId]);
          semiFlag = r.rows[0]?.is_semi === true;
        }
        return semiFlag;
      };

      // F-044 (modele B) — Bases produites separement : la detection a cree une
      // dependance (reservation stock + eventuel plan fils) pour chacune. On ne
      // developpe donc PAS ces bases en matieres dans le BSI du parent (sinon
      // double comptage). Une base sans dependance (detection non lancee / plan
      // manuel non detecte) reste developpee : le parent consomme ses matieres.
      const depRes = await client.query(
        `SELECT sub_recipe_id FROM production_plan_dependencies WHERE parent_plan_id = $1`,
        [planId]
      );
      const baseDepSet = new Set<string>(depRes.rows.map((r) => r.sub_recipe_id as string));

      for (const item of itemsResult.rows) {
        const recipeResult = await client.query(
          RECIPE_FOR_PRODUCT_SQL,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) {
          if (!(await isSemiFinishedPlanQ())) {
            warnings.push(`Le produit "${item.product_name}" n'a pas de recette, ignoré pour les besoins en ingrédients.`);
          }
          continue;
        }
        const productId = item.product_id as string;
        await collectIngredientNeedsForUnits(
          client, recipeResult.rows[0].id, parseInt(item.planned_quantity),
          (ingredientId, qty) => {
            const key = `${ingredientId}::${productId}`;
            const existing = needsMap.get(key);
            if (existing) existing.quantity += qty;
            else needsMap.set(key, { ingredientId, productId, quantity: qty });
          },
          {
            formatId: item.format_id ?? recipeResult.rows[0].linked_format_id ?? null,
            skipSubRecipe: (subRecipeId) => baseDepSet.has(subRecipeId),
            warnings,
          }
        );
      }

      // Un plan semi-fini n'a pas de besoins propres (ils sont portes par le BSI du
      // plan parent) : pas d'alerte dans ce cas.
      if (needsMap.size === 0 && itemsResult.rows.length > 0 && !(await isSemiFinishedPlanQ())) {
        warnings.push(`Aucun besoin ingrédient calculé pour ce plan : vérifier la composition des recettes (aucun bon de sortie ne sera généré).`);
      }

      // Delete any previous needs (in case of re-confirmation)
      await client.query('DELETE FROM production_ingredient_needs WHERE plan_id = $1', [planId]);

      // Insert ingredient needs with availability snapshot (per product)
      // First, get availability for all ingredients
      const ingredientIds = [...new Set([...needsMap.values()].map(n => n.ingredientId))];

      // F-016 — Les ingredients non stockes (eau au robinet…) sont exclus des
      // besoins : sinon chaque plan genere une ligne BSI en RUPTURE et « A
      // commander » propose d'en acheter. Leur cout matieres reste porte par les
      // vues de cout (recipe_ingredients), seul le flux stock/achat les ignore.
      const nonStockeIds = new Set<string>();
      if (ingredientIds.length > 0) {
        const ns = await client.query(
          `SELECT id FROM ingredients WHERE id = ANY($1::uuid[]) AND non_stocke = true`,
          [ingredientIds]
        );
        for (const r of ns.rows) nonStockeIds.add(r.id as string);
      }

      const availabilityMap = new Map<string, number>();
      for (const ingId of ingredientIds) {
        const invResult = await client.query(
          `SELECT COALESCE(SUM(current_quantity), 0) as total_quantity FROM inventory WHERE ingredient_id = $1`,
          [ingId]
        );
        availabilityMap.set(ingId, parseFloat(invResult.rows[0].total_quantity));
      }

      for (const entry of needsMap.values()) {
        if (nonStockeIds.has(entry.ingredientId)) continue;   // F-016 : eau & co. non stockes
        const available = availabilityMap.get(entry.ingredientId) || 0;
        await client.query(
          `INSERT INTO production_ingredient_needs (plan_id, ingredient_id, needed_quantity, available_quantity, product_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [planId, entry.ingredientId, entry.quantity, available, entry.productId]
        );
      }

      // La verification de disponibilite des ingredients est faite par le magasinier
      // au moment du pesage (bon de sortie), pas a la confirmation du plan.

      // Update plan status and persist warnings
      await transitionPlan(client, planId, 'confirmed', { extraSet: 'confirmed_at = NOW(), warnings = $2', params: [warnings] });

      // Assign lot numbers (LOT-AAMMJJ-NNN) to plan items
      const planDateResult = await client.query(`SELECT plan_date, store_id FROM production_plans WHERE id = $1`, [planId]);
      if (planDateResult.rows[0]) {
        await assignLotNumbersInternal(client, planId, planDateResult.rows[0].plan_date);
      }

      await client.query('COMMIT');

      // ═══ Phase 3: auto-generation du BSI + notification magasinier ═══
      // Workflow : la confirmation du plan genere automatiquement le BSI en statut 'genere'.
      // Le magasinier recoit une notification et prend en charge la preparation des ingredients.
      // Le chef suit l'avancement dans le sous-onglet "Gestion du bon de sortie".
      try {
        const storeId = planDateResult.rows[0]?.store_id as string | undefined;
        if (storeId && userId && needsMap.size > 0) {
          const bsi = await bonSortieRepository.generate(planId, storeId, userId);
          if (bsi?.id) {
            // Transition cycle de vie (delta v1 point 1) : BSI genere -> le plan
            // entre en phase "en attente ingredients" jusqu'a ce que le magasinier
            // marque la preparation comme prete.
            await withActor(userId, (c) => transitionPlan(c, planId, 'awaiting_ingredients'), `Bon de sortie ${bsi.numero} genere`);

            // Notification aux magasiniers du store : nouveau BSI a preparer.
            // Non-bloquant : si le systeme de notifs echoue, la confirmation du plan reste OK.
            try {
              await notificationRepository.create({
                targetRole: 'magasinier',
                storeId,
                type: 'bsi_generated',
                title: 'Nouvelle demande d\'ingredients',
                message: `BSI ${bsi.numero || ''} a preparer en economat`,
                referenceType: 'bon_sortie',
                referenceId: bsi.id as string,
                createdBy: userId,
              });
            } catch (notifErr) {
              console.error('[production.confirm] notification BSI non emise:', notifErr);
            }
          }
        }
      } catch (bsiErr: any) {
        // Etat metier legitime : plan sans recette/besoin -> on ne cree pas de BSI mais on laisse
        // passer la confirmation. Les vraies erreurs techniques sont loguees.
        const msg = bsiErr?.message || '';
        if (msg.startsWith('Aucun besoin') || msg.startsWith('Bon deja') || msg.startsWith('Ce bon')) {
          warnings.push('Aucun bon de sortie a generer (plan sans ingredient a prelever).');
        } else {
          console.error('[production.confirm] BSI auto-gen echoue:', bsiErr);
          warnings.push('Le bon de sortie n\'a pas pu etre genere automatiquement. Regenerez-le manuellement.');
        }
      }

      return { warnings, waitingProductIds: [] as string[] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Revert un plan confirmed -> draft pour permettre des modifications.
   *  Conditions :
   *   - status doit etre 'confirmed' (pas in_progress, completed, etc.)
   *   - aucun item ne doit avoir commence ('in_progress' ou 'produced')
   *   - le BSI (s'il existe) ne doit pas etre preleve/verifie/cloture
   *  Effets :
   *   - supprime le BSI (status 'genere') et ses lignes
   *   - supprime production_ingredient_needs (sera recree au prochain confirm)
   *   - status plan -> 'draft', confirmed_at -> NULL
   *  Les production_plan_dependencies (semi-finis) restent : le prochain
   *  confirm les re-evaluera.
   */
  async revertToDraft(planId: string, userId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId, 'Retour en brouillon');

      // 1) Verifie l'etat du plan
      const planResult = await client.query(
        `SELECT id, status, confirmed_at FROM production_plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );
      if (planResult.rows.length === 0) {
        throw new Error('Plan introuvable');
      }
      const planStatus = planResult.rows[0].status as string;
      if (planStatus !== 'confirmed') {
        throw new Error(`Le plan est en statut "${planStatus}". Seul un plan confirme peut etre repasse en brouillon.`);
      }

      // 2) Verifie qu'aucun item n'a commence
      const startedItems = await client.query(
        `SELECT COUNT(*)::int AS nb FROM production_plan_items
         WHERE plan_id = $1 AND status IN ('in_progress', 'produced')`,
        [planId],
      );
      if (startedItems.rows[0].nb > 0) {
        throw new Error('Impossible : au moins un produit a deja ete demarre ou produit. Annulez d\'abord les items en cours.');
      }

      // 3) Verifie l'etat du BSI : refuse si le prelevement est engage
      //    (prelevement / verifie / cloture). 'preleve' est un statut de LIGNE,
      //    pas de bon — l'ancien filtre ne bloquait jamais un BSI en 'prelevement'.
      const bsiActive = await client.query(
        `SELECT COUNT(*)::int AS nb FROM production_bons_sortie
         WHERE plan_id = $1 AND status IN ('prelevement', 'verifie', 'cloture')`,
        [planId],
      );
      if (bsiActive.rows[0].nb > 0) {
        throw new Error('Impossible : le bon de sortie a deja ete preleve. Annulez d\'abord le BSI.');
      }

      // 4) Supprime les BSI non engages (genere, en preparation, pret, annule) :
      //    un BSI en preparation/pret survivant au retour en brouillon bloquait
      //    la regeneration au prochain confirm ("Bon deja genere").
      const bsiToDelete = await client.query(
        `SELECT id, status FROM production_bons_sortie
         WHERE plan_id = $1 AND status IN ('genere', 'preparation', 'preparation_partielle', 'pret', 'annule')`,
        [planId],
      );
      // Annulation LOGIQUE (mig 300) : le bon et ses lignes restent en base pour
      // l'audit, avec auteur et motif ; la generation suivante ignore les 'annule'.
      await setReason(client, 'Retour en brouillon du plan');
      for (const row of bsiToDelete.rows) {
        await client.query(`UPDATE production_plans SET bon_sortie_id = NULL WHERE bon_sortie_id = $1`, [row.id]);
        if (row.status !== 'annule') {
          await transitionBon(client, row.id, 'annule', {
            extraSet: "cancelled_by = $2, cancelled_at = NOW(), cancel_reason = 'Retour en brouillon du plan'", params: [userId || null],
          });
        }
      }

      // 5) Supprime les besoins en ingredients (recalcules au prochain confirm)
      await client.query(`DELETE FROM production_ingredient_needs WHERE plan_id = $1`, [planId]);

      // 6) Plan -> draft, confirmed_at -> NULL, warnings nettoye
      await transitionPlan(client, planId, 'draft', { extraSet: 'confirmed_at = NULL, warnings = NULL' });

      await client.query('COMMIT');
      return { reverted: true, bsiDeleted: bsiToDelete.rows.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Relance un plan bloque, quelle que soit la cause du blocage. Aucun nouveau
   *  plan n'est cree : c'est CE plan qui repart.
   *
   *  Deux causes de blocage sont traitees, cumulables :
   *   a) des articles ont ete annules (cloture partielle) ou mis en liste d'attente
   *      -> ils reviennent en 'pending'
   *   b) le plan a ete confirme sur un referentiel incomplet — produit sans recette,
   *      composition vide — donc aucun besoin ingredient n'a ete calcule et aucun BSI
   *      genere. Une fois la recette creee, le plan reste fige sur son ancien calcul.
   *      -> les besoins sont RECALCULES et le BSI regenere depuis les recettes actuelles
   *
   *  Eligibilite : tout plan sauf un brouillon (un brouillon se confirme, il n'y a
   *  rien a relancer).
   *
   *  Le recalcul (b) n'est possible que si la preparation n'est pas engagee :
   *  aucun article demarre/produit et aucun BSI preleve, verifie ou cloture — sinon
   *  on retoucherait un prelevement deja fait. Dans ce cas seul (a) s'applique et un
   *  warning l'explique.
   *
   *  Ce qui n'est PAS refait : les articles deja produits restent produits (stock et
   *  cout intacts), et les reservations de semi-finis liberees a l'annulation ne sont
   *  pas reprises — un warning le signale.
   */
  async relaunch(planId: string, userId?: string, itemIds?: string[]) {
    const client = await db.getClient();
    const warnings: string[] = [];
    let recomputeNeeds = false;
    let relaunchedIds: string[] = [];
    try {
      await client.query('BEGIN');
      await setActor(client, userId, 'Relance du plan');

      const planResult = await client.query(
        `SELECT id, status, store_id, plan_date, is_semi_finished_plan
         FROM production_plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );
      if (planResult.rows.length === 0) throw new Error('Plan introuvable');
      const plan = planResult.rows[0];
      const planStatus = plan.status as string;

      if (planStatus === 'draft') {
        throw new Error('Ce plan est un brouillon : confirmez-le, il n\'y a rien a relancer.');
      }

      // 1) Articles a reactiver : annules ou en liste d'attente. Peut etre vide —
      //    un plan confirme sans recette n'a aucun article annule, c'est son calcul
      //    de besoins qui est a refaire (cas b).
      //    itemIds optionnel = relance ciblee, sinon tout ce qui est relancable.
      const targetFilter = itemIds && itemIds.length > 0 ? ' AND ppi.id = ANY($2)' : '';
      const targetParams: unknown[] = itemIds && itemIds.length > 0 ? [planId, itemIds] : [planId];
      const targetsResult = await client.query(
        `SELECT ppi.id, ppi.product_id, ppi.status, ppi.waiting_status,
                COALESCE(p.name, br.name) as product_name
         FROM production_plan_items ppi
         LEFT JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes br ON br.id = ppi.base_recipe_id
         WHERE ppi.plan_id = $1
           AND (ppi.status = 'cancelled' OR ppi.waiting_status = 'waiting')${targetFilter}`,
        targetParams,
      );
      const targetIds = targetsResult.rows.map((r: Record<string, unknown>) => r.id as string);
      relaunchedIds = targetIds;

      // 2) Le recalcul des besoins n'est sur que tant que la preparation n'est pas
      //    engagee : un BSI preleve a deja sorti du stock, on n'y retouche pas.
      const engagedResult = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM production_plan_items
             WHERE plan_id = $1 AND status IN ('in_progress', 'produced', 'transferred', 'received')) AS started,
           (SELECT COUNT(*)::int FROM production_bons_sortie
             WHERE plan_id = $1 AND status IN ('prelevement', 'verifie', 'cloture')) AS bsi_engaged`,
        [planId],
      );
      const startedItems = engagedResult.rows[0].started as number;
      const bsiEngaged = engagedResult.rows[0].bsi_engaged as number;
      recomputeNeeds = startedItems === 0 && bsiEngaged === 0;

      if (targetIds.length === 0 && !recomputeNeeds) {
        throw new Error(
          'Rien a relancer : aucun article annule ou en attente, et la preparation est deja engagee (production demarree ou bon de sortie preleve).'
        );
      }
      if (!recomputeNeeds) {
        warnings.push(
          startedItems > 0
            ? 'Besoins et bon de sortie non recalcules : la production a deja demarre sur ce plan.'
            : 'Besoins et bon de sortie non recalcules : le bon de sortie a deja ete preleve.'
        );
      }

      // 2) Reactivation : annule -> pending, sortie de liste d'attente.
      if (targetIds.length > 0) {
        await client.query(
          `UPDATE production_plan_items
           SET status = CASE WHEN status = 'cancelled' THEN 'pending' ELSE status END,
               waiting_status = NULL,
               cancelled_at = NULL,
               cancellation_reason = NULL
           WHERE plan_id = $1 AND id = ANY($2)`,
          [planId, targetIds],
        );
      }

      // 3) Preparation non engagee : on efface le BSI obsolete (genere / annule) pour
      //    que la re-confirmation, apres COMMIT, en produise un a jour. Les besoins
      //    eux-memes sont purges par confirm().
      //    Preparation engagee : on se contente de rafraichir l'instantane de dispo
      //    de production_ingredient_needs et de signaler ce qui manque encore
      //    (non bloquant — le magasinier tranchera au prelevement).
      if (recomputeNeeds) {
        // Annulation logique (mig 300) : on garde le bon pour l'audit.
        const bsiToCancel = await client.query(
          `SELECT id FROM production_bons_sortie WHERE plan_id = $1 AND status = 'genere'`,
          [planId],
        );
        await setReason(client, 'Relance : bon de sortie regenere');
        for (const row of bsiToCancel.rows) {
          await client.query(`UPDATE production_plans SET bon_sortie_id = NULL WHERE bon_sortie_id = $1`, [row.id]);
          await transitionBon(client, row.id, 'annule', {
            extraSet: "cancelled_by = $2, cancelled_at = NOW(), cancel_reason = 'Relance : bon de sortie regenere'", params: [userId || null],
          });
        }
      } else {
        const needsResult = await client.query(
          `SELECT pin.ingredient_id, pin.product_id, pin.needed_quantity,
                  COALESCE((SELECT SUM(current_quantity) FROM inventory WHERE ingredient_id = pin.ingredient_id), 0) as current_available,
                  i.name as ingredient_name
           FROM production_ingredient_needs pin
           JOIN ingredients i ON i.id = pin.ingredient_id
           WHERE pin.plan_id = $1`,
          [planId],
        );
        const targetProductIds = new Set(targetsResult.rows.map((r: Record<string, unknown>) => r.product_id as string));
        const shortIngredients = new Set<string>();
        for (const need of needsResult.rows) {
          await client.query(
            `UPDATE production_ingredient_needs SET available_quantity = $1
             WHERE plan_id = $2 AND ingredient_id = $3
               AND (product_id = $4 OR ($4 IS NULL AND product_id IS NULL))`,
            [need.current_available, planId, need.ingredient_id, need.product_id],
          );
          const isTargetProduct = !need.product_id || targetProductIds.has(need.product_id as string);
          if (isTargetProduct && parseFloat(need.current_available) < parseFloat(need.needed_quantity)) {
            shortIngredients.add(need.ingredient_name as string);
          }
        }
        if (shortIngredients.size > 0) {
          warnings.push(`Stock encore insuffisant sur : ${[...shortIngredients].join(', ')}.`);
        }
      }

      // 4) Semi-finis : les reservations liberees a l'annulation ne sont pas reprises.
      const cancelledDeps = await client.query(
        `SELECT r.name FROM production_plan_dependencies ppd
         JOIN recipes r ON r.id = ppd.sub_recipe_id
         WHERE ppd.parent_plan_id = $1 AND ppd.status = 'cancelled'`,
        [planId],
      );
      if (cancelledDeps.rows.length > 0) {
        const names = cancelledDeps.rows.map((r: Record<string, unknown>) => r.name as string).join(', ');
        warnings.push(`Semi-finis liberes a l'annulation (${names}) — verifiez leur stock avant de produire.`);
      }

      // 5) Numeros de lot pour les articles reactives (ils en etaient prives tant
      //    qu'ils etaient annules).
      await assignLotNumbersInternal(client, planId, plan.plan_date);

      // 6) Statut. Quand les besoins sont recalcules, c'est confirm() (apres COMMIT)
      //    qui positionnera le statut — on se contente ici d'effacer les marqueurs de
      //    cloture. Sinon on le deduit de l'etat du BSI :
      //    BSI cloture / aucun BSI      -> in_progress si la production avait demarre, statut inchange sinon
      //    BSI 'pret'                   -> ready_to_produce
      //    BSI en cours de preparation  -> awaiting_ingredients
      const wasStarted = planStatus === 'in_progress' || planStatus === 'completed';
      let newStatus = planStatus;
      if (!recomputeNeeds) {
        const bsiResult = await client.query(
          `SELECT status FROM production_bons_sortie
           WHERE plan_id = $1 AND status != 'annule'
           ORDER BY created_at DESC LIMIT 1`,
          [planId],
        );
        const bsiStatus = bsiResult.rows[0]?.status as string | undefined;
        if (bsiStatus && bsiStatus !== 'cloture') {
          newStatus = bsiStatus === 'pret' ? 'ready_to_produce' : 'awaiting_ingredients';
          if (wasStarted) {
            warnings.push('Le bon de sortie n\'est pas cloture : le plan repasse en attente des ingredients.');
          }
        } else if (wasStarted) {
          newStatus = 'in_progress';
        }
      } else if (wasStarted) {
        warnings.push('Preparation reconstruite : le plan repasse en amont du cycle (confirme / en attente des ingredients).');
      }

      const relaunchSet = 'completed_at = NULL, completion_type = NULL, cancelled_at = NULL, cancellation_reason = NULL, warnings = $2';
      if (newStatus !== planStatus) {
        await transitionPlan(client, planId, newStatus as any, { extraSet: relaunchSet, params: [warnings.length > 0 ? warnings : null] });
      } else {
        await client.query(
          `UPDATE production_plans SET ${relaunchSet}, updated_at = NOW() WHERE id = $1`,
          [planId, warnings.length > 0 ? warnings : null],
        );
      }

      // 7) Journal du plan : la relance doit rester tracable (qui, quoi, quand).
      const relaunchedNames = targetsResult.rows
        .map((r: Record<string, unknown>) => r.product_name as string)
        .filter(Boolean)
        .join(', ');
      const journal = targetIds.length > 0
        ? `Plan relance : ${targetIds.length} article(s) remis en production${relaunchedNames ? ` (${relaunchedNames})` : ''}.`
        : 'Plan relance : besoins en ingredients et bon de sortie recalcules.';
      await client.query(
        `INSERT INTO production_plan_activity (plan_id, activity_type, message, created_by)
         VALUES ($1, 'plan_relaunched', $2, $3)`,
        [planId, journal, userId || null],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // ═══ Hors transaction : reconstruction de la preparation ═══
    // confirm() recalcule les besoins depuis les recettes ACTUELLES, regenere le BSI,
    // attribue les lots et repositionne le statut. C'est ce qui debloque un plan
    // confirme trop tot (produit sans recette a l'epoque). Il ouvre sa propre
    // transaction, d'ou l'appel apres COMMIT.
    if (recomputeNeeds) {
      const { warnings: confirmWarnings } = await productionRepository.confirm(planId, userId || '');
      warnings.push(...confirmWarnings);

      // Les semi-finis peuvent apparaitre maintenant que la recette existe.
      const planInfo = await db.query(
        `SELECT is_semi_finished_plan FROM production_plans WHERE id = $1`, [planId]
      );
      if (!planInfo.rows[0]?.is_semi_finished_plan && userId) {
        try {
          await productionRepository.detectAndCreateSemiFinishedPlans(planId, userId);
        } catch (err) {
          console.error('[production.relaunch] detection semi-finis echouee:', err);
          warnings.push('La detection des semi-finis a echoue — verifiez les dependances du plan.');
        }
      }

      // confirm() a ecrase la colonne warnings avec les siennes : on y remet celles
      // de la relance pour ne pas perdre le contexte du deblocage.
      await db.query(
        `UPDATE production_plans SET warnings = $2, updated_at = NOW() WHERE id = $1`,
        [planId, warnings.length > 0 ? warnings : null],
      );
    }

    const finalPlan = await db.query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
    return {
      relaunchedCount: relaunchedIds.length,
      recomputed: recomputeNeeds,
      newStatus: finalPlan.rows[0]?.status as string,
      warnings,
    };
  },

  async start(planId: string, userId?: string) {
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

    // La garde de statut et le verrou sont portes par transitionPlan (machine a
    // etats, mig 299) : deux « Lancer » simultanes ne passent plus tous les deux.
    const planInfo = await db.query(
      `SELECT is_semi_finished_plan FROM production_plans WHERE id = $1`, [planId]
    );
    if (!planInfo.rows[0]) throw new Error('Plan introuvable');

      // Check BSI status — production cannot start until ingredients are delivered (BSI clôturé)
      // Semi-finished plans don't have their own BSI, so skip this check for them
      if (!planInfo.rows[0].is_semi_finished_plan) {
        // Cas "plan sans ingredients" : aucun produit n'a de recette, donc rien a prelever.
        // On bypass la verification BSI (sinon impossible de demarrer un plan legitime).
        const needsResult = await db.query(
          `SELECT 1 FROM production_ingredient_needs WHERE plan_id = $1 LIMIT 1`,
          [planId]
        );
        const hasIngredientNeeds = needsResult.rows.length > 0;

        if (hasIngredientNeeds) {
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
      }

    // Transition gardee (confirmed / awaiting_ingredients / ready_to_produce -> in_progress),
    // journalisee avec l'acteur. Un demarrage qui croise une cloture est refuse.
    await withActor(userId, (c) => transitionPlan(c, planId, 'in_progress'), 'Demarrage de la production');
  },

  async complete(planId: string, actualItems: { planItemId: string; actualQuantity: number }[], userId: string, storeId?: string, completionType?: string): Promise<{ warnings: string[] }> {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');
      await setActor(client, userId, completionType === 'partial' ? 'Cloture partielle' : 'Cloture de la production');

      // Verrou + garde de statut dans la transaction : deux clotures simultanees
      // (double clic, deux postes) passaient toutes les deux et doublaient le stock.
      const planLock = await client.query(`SELECT status FROM production_plans WHERE id = $1 FOR UPDATE`, [planId]);
      if (!planLock.rows[0]) throw new Error('Plan introuvable');
      if (planLock.rows[0].status !== 'in_progress') {
        throw new Error(`Le plan est en statut "${planLock.rows[0].status}" : il doit etre en cours pour etre termine.`);
      }

      // Articles qui passent en 'produced' PAR CET APPEL. Ceux deja produits via
      // produceItems ont deja alimente le stock et les lots : on ne les retraite pas.
      const newlyProducedIds: string[] = [];
      for (const item of actualItems) {
        if (!(item.actualQuantity > 0)) continue;
        const r = await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1, status = 'produced'
            WHERE id = $2 AND plan_id = $3 AND status IN ('pending', 'in_progress')
            RETURNING id`,
          [item.actualQuantity, item.planItemId, planId]
        );
        if (r.rows[0]) newlyProducedIds.push(r.rows[0].id);
      }

      // Si un BSI de ce plan a deja deduit le stock (status >= 'prelevement', cad
      // chef a accepte la reception), on saute la deduction ingredient ici pour
      // eviter une double consommation. Les lots ont ete decremente​s dans
      // bonSortieRepository.acceptReception (consumeBonLines).
      const bsiDeductedResult = await client.query(
        `SELECT 1 FROM production_bons_sortie
          WHERE plan_id = $1 AND status IN ('prelevement', 'verifie', 'cloture')
          LIMIT 1`,
        [planId]
      );
      const bsiAlreadyDeducted = bsiDeductedResult.rows.length > 0;

      // Deduct ingredients based on actual production — uniquement les articles produits ici
      const itemsResult = await client.query(
        `SELECT ppi.*, p.name as product_name FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1 AND ppi.id = ANY($2)`,
        [planId, newlyProducedIds]
      );

      for (const item of itemsResult.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;
        if (bsiAlreadyDeducted) continue;

        const recipeResult = await client.query(
          RECIPE_FOR_PRODUCT_SQL,
          [item.product_id]
        );
        if (!recipeResult.rows[0]) continue;
        const recipe = recipeResult.rows[0];

        // Besoins resolus par le helper (legacy OU compose), en unite de base.
        const ingredientNeeds = new Map<string, number>();
        await collectIngredientNeedsForUnits(
          client, recipe.id, item.actual_quantity,
          (ingredientId, qty) => ingredientNeeds.set(ingredientId, (ingredientNeeds.get(ingredientId) || 0) + qty),
          { formatId: item.format_id ?? recipe.linked_format_id ?? null, warnings }
        );

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
            // SAVEPOINT : une erreur SQL ici abandonnait toute la transaction et le
            // COMMIT final devenait un rollback silencieux.
            await client.query('SAVEPOINT fefo_consume');
            try {
              await ingredientLotRepository.consumeFEFO(client, ingredientId, actualConsumption, planId, storeId);
              await client.query('RELEASE SAVEPOINT fefo_consume');
            } catch (fefoErr) {
              await client.query('ROLLBACK TO SAVEPOINT fefo_consume');
              const ingNameFEFO = await client.query('SELECT name FROM ingredients WHERE id = $1', [ingredientId]);
              console.error(`[consumeFEFO] Erreur pour ${ingNameFEFO.rows[0]?.name || ingredientId}:`, fefoErr);
              warnings.push(`Traçabilité lots: erreur FEFO pour ${ingNameFEFO.rows[0]?.name || ingredientId}`);
            }
          }
        }

        // ─── Phase Emballages : consommation packaging du plan ───
        // Pour chaque item produit, on consomme les emballages de la recette
        // au prorata de actual_quantity / yield_quantity.
        if (storeId) {
          const packagingNeeds = await client.query(
            `SELECT rp.packaging_id, rp.quantity, pi.name, pi.unit_cost
             FROM recipe_packaging rp
             JOIN packaging_items pi ON pi.id = rp.packaging_id
             WHERE rp.recipe_id = $1`,
            [recipe.id]
          );
          for (const pk of packagingNeeds.rows) {
            const pkConsumption = (parseFloat(pk.quantity) / parseFloat(recipe.yield_quantity)) * parseFloat(item.actual_quantity);
            if (pkConsumption <= 0) continue;
            await client.query('SAVEPOINT pk_consume');
            try {
              await packagingItemRepository.adjustStock(client, {
                packagingId: pk.packaging_id,
                storeId,
                change: -pkConsumption,
                type: 'consumption',
                referenceId: planId,
                referenceType: 'production_plan',
                unitCost: parseFloat(pk.unit_cost),
                note: `Production: ${item.product_name} x${item.actual_quantity}`,
                performedBy: userId,
              });
              await client.query('RELEASE SAVEPOINT pk_consume');
            } catch (pkErr) {
              await client.query('ROLLBACK TO SAVEPOINT pk_consume');
              console.error(`[packaging consumption] erreur pour ${pk.name}:`, pkErr);
              warnings.push(`Stock emballage insuffisant: ${pk.name} (besoin ${pkConsumption.toFixed(2)})`);
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

        // Cycle de vie : lot produit fini pour TOUTE fournee (ci-dessous) et, pour
        // les produits a DLV parametree, product_display_tracking (suivi legacy).
        if (storeId) {
          const productLifecycle = await client.query(
            `SELECT shelf_life_days, display_life_hours FROM products WHERE id = $1`,
            [item.product_id]
          );
          const shelfLifeRaw = productLifecycle.rows[0]?.shelf_life_days;
          const shelfDays: number | null = shelfLifeRaw ? parseInt(shelfLifeRaw) : null;
          if (shelfDays) {
            const { display_life_hours } = productLifecycle.rows[0];
            const displayHours = display_life_hours ? parseInt(display_life_hours) : null;
            await client.query(
              `INSERT INTO product_display_tracking (product_id, store_id, produced_at, expires_at, display_expires_at, status)
               VALUES ($1, $2, NOW(), NOW() + ($3 * INTERVAL '1 day'), ${displayHours !== null ? `NOW() + ($4 * INTERVAL '1 hour')` : 'NULL'}, 'active')`,
              displayHours !== null ? [item.product_id, storeId, shelfDays, displayHours] : [item.product_id, storeId, shelfDays]
            );

          }

          // Lot produit fini SYSTEMATIQUE (audit cycle de vie P2.7) : tracabilite
          // descendante et FEFO pour 100 % du catalogue. Sans shelf_life_days,
          // DLC = jour meme (repli dans createFromProduction).
          await productLotRepository.createFromProduction(client, {
            productId: item.product_id,
            storeId,
            productionPlanId: planId,
            planItemId: item.id,
            lotNumber: await planItemLotNumber(client, item.id),
            quantityProduced: parseFloat(item.actual_quantity),
            shelfLifeDays: shelfDays,
            notes: `Production plan ${planId}`,
          });
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

      // Update plan status and append warnings (garde : encore 'in_progress')
      await transitionPlan(client, planId, 'completed', {
        extraSet: "completed_at = NOW(), completion_type = $2, warnings = COALESCE(warnings, '{}') || $3::text[]",
        params: [effectiveType, warnings],
      });

      // Note: Replenishment V2 decouples production from replenishment.
      // The responsable manually manages the link between production output and replenishment preparation.

      // Mark related pre-orders as 'ready' (orders for this plan date with produced products)
      const planResult = await client.query(`SELECT plan_date FROM production_plans WHERE id = $1`, [planId]);
      if (planResult.rows[0]) {
        const planDate = planResult.rows[0].plan_date;
        // Toutes les references produites du plan (pas seulement celles de cet appel)
        const allProduced = await client.query(
          `SELECT DISTINCT product_id FROM production_plan_items
            WHERE plan_id = $1 AND status = 'produced' AND product_id IS NOT NULL`,
          [planId]
        );
        const productIds = allProduced.rows.map((it: Record<string, unknown>) => it.product_id);
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
          // Snapshot du cout theorique par piece (mig 261, audit A6b).
          // Se fait ICI, juste apres le UPDATE : rien n'est snapshotte si le
          // UPDATE n'a pas modifie de ligne (deja in_progress, annulee).
          // v_recipe_format_cost donne un cout par piece de CE format precis
          // (proration ratio_poids ou nomenclature composee) ; repli sur
          // v_recipe_total_cost pour le mode legacy (format_id NULL), divise
          // par yield_quantity pour ramener le cout de fournee au cout piece.
          // Sous-selects necessaires : Postgres interdit de reflarger la table
          // cible (ppi) dans un LEFT JOIN de la clause FROM d'un UPDATE.
          // theo_snapshot_at IS NULL empeche l'ecrasement d'un snapshot existant.
          await client.query(
            `UPDATE production_plan_items ppi SET
               theo_cout_matiere_u = (
                 SELECT COALESCE(vfc.cout_matiere_unitaire,
                                 CASE WHEN r.yield_quantity > 0
                                      THEN vtc.total_cost / r.yield_quantity ELSE NULL END)
                 FROM recipes r
                 LEFT JOIN v_recipe_total_cost  vtc ON vtc.id = r.id
                 LEFT JOIN v_recipe_format_cost vfc ON vfc.id = ppi.format_id
                 WHERE r.product_id = ppi.product_id
                 LIMIT 1
               ),
               theo_cout_complet_u = (
                 SELECT COALESCE(vfc.cout_unitaire_complet,
                                 CASE WHEN r.yield_quantity > 0
                                      THEN vtc.total_cost / r.yield_quantity ELSE NULL END)
                 FROM recipes r
                 LEFT JOIN v_recipe_total_cost  vtc ON vtc.id = r.id
                 LEFT JOIN v_recipe_format_cost vfc ON vfc.id = ppi.format_id
                 WHERE r.product_id = ppi.product_id
                 LIMIT 1
               ),
               theo_prix_u = (
                 SELECT vfc.prix_vente_unitaire
                 FROM v_recipe_format_cost vfc
                 WHERE vfc.id = ppi.format_id
                 LIMIT 1
               ),
               theo_snapshot_at = $1::timestamptz,
               theo_source_view = CASE WHEN ppi.format_id IS NOT NULL THEN 'v_recipe_format_cost'
                                       ELSE 'v_recipe_total_cost' END
             WHERE ppi.id = $2 AND ppi.theo_snapshot_at IS NULL`,
            [startTime, result.rows[0].id]
          );
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
  async produceItems(planId: string, items: { planItemId: string; actualQuantity: number; outputs?: CutInput[] }[], userId: string, storeId?: string, producedAt?: string): Promise<{ warnings: string[]; autoCompleted: boolean }> {
    const client = await db.getClient();
    const warnings: string[] = [];
    try {
      await client.query('BEGIN');
      await setActor(client, userId, 'Production enregistree');

      // Verify plan status — verrouille le plan : deux productions simultanees du meme
      // article (double clic, relance apres erreur reseau) ajoutaient le stock deux fois.
      const planCheck = await client.query(`SELECT status FROM production_plans WHERE id = $1 FOR UPDATE`, [planId]);
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

      // Update actual quantities and status for selected items. On ne retient que
      // les articles reellement passes en 'produced' par cet appel : un article deja
      // produit (second clic) ne doit plus alimenter stock, lots ni semi-finis.
      const changedItemIds: string[] = [];
      // Coupe declaree par article : la quantite produite devient la somme en
      // pieces equivalentes (1 entremets de 8 + 42 tranches = 50).
      const cutByItem = new Map<string, CutOutput[]>();
      for (const item of items) {
        if (item.outputs && item.outputs.length > 0) {
          const resolved = await resolveCutOutputs(client, item.planItemId, item.outputs);
          if (resolved.length > 0) {
            cutByItem.set(item.planItemId, resolved);
            item.actualQuantity = Math.round(resolved.reduce((sum, o) => sum + o.quantity * o.equiv, 0));
          }
        }
        if (item.actualQuantity <= 0) continue;

        // Phase 4: guard — if blocking steps are enforced, verify all are complete
        if (stepsBlocking) {
          const allDone = await productionEtapesRepository.areBlockingStepsComplete(item.planItemId);
          if (!allDone) {
            warnings.push(`Etapes bloquantes non terminees pour l'article ${item.planItemId}`);
            continue;
          }
        }

        const changed = await client.query(
          `UPDATE production_plan_items SET actual_quantity = $1, status = 'produced'
           WHERE id = $2 AND plan_id = $3 AND status IN ('pending', 'in_progress') AND (waiting_status IS NULL OR waiting_status = 'restored')
           RETURNING id`,
          [item.actualQuantity, item.planItemId, planId]
        );
        if (changed.rows[0]) changedItemIds.push(changed.rows[0].id);
      }

      // Check if this is a semi-finished plan
      const planInfo = await client.query(
        `SELECT is_semi_finished_plan, store_id FROM production_plans WHERE id = $1`, [planId]
      );
      const isSemiFinishedPlan = planInfo.rows[0]?.is_semi_finished_plan === true;

      // F-044 (modele B) — Bases servies par le semi-fini (reservation stock +/ou
      // plan fils) : a la deduction d'ingredients de CE plan, on saute toutes les
      // bases ayant une dependance, pas seulement celles couvertes depuis le stock.
      // Elles sont payees ailleurs (reservation a la detection + production du
      // plan fils), jamais en matieres ici.
      const fulfilledSubRecipes = new Set<string>();
      const depsResult = await client.query(
        `SELECT sub_recipe_id FROM production_plan_dependencies
         WHERE parent_plan_id = $1`,
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
        [planId, changedItemIds]
      );

      // Si BSI deja en prelevement+ on saute la deduction (faite par acceptReception).
      // Sauf pour les semi-finis qui n'ont pas de BSI propre (dependances internes).
      const bsiDeductedResult2 = await client.query(
        `SELECT 1 FROM production_bons_sortie
          WHERE plan_id = $1 AND status IN ('prelevement', 'verifie', 'cloture')
          LIMIT 1`,
        [planId]
      );
      // F-044 (modele B) — Un plan semi-fini consomme desormais SES PROPRES
      // matieres a la production. Avant, on les sautait au motif que le BSI du
      // parent les portait (base aplatie) ; en modele B le BSI du parent n'aplatit
      // plus les bases produites separement, donc le fils doit payer ses matieres.
      // Le bsiAlreadyDeducted2 ne vaut que pour le BSI PROPRE d'un plan (rare pour
      // un semi-fini, qui n'en a pas), jamais via le parent.
      const bsiAlreadyDeducted2 = !isSemiFinishedPlan && bsiDeductedResult2.rows.length > 0;

      // Deduct ingredients for produced items
      for (const item of producedItems.rows) {
        if (!item.actual_quantity || item.actual_quantity <= 0) continue;

        // Recipe lookup : sert a la fois pour la deduction d'ingredients et pour
        // les flux semi-finis. On le calcule meme si le BSI a deja consomme les
        // ingredients (la suite du loop a besoin de recipeResult.rows[0]).
        let recipeResult;
        if (isSemiFinishedPlan && item.base_recipe_id) {
          recipeResult = await client.query(
            `SELECT r.id, r.yield_quantity FROM recipes r WHERE r.id = $1`,
            [item.base_recipe_id]
          );
        } else {
          recipeResult = await client.query(
            RECIPE_FOR_PRODUCT_SQL,
            [item.product_id]
          );
        }

        // Deduction des ingredients : a sauter si le BSI a deja consomme le stock
        // (chaine BSI 'prelevement' -> on a deja decremente l'inventaire dans
        // acceptReception). Sans ce skip, on decompterait deux fois les ingredients.
        // ATTENTION : ce skip ne doit PAS empecher l'incrementation du stock produit
        // ni la creation du product_lot — les blocs ci-dessous restent obligatoires.
        if (!bsiAlreadyDeducted2 && recipeResult.rows[0]) {
          const recipe = recipeResult.rows[0];
          const ingredientNeeds = new Map<string, number>();

          // Besoins resolus par le helper (legacy OU compose) — on saute les
          // sous-recettes deja couvertes par le stock semi-finis.
          await collectIngredientNeedsForUnits(
            client, recipe.id, item.actual_quantity,
            (ingredientId, qty) => ingredientNeeds.set(ingredientId, (ingredientNeeds.get(ingredientId) || 0) + qty),
            {
              formatId: item.format_id ?? recipe.linked_format_id ?? null,
              skipSubRecipe: (subRecipeId) => fulfilledSubRecipes.has(subRecipeId),
              warnings,
            }
          );

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
            // Lots consommes FEFO -> production_lot_usage (tracabilite + cout FIFO),
            // comme dans complete(). Isole par SAVEPOINT.
            if (actualConsumption > 0) {
              await client.query('SAVEPOINT fefo_consume');
              try {
                await ingredientLotRepository.consumeFEFO(client, ingredientId, actualConsumption, planId, storeId);
                await client.query('RELEASE SAVEPOINT fefo_consume');
              } catch (fefoErr) {
                await client.query('ROLLBACK TO SAVEPOINT fefo_consume');
                console.error('[consumeFEFO] produceItems:', fefoErr);
                warnings.push(`Traçabilité lots : erreur FEFO pour l'ingrédient ${ingredientId}`);
              }
            }
          }

          // Emballages : au prorata produit / rendement, comme dans complete().
          // Quand un BSI existe, ils ont ete consommes au prelevement (bon-sortie).
          if (storeId && recipe.yield_quantity && parseFloat(recipe.yield_quantity) > 0) {
            const packagingNeeds = await client.query(
              `SELECT rp.packaging_id, rp.quantity, pi.name, pi.unit_cost
                 FROM recipe_packaging rp JOIN packaging_items pi ON pi.id = rp.packaging_id
                WHERE rp.recipe_id = $1`,
              [recipe.id]
            );
            for (const pk of packagingNeeds.rows) {
              const pkConsumption = (parseFloat(pk.quantity) / parseFloat(recipe.yield_quantity)) * parseFloat(item.actual_quantity);
              if (pkConsumption <= 0) continue;
              await client.query('SAVEPOINT pk_consume');
              try {
                await packagingItemRepository.adjustStock(client, {
                  packagingId: pk.packaging_id, storeId, change: -pkConsumption, type: 'consumption',
                  referenceId: planId, referenceType: 'production_plan',
                  unitCost: pk.unit_cost != null ? parseFloat(pk.unit_cost) : null,
                  note: `Production: ${item.product_name} x${item.actual_quantity}`, performedBy: userId,
                });
                await client.query('RELEASE SAVEPOINT pk_consume');
              } catch (pkErr) {
                await client.query('ROLLBACK TO SAVEPOINT pk_consume');
                console.error(`[packaging consumption] erreur pour ${pk.name}:`, pkErr);
                warnings.push(`Stock emballage : ${pk.name} non consomme (besoin ${pkConsumption.toFixed(2)})`);
              }
            }
          }

          // ─── Emballages : meme consommation que complete() (audit 2026-10-23 §4.2).
          // Un plan auto-complete via produceItems ne decrementait jamais les
          // emballages : seule la cloture manuelle le faisait.
          if (storeId && !isSemiFinishedPlan) {
            const packagingNeeds = await client.query(
              `SELECT rp.packaging_id, rp.quantity, pi.name, pi.unit_cost
               FROM recipe_packaging rp
               JOIN packaging_items pi ON pi.id = rp.packaging_id
               WHERE rp.recipe_id = $1`,
              [recipe.id]
            );
            for (const pk of packagingNeeds.rows) {
              const pkConsumption = (parseFloat(pk.quantity) / parseFloat(recipe.yield_quantity)) * parseFloat(item.actual_quantity);
              if (pkConsumption <= 0) continue;
              try {
                await packagingItemRepository.adjustStock(client, {
                  packagingId: pk.packaging_id,
                  storeId,
                  change: -pkConsumption,
                  type: 'consumption',
                  referenceId: planId,
                  referenceType: 'production_plan',
                  unitCost: parseFloat(pk.unit_cost),
                  note: `Production partielle: ${item.product_name} x${item.actual_quantity}`,
                  performedBy: userId,
                });
              } catch (pkErr) {
                console.error(`[packaging consumption] erreur pour ${pk.name}:`, pkErr);
                warnings.push(`Stock emballage insuffisant: ${pk.name} (besoin ${pkConsumption.toFixed(2)})`);
              }
            }
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
          // Lot de semi-fini (mig 300) : identite de lot pour la chaine
          // ingredient -> semi-fini -> produit fini. Numero = celui de l'article.
          {
            const sfLot = (await planItemLotNumber(client, item.id)) || `SF-${format(new Date(), 'yyMMdd')}-${String(item.id).slice(0, 6).toUpperCase()}`;
            const taken = await client.query(
              `SELECT COUNT(*)::int AS n FROM semi_finished_lots WHERE store_id = $1 AND (lot_number = $2 OR lot_number LIKE $2 || '-%')`,
              [effectiveStoreId, sfLot]);
            const sfLotNumber = taken.rows[0].n > 0 ? `${sfLot}-${taken.rows[0].n + 1}` : sfLot;
            await client.query(
              `INSERT INTO semi_finished_lots
                 (recipe_id, store_id, lot_number, production_plan_id, plan_item_id, quantity_produced, quantity_remaining, unit, produced_at, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $6, $7, COALESCE($8::timestamptz, NOW()), $9)`,
              [item.base_recipe_id, effectiveStoreId, sfLotNumber, planId, item.id, item.actual_quantity, yieldUnit, producedAt || null, userId]
            );
          }

          // Fulfill dependencies pointing to this plan
          await client.query(
            `UPDATE production_plan_dependencies SET status = 'fulfilled'
             WHERE dependency_plan_id = (SELECT id FROM production_plans WHERE id = $1 AND is_semi_finished_plan = true)
               AND status = 'pending'`,
            [planId]
          );

          // F-044 (modele B) — Le fils a ete cree POUR un plan parent : on impute
          // la part `toProduce` de ce semi-fini au parent (consommation reelle),
          // sinon la pate produite resterait en stock disponible alors que le
          // parent ne consomme plus les matieres de la base (BSI sans la base).
          // Le surplus d'arrondi (produit - toProduce) reste disponible.
          const parentDep = await client.query(
            `SELECT parent_plan_id, quantity_to_produce FROM production_plan_dependencies
              WHERE dependency_plan_id = $1 AND sub_recipe_id = $2 LIMIT 1`,
            [planId, item.base_recipe_id]
          );
          const pdep = parentDep.rows[0];
          if (pdep && pdep.parent_plan_id) {
            const consumeForParent = Math.min(parseFloat(item.actual_quantity), parseFloat(pdep.quantity_to_produce) || 0);
            if (consumeForParent > 1e-9) {
              await client.query(
                `UPDATE semi_finished_stock SET quantity_available = GREATEST(0, quantity_available - $1), updated_at = NOW()
                  WHERE recipe_id = $2 AND store_id = $3`,
                [consumeForParent, item.base_recipe_id, effectiveStoreId]
              );
              let remainingForParent = consumeForParent;
              const sfLots = await client.query(
                `SELECT id, quantity_remaining FROM semi_finished_lots
                  WHERE recipe_id = $1 AND store_id = $2 AND status = 'active' AND quantity_remaining > 0
                  ORDER BY expires_at ASC NULLS LAST, produced_at ASC
                  FOR UPDATE`,
                [item.base_recipe_id, effectiveStoreId]
              );
              for (const lot of sfLots.rows) {
                if (remainingForParent <= 1e-9) break;
                const take = Math.min(remainingForParent, parseFloat(lot.quantity_remaining));
                await client.query(
                  `UPDATE semi_finished_lots
                      SET quantity_remaining = quantity_remaining - $1,
                          status = CASE WHEN quantity_remaining - $1 <= 0.0005 THEN 'depleted' ELSE status END
                    WHERE id = $2`,
                  [take, lot.id]
                );
                await client.query(
                  `INSERT INTO semi_finished_lot_usage (semi_finished_lot_id, parent_plan_id, quantity) VALUES ($1, $2, $3)`,
                  [lot.id, pdep.parent_plan_id, take]
                );
                remainingForParent -= take;
              }
              await client.query(
                `INSERT INTO semi_finished_transactions (recipe_id, store_id, type, quantity_change, production_plan_id, performed_by, notes)
                 VALUES ($1, $2, 'consumption', $3, $4, $5, $6)`,
                [item.base_recipe_id, effectiveStoreId, -consumeForParent, planId, userId,
                 `Consommation par le plan parent (modele B, F-044)`]
              );
            }
          }
        } else if (item.product_id) {
          // Sorties de l'article : par defaut son produit ; avec une coupe declaree,
          // une ligne par sortie (entremets, tranches...), chacune avec son stock,
          // son suivi de DLC et son lot (suffixe -A, -B... sur le lot de l'article).
          const cut = cutByItem.get(item.id);
          const outs: CutOutput[] = cut && cut.length > 0
            ? cut
            : [{ productId: item.product_id, label: item.product_name, quantity: parseFloat(item.actual_quantity), equiv: 1 }];
          const baseLot = await planItemLotNumber(client, item.id);
          let n = 0;
          for (const out of outs) {
            const suffix = outs.length > 1 ? `-${String.fromCharCode(65 + n)}` : '';
            n++;
            const stockAfter = await adjustProductStock(client, out.productId, out.quantity, storeId);
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
               VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
              [out.productId, out.quantity, stockAfter,
               `Production${cut ? ' (coupe)' : ' partielle'}: ${out.label} x${out.quantity}`, planId, userId, storeId || null]
            );

            let lotId: string | null = null;
            if (storeId) {
              const productLifecycle = await client.query(
                `SELECT shelf_life_days, display_life_hours FROM products WHERE id = $1`,
                [out.productId]
              );
              const shelfLifeRaw = productLifecycle.rows[0]?.shelf_life_days;
              const shelfDays: number | null = shelfLifeRaw ? parseInt(shelfLifeRaw) : null;
              // Suivi legacy product_display_tracking : seulement pour les produits a DLV parametree.
              if (shelfDays) {
                const { display_life_hours } = productLifecycle.rows[0];
                const displayHours = display_life_hours ? parseInt(display_life_hours) : null;
                const baseTime = producedAt ? `$3::timestamptz` : 'NOW()';
                const params: unknown[] = [out.productId, storeId];
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

              // Lot produit fini SYSTEMATIQUE (audit cycle de vie P2.7), pour CHAQUE
              // sortie (produit ou coupe) : tracabilite descendante et FEFO pour 100 %
              // du catalogue. Sans shelf_life_days, DLC = jour meme (repli dans
              // createFromProduction).
              const lot = await productLotRepository.createFromProduction(client, {
                productId: out.productId,
                storeId,
                productionPlanId: planId,
                planItemId: item.id,
                lotNumber: baseLot ? `${baseLot}${suffix}` : null,
                quantityProduced: out.quantity,
                shelfLifeDays: shelfDays,
                producedAt: producedAt ? new Date(producedAt) : undefined,
                notes: cut ? `Coupe plan ${planId} — ${out.label}` : `Production partielle plan ${planId}`,
              });
              lotId = (lot as unknown as { id?: string })?.id || null;
            }

            if (cut) {
              await client.query(
                `INSERT INTO production_item_outputs (plan_item_id, product_id, label, quantity, equiv_pieces, product_lot_id, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [item.id, out.productId, out.label, out.quantity, out.equiv, lotId, userId]
              );
            }
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
        await transitionPlan(client, planId, 'completed', { extraSet: 'completed_at = NOW(), completion_type = $2', params: [completionType], reason: 'Tous les articles produits' });
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

      // Magasin du transfert : c'est la que le stock produit a ete incremente a la
      // production, donc la qu'un ecart de reception doit etre corrige.
      const transferHeader = await client.query(
        `SELECT plan_id, store_id FROM production_transfers WHERE id = $1 FOR UPDATE`, [transferId]
      );
      if (!transferHeader.rows[0]) throw new Error('Transfert introuvable');
      const transferStoreId: string | null = transferHeader.rows[0].store_id ?? null;
      const transferPlanId: string = transferHeader.rows[0].plan_id;

      let hasDiscrepancy = false;
      const discrepancies: { product_id: string; product_name: string | null; transferred: number; received: number; delta: number }[] = [];
      for (const item of items) {
        await client.query(
          `UPDATE production_transfer_items SET received_quantity = $1 WHERE id = $2 AND transfer_id = $3`,
          [item.qtyReceived, item.itemId, transferId]
        );
        const tItem = await client.query(
          `SELECT transferred_quantity, product_id, product_name, plan_item_id
           FROM production_transfer_items WHERE id = $1`, [item.itemId]
        );
        if (!tItem.rows[0]) continue;
        const transferred = parseFloat(tItem.rows[0].transferred_quantity);
        const delta = item.qtyReceived - transferred;

        // ─── Ecart de reception : le stock produit SUIT la quantite reellement
        // recue (audit 2026-10-23 §4.2). Avant, le statut passait a
        // received_with_discrepancy mais le stock incremente a la production
        // restait tel quel : le manquant devenait un stock fantome en boutique.
        if (delta !== 0) {
          hasDiscrepancy = true;
          const productId: string = tItem.rows[0].product_id;
          discrepancies.push({ product_id: productId, product_name: tItem.rows[0].product_name, transferred, received: item.qtyReceived, delta });

          const stockAfter = await adjustProductStock(client, productId, delta, transferStoreId);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [productId, delta < 0 ? 'loss' : 'adjustment', delta, stockAfter,
             `Ecart de reception transfert : ${transferred} transfere(s), ${item.qtyReceived} recu(s)${item.notes ? ' — ' + item.notes : ''}`,
             transferId, userId, transferStoreId]
          );

          // Miroir sur le lot de la fournee (invariant backroom + vitrine + sold +
          // wasted + recycled = quantity_total) : le manquant part en wasted_qty,
          // un surplus recu augmente le lot.
          const lotResult = await client.query(
            `SELECT id, backroom_qty FROM product_lots
             WHERE production_plan_id = $1 AND product_id = $2 AND status = 'active'
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [transferPlanId, productId]
          );
          if (lotResult.rows[0]) {
            if (delta < 0) {
              const lost = Math.min(-delta, parseFloat(lotResult.rows[0].backroom_qty) || 0);
              if (lost > 0) {
                await client.query(
                  `UPDATE product_lots SET backroom_qty = backroom_qty - $2, wasted_qty = wasted_qty + $2, updated_at = NOW() WHERE id = $1`,
                  [lotResult.rows[0].id, lost]
                );
              }
            } else {
              await client.query(
                `UPDATE product_lots SET backroom_qty = backroom_qty + $2, quantity_total = quantity_total + $2, updated_at = NOW() WHERE id = $1`,
                [lotResult.rows[0].id, delta]
              );
            }
          }

          // Perte valorisee au cout de revient, visible dans le module Controle.
          if (delta < 0) {
            // F-020 — perte valorisee au cout matieres reel (recette/plan), pas
            // cost_price = 0. Voir product-cost.helper.
            const unitCost = await productMaterialsUnitCost(client, productId);
            await client.query(
              `INSERT INTO product_losses
                 (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost,
                  production_plan_id, ingredients_consumed, declared_by, store_id)
               VALUES ($1, $2, 'production', 'ecart_inventaire', $3, $4, $5, $6, true, $7, $8)`,
              [productId, -delta,
               `Ecart de reception du transfert : ${transferred} transfere(s), ${item.qtyReceived} recu(s)${item.notes ? ' — ' + item.notes : ''}`,
               unitCost, Math.round(-delta * unitCost * 100) / 100,
               transferPlanId, userId, transferStoreId]
            );
          }
        }

        // Update plan item status to received
        await client.query(
          `UPDATE production_plan_items SET status = 'received' WHERE id = $1`,
          [tItem.rows[0].plan_item_id]
        );
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
      return { status: transferStatus, planCompleted, planId, discrepancies };
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
      if (!planResult.rows[0] || !['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(planResult.rows[0].status)) {
        throw new Error('Le plan doit etre confirme ou en cours pour restaurer des articles');
      }

      // Si un bon de sortie a été clôturé par le magasinier pour ce plan, on
      // considère que les ingrédients sont validés et on bypass le check de stock.
      const closedBsiResult = await client.query(
        `SELECT 1 FROM production_bons_sortie WHERE plan_id = $1 AND status = 'cloture' LIMIT 1`,
        [planId]
      );
      const bsiValidated = closedBsiResult.rows.length > 0;

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

        if (stillInsufficient && !bsiValidated) {
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
      if (!planResult.rows[0] || !['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(planResult.rows[0].status)) {
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

  async analyzeSubRecipes(planId: string) {
    // Get plan items with their recipes
    const itemsResult = await db.query(
      `SELECT ppi.id as plan_item_id, ppi.product_id, ppi.planned_quantity, ppi.format_id,
              p.name as product_name,
              r.id as recipe_id, r.yield_quantity, r.yield_unit
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.product_id = ppi.product_id
       WHERE ppi.plan_id = $1 AND ppi.status = 'pending'
         AND (ppi.waiting_status IS NULL OR ppi.waiting_status = 'restored')`,
      [planId]
    );

    // For each item, find sub-recipes — via le helper, pour couvrir les deux
    // modes de nomenclature (legacy recipe_sub_recipes ET compose).
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

      const comp = await getCompositionForNeeds(db, item.recipe_id, item.format_id ?? null);
      if (!comp) continue;
      const batches = parseInt(item.planned_quantity) / comp.batchDivisor;

      for (const sub of comp.subRecipes) {
        // Besoin NET : ce qu'il faut d'utilisable (le stock semi-finis est deja net de perte).
        const qtyNeeded = sub.netQtyPerBatch * batches;

        const existing = baseMap.get(sub.subRecipeId);
        if (existing) {
          existing.totalNeeded += qtyNeeded;
          existing.usedBy.push({
            planItemId: item.plan_item_id,
            productName: item.product_name,
            quantityNeeded: qtyNeeded,
          });
        } else {
          // Ingredients directs de la sous-recette (pour affichage), tous modes.
          const subComp = await getCompositionForNeeds(db, sub.subRecipeId, null);

          baseMap.set(sub.subRecipeId, {
            subRecipeId: sub.subRecipeId,
            subRecipeName: sub.name,
            yieldQuantity: sub.yieldQuantity,
            yieldUnit: sub.yieldUnit,
            totalNeeded: qtyNeeded,
            usedBy: [{
              planItemId: item.plan_item_id,
              productName: item.product_name,
              quantityNeeded: qtyNeeded,
            }],
            // Affichage dans l'unite SAISIE de la recette (420 g reste 420 g) ;
            // la conversion en unite de base ne sert qu'aux calculs BSI/FEFO.
            ingredients: (subComp?.ingredients || []).map((ing) => ({
              ingredientId: ing.ingredientId,
              ingredientName: ing.name,
              unit: ing.unitEntered,
              quantity: ing.qtyEntered,
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
        `SELECT ppi.id as plan_item_id, ppi.product_id, ppi.planned_quantity, ppi.format_id,
                p.name as product_name,
                r.id as recipe_id, r.yield_quantity
         FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes r ON r.product_id = ppi.product_id
         WHERE ppi.plan_id = $1 AND ppi.status = 'pending'`,
        [planId]
      );

      // 3. Consolidate sub-recipe needs across all items.
      // La nomenclature est resolue par le helper : sans lui, les recettes en
      // mode compose (recipe_components) etaient INVISIBLES ici — aucun plan
      // semi-fini cree, aucune reservation de stock.
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

        const comp = await getCompositionForNeeds(client, item.recipe_id, item.format_id ?? null);
        if (!comp) continue;
        const batches = parseInt(item.planned_quantity) / comp.batchDivisor;

        for (const sub of comp.subRecipes) {
          if (!sub.isBase) continue;
          // Besoin NET (utilisable) : le stock semi-finis est deja net de perte ;
          // le brut est gere a la production du plan enfant (rendement/pertes).
          const qtyNeeded = sub.netQtyPerBatch * batches;

          const existing = subRecipeNeeds.get(sub.subRecipeId);
          if (existing) {
            existing.totalNeeded += qtyNeeded;
            existing.usedBy.push({ planItemId: item.plan_item_id, productName: item.product_name, qty: qtyNeeded });
          } else {
            subRecipeNeeds.set(sub.subRecipeId, {
              subRecipeId: sub.subRecipeId,
              subRecipeName: sub.name,
              yieldQuantity: sub.yieldQuantity,
              yieldUnit: sub.yieldUnit,
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
          // Quels lots de semi-fini partent dans ce plan (FEFO) — mig 300.
          let remainingToTake = fromStock;
          const sfLots = await client.query(
            `SELECT id, quantity_remaining FROM semi_finished_lots
              WHERE recipe_id = $1 AND (store_id = $2 OR $2 IS NULL) AND status = 'active' AND quantity_remaining > 0
              ORDER BY expires_at ASC NULLS LAST, produced_at ASC
              FOR UPDATE`,
            [subRecipeId, plan.store_id]
          );
          for (const lot of sfLots.rows) {
            if (remainingToTake <= 0) break;
            const take = Math.min(remainingToTake, parseFloat(lot.quantity_remaining));
            await client.query(
              `UPDATE semi_finished_lots
                  SET quantity_remaining = quantity_remaining - $1,
                      status = CASE WHEN quantity_remaining - $1 <= 0 THEN 'depleted' ELSE status END
                WHERE id = $2`,
              [take, lot.id]
            );
            await client.query(
              `INSERT INTO semi_finished_lot_usage (semi_finished_lot_id, parent_plan_id, quantity) VALUES ($1, $2, $3)`,
              [lot.id, planId, take]
            );
            remainingToTake -= take;
          }
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
    // Restitue la quantite aux lots d'ou elle venait (mig 300).
    const usage = await client.query(
      `SELECT u.id, u.semi_finished_lot_id, u.quantity
         FROM semi_finished_lot_usage u
         JOIN semi_finished_lots l ON l.id = u.semi_finished_lot_id
        WHERE u.parent_plan_id = $1 AND u.released_at IS NULL AND l.recipe_id = $2
        FOR UPDATE OF u`,
      [planId, dep.sub_recipe_id],
    );
    for (const u of usage.rows) {
      await client.query(
        `UPDATE semi_finished_lots
            SET quantity_remaining = quantity_remaining + $1,
                status = CASE WHEN status = 'depleted' THEN 'active' ELSE status END
          WHERE id = $2`,
        [parseFloat(u.quantity), u.semi_finished_lot_id],
      );
      await client.query(`UPDATE semi_finished_lot_usage SET released_at = NOW() WHERE id = $1`, [u.id]);
    }
    await client.query(
      `UPDATE production_plan_dependencies
       SET status = 'cancelled', quantity_from_stock = 0
       WHERE id = $1`,
      [dep.id],
    );
  }
}

/**
 * Recette d'un produit : lien direct (recipes.product_id) ou par un format de la
 * fiche (recipe_formats.product_id, « Produit vendu au POS »). Renvoie aussi le
 * format lie, pour calculer les besoins sur la bonne nomenclature.
 */
const RECIPE_FOR_PRODUCT_SQL = `
  SELECT r.id, r.yield_quantity,
         (SELECT rf.id FROM recipe_formats rf
           WHERE rf.recipe_id = r.id AND rf.product_id = $1 AND rf.is_active LIMIT 1) AS linked_format_id
    FROM recipes r
   WHERE r.product_id = $1
      OR r.id IN (SELECT rf.recipe_id FROM recipe_formats rf WHERE rf.product_id = $1 AND rf.is_active)
   ORDER BY (r.product_id = $1) DESC NULLS LAST
   LIMIT 1`;

export interface CutOutput {
  productId: string;
  label: string;
  quantity: number;
  /** Equivalence en pieces de l'article, figee au moment de la production. */
  equiv: number;
}

type CutInput = { productId?: string | null; equivPieces?: number; quantity: number };

/**
 * Coupe (mig 302) : transforme la saisie du chef en lignes exploitables.
 * Sans productId (ou = produit de l'article) : la piece de l'article, equivalence 1.
 * Sinon : un autre produit du catalogue, avec l'equivalence saisie par le chef.
 * La repartition se decide dans le plan, a la coupe — rien n'est parametre en amont.
 */
async function resolveCutOutputs(
  client: import('pg').PoolClient, planItemId: string, outputs: CutInput[],
): Promise<CutOutput[]> {
  const it = await client.query(
    `SELECT ppi.product_id, COALESCE(p.name, '') AS product_name
       FROM production_plan_items ppi LEFT JOIN products p ON p.id = ppi.product_id
      WHERE ppi.id = $1`, [planItemId]);
  const base = it.rows[0];
  if (!base?.product_id) throw new Error('La coupe ne s\'applique qu\'aux produits finis');
  const ids = [...new Set(outputs.map(o => o.productId).filter((x): x is string => !!x && x !== base.product_id))];
  const prods = ids.length > 0
    ? (await client.query(`SELECT id, name FROM products WHERE id = ANY($1::uuid[])`, [ids])).rows
    : [];
  const merged = new Map<string, CutOutput>();
  for (const o of outputs) {
    if (!(o.quantity > 0)) continue;
    const isBase = !o.productId || o.productId === base.product_id;
    let line: CutOutput;
    if (isBase) {
      line = { productId: base.product_id, label: base.product_name, quantity: o.quantity, equiv: 1 };
    } else {
      const p = prods.find((x: Record<string, any>) => x.id === o.productId);
      if (!p) throw new Error('Produit de sortie introuvable');
      if (!(o.equivPieces && o.equivPieces > 0)) {
        throw new Error(`Indiquez combien de pièces vaut « ${p.name} » dans le cadre`);
      }
      line = { productId: p.id, label: p.name, quantity: o.quantity, equiv: o.equivPieces };
    }
    // Meme produit saisi deux fois avec la meme equivalence : on cumule.
    const key = `${line.productId}::${line.equiv}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += line.quantity; else merged.set(key, line);
  }
  return [...merged.values()];
}

/** Numero LOT-AAMMJJ-NNN attribue a l'article a la confirmation (null si absent). */
async function planItemLotNumber(client: import('pg').PoolClient, planItemId: string): Promise<string | null> {
  const r = await client.query(`SELECT lot_number FROM production_lot_numbers WHERE plan_item_id = $1 LIMIT 1`, [planItemId]);
  return r.rows[0]?.lot_number || null;
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

  // Retry-on-conflict via SAVEPOINT : indispensable car en cas de duplicate
  // (race condition residuelle, etat inconsistant, etc.) Postgres marque la
  // transaction entiere comme aborted et le COMMIT du caller echouerait sans
  // ce save point. Avec savepoint, on peut sauter le conflit et reessayer
  // avec sequence+1.
  const MAX_ATTEMPTS_PER_ITEM = 200;
  for (const item of itemsResult.rows) {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS_PER_ITEM) {
      seq++;
      const lotNumber = `LOT-${dateStr}-${String(seq).padStart(3, '0')}`;
      await client.query('SAVEPOINT sp_lot_insert');
      try {
        await client.query(
          `INSERT INTO production_lot_numbers (plan_item_id, plan_id, lot_number, lot_date, sequence_number)
           VALUES ($1, $2, $3, $4, $5)`,
          [item.id, planId, lotNumber, lotDateStr, seq]
        );
        await client.query('RELEASE SAVEPOINT sp_lot_insert');
        break;
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_lot_insert');
        const err = e as { code?: string; constraint?: string };
        // 23505 = unique_violation. On retente si c'est le lot_number qui colide ;
        // sinon (plan_item_id deja present, autre contrainte), on remonte l'erreur.
        if (err.code === '23505' && err.constraint === 'production_lot_numbers_lot_number_key') {
          attempts++;
          continue;
        }
        throw e;
      }
    }
    if (attempts >= MAX_ATTEMPTS_PER_ITEM) {
      throw new Error(
        `Impossible de generer un numero de lot unique pour ${lotDateStr} apres ${MAX_ATTEMPTS_PER_ITEM} tentatives (seq=${seq})`
      );
    }
  }
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
