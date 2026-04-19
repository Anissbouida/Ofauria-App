import { db } from '../config/database.js';
import { getUserTimezone, getLocalNow } from '../utils/timezone.js';

/**
 * Moteur de suggestion intelligent pour le devenir des invendus.
 * Determine la destination (reexpose / recycle / waste) selon :
 *   - DLV (date limite de vente) et heures d'exposition
 *   - Nombre de reexpositions max atteint ou non
 *   - Recyclabilite du produit et ingredient de recyclage configure
 *   - Type de vente (jour / dlv / commande)
 */
function computeSuggestion(product: Record<string, unknown>): { destination: 'reexpose' | 'recycle' | 'waste'; reason: string } {
  const now = getLocalNow();
  const saleType = (product.sale_type as string) || 'jour';
  const shelfLifeDays = parseInt(String(product.shelf_life_days)) || 0;
  const displayLifeHours = parseInt(String(product.display_life_hours)) || 0;
  const isReexposable = product.is_reexposable as boolean;
  const maxReexpositions = parseInt(String(product.max_reexpositions)) || 0;
  const currentReexCount = parseInt(String(product.current_reexposition_count || product.reexposition_count)) || 0;
  const isRecyclable = product.is_recyclable as boolean;
  const recycleIngredientId = product.recycle_ingredient_id as string | null;
  const expiresAt = product.expires_at ? new Date(String(product.expires_at)) : null;
  const displayExpiresAt = product.display_expires_at ? new Date(String(product.display_expires_at)) : null;
  const producedAt = product.produced_at ? new Date(String(product.produced_at)) : null;

  // 1. Produit sur commande = jamais en vitrine, destruction par defaut
  if (saleType === 'commande') {
    return { destination: 'waste', reason: 'Produit sur commande — ne doit pas etre en vitrine.' };
  }

  // 2. DLV depassee = perime
  if (expiresAt && expiresAt <= now) {
    if (isRecyclable && recycleIngredientId) {
      return { destination: 'recycle', reason: 'DLV depassee mais produit recyclable — recyclage en production recommande.' };
    }
    return { destination: 'waste', reason: 'DLV depassee — destruction obligatoire pour securite alimentaire.' };
  }

  // 3. Heures d'exposition depassees
  if (displayExpiresAt && displayExpiresAt <= now) {
    if (isRecyclable && recycleIngredientId) {
      return { destination: 'recycle', reason: 'Duree d\'exposition maximale atteinte — recyclage recommande.' };
    }
    return { destination: 'waste', reason: 'Duree d\'exposition maximale atteinte — destruction necessaire.' };
  }

  // 4. Produit vente du jour (pains, viennoiseries) — pas de multi-jours sauf si reexposable
  if (saleType === 'jour') {
    if (isReexposable && currentReexCount < maxReexpositions) {
      return { destination: 'reexpose', reason: `Vente du jour, re-exposable (${currentReexCount}/${maxReexpositions} reexpositions). DLV encore valide.` };
    }
    if (isRecyclable && recycleIngredientId) {
      if (currentReexCount >= maxReexpositions && maxReexpositions > 0) {
        return { destination: 'recycle', reason: `Nombre max de reexpositions atteint (${currentReexCount}/${maxReexpositions}) — recyclage.` };
      }
      return { destination: 'recycle', reason: 'Produit du jour non re-exposable mais recyclable — recyclage en production.' };
    }
    if (currentReexCount >= maxReexpositions && maxReexpositions > 0) {
      return { destination: 'waste', reason: `Nombre max de reexpositions atteint (${currentReexCount}/${maxReexpositions}) — destruction.` };
    }
    return { destination: 'waste', reason: 'Produit du jour non re-exposable et non recyclable — destruction.' };
  }

  // 5. Produit DLV (patisseries, gateaux, specialites) — multi-jours possible
  if (saleType === 'dlv') {
    // DLV non depassee et reexposable
    if (isReexposable && currentReexCount < maxReexpositions) {
      // Verifier qu'il reste des jours de DLV
      if (expiresAt && shelfLifeDays > 0) {
        const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursLeft > 24) {
          return { destination: 'reexpose', reason: `DLV valide encore ${Math.round(hoursLeft / 24)}j. Re-exposition autorisee (${currentReexCount}/${maxReexpositions}).` };
        }
        // Moins de 24h restantes
        if (isRecyclable && recycleIngredientId) {
          return { destination: 'recycle', reason: `DLV expire dans moins de 24h — recyclage prefere a la re-exposition.` };
        }
        return { destination: 'reexpose', reason: `DLV expire demain — derniere re-exposition (${currentReexCount}/${maxReexpositions}).` };
      }
      return { destination: 'reexpose', reason: `Produit DLV re-exposable (${currentReexCount}/${maxReexpositions}).` };
    }
    // Max reexpositions atteint
    if (currentReexCount >= maxReexpositions && maxReexpositions > 0) {
      if (isRecyclable && recycleIngredientId) {
        return { destination: 'recycle', reason: `Max reexpositions atteint — recyclage recommande.` };
      }
      return { destination: 'waste', reason: `Max reexpositions atteint (${currentReexCount}/${maxReexpositions}) — destruction.` };
    }
    // Non reexposable mais DLV valide — on garde quand meme (ex: patisserie en vitrine froide)
    if (expiresAt && expiresAt > now) {
      const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursLeft > 24) {
        return { destination: 'reexpose', reason: `DLV encore valide (${Math.round(hoursLeft / 24)}j restants) — maintien en vitrine.` };
      }
    }
    if (isRecyclable && recycleIngredientId) {
      return { destination: 'recycle', reason: 'Produit DLV non re-exposable — recyclage possible.' };
    }
    return { destination: 'waste', reason: 'Produit DLV non re-exposable et non recyclable — destruction.' };
  }

  // Fallback
  if (isRecyclable && recycleIngredientId) {
    return { destination: 'recycle', reason: 'Produit recyclable — recyclage en production.' };
  }
  return { destination: 'waste', reason: 'Aucune option de conservation ou recyclage — destruction.' };
}

export const unsoldDecisionRepository = {

  /**
   * Charge les invendus avec suggestion automatique pour chaque produit.
   * Appele quand l'operateur ouvre l'ecran de decisions invendus.
   */
  async getUnsoldWithSuggestions(storeId: string) {
    const tz = getUserTimezone();
    const result = await db.query(`
      SELECT
        pss.product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.cost_price,
        p.price,
        c.name as category_name,
        c.slug as category_slug,
        p.shelf_life_days,
        p.display_life_hours,
        p.is_reexposable,
        p.is_recyclable,
        p.recycle_ingredient_id,
        p.max_reexpositions,
        p.sale_type,
        ri.name as recycle_ingredient_name,
        COALESCE(pss.stock_quantity, 0)::int as current_stock,
        COALESCE(
          (SELECT SUM(si.quantity)
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.store_id = $1
             AND DATE(s.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}')
             AND si.product_id = pss.product_id),
          0
        )::int as sold_qty,
        COALESCE(
          (SELECT SUM(COALESCE(ri2.qty_received, ri2.qty_to_store, ri2.requested_quantity))
           FROM replenishment_request_items ri2
           JOIN replenishment_requests rr2 ON rr2.id = ri2.request_id
           WHERE rr2.store_id = $1
             AND DATE(rr2.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}')
             AND rr2.status IN ('closed', 'closed_with_discrepancy', 'transferred', 'preparing', 'acknowledged', 'partially_received')
             AND ri2.product_id = pss.product_id),
          0
        )::int as replenished_today_qty,
        COALESCE(pdt.current_reexposition_count, 0) as reexposition_count,
        pdt.display_expires_at,
        pdt.produced_at,
        pdt.expires_at,
        pdt.status as display_status
      FROM product_store_stock pss
      JOIN products p ON p.id = pss.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN ingredients ri ON ri.id = p.recycle_ingredient_id
      LEFT JOIN LATERAL (
        SELECT pdt2.current_reexposition_count, pdt2.display_expires_at, pdt2.produced_at, pdt2.expires_at, pdt2.status
        FROM product_display_tracking pdt2
        WHERE pdt2.product_id = pss.product_id AND pdt2.store_id = $1 AND pdt2.status = 'active'
        ORDER BY pdt2.produced_at DESC LIMIT 1
      ) pdt ON true
      WHERE pss.store_id = $1
        AND COALESCE(pss.stock_quantity, 0) > 0
      ORDER BY c.name, p.name
    `, [storeId]);

    // Enrichir chaque produit avec la suggestion automatique
    return result.rows.map(row => {
      const suggestion = computeSuggestion(row);
      return {
        ...row,
        suggested_destination: suggestion.destination,
        suggested_reason: suggestion.reason,
      };
    });
  },

  /**
   * Enregistre les decisions invendus + applique les effets sur le stock.
   * Chaque produit a une destination finale (acceptee ou overridee par l'operateur).
   */
  async saveDecisions(data: {
    storeId: string;
    sessionId?: string;
    checkId?: string;
    decidedBy: string;
    closeType?: string;
    decisions: {
      productId: string;
      productName: string;
      categoryName?: string;
      initialQty: number;
      soldQty: number;
      remainingQty: number;
      suggestedDestination: string;
      suggestedReason: string;
      finalDestination: string;
      overrideReason?: string;
      // Snapshot produit
      shelfLifeDays?: number;
      displayLifeHours?: number;
      isReexposable?: boolean;
      maxReexpositions?: number;
      currentReexpositionCount?: number;
      isRecyclable?: boolean;
      recycleIngredientId?: string;
      saleType?: string;
      displayExpiresAt?: string;
      expiresAt?: string;
      producedAt?: string;
      unitCost?: number;
    }[];
    notes?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Creer l'inventaire check si pas encore fait
      let checkId = data.checkId;
      if (!checkId) {
        let totalReplenished = 0, totalSold = 0, totalRemaining = 0, totalDiscrepancy = 0;
        for (const d of data.decisions) {
          totalReplenished += d.initialQty;
          totalSold += d.soldQty;
          totalRemaining += d.remainingQty;
          totalDiscrepancy += (d.initialQty - d.soldQty - d.remainingQty);
        }
        const checkResult = await client.query(`
          INSERT INTO daily_inventory_checks (store_id, session_id, checked_by, total_replenished, total_sold, total_remaining, total_discrepancy, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [data.storeId, data.sessionId || null, data.decidedBy, totalReplenished, totalSold, totalRemaining, totalDiscrepancy, data.notes || null]);
        checkId = checkResult.rows[0].id;
      }

      const savedIds: string[] = [];

      for (const d of data.decisions) {
        const discrepancy = (d.initialQty - d.soldQty) - d.remainingQty;
        const isOverride = d.finalDestination !== d.suggestedDestination;
        const unitCost = d.unitCost || 0;
        const totalCost = unitCost * d.remainingQty;

        // Inserer la decision
        const decResult = await client.query(`
          INSERT INTO unsold_decisions (
            store_id, session_id, check_id, product_id, product_name, category_name,
            initial_qty, sold_qty, remaining_qty, discrepancy,
            suggested_destination, suggested_reason, final_destination, override_reason, is_override,
            shelf_life_days, display_life_hours, is_reexposable, max_reexpositions,
            current_reexposition_count, is_recyclable, recycle_ingredient_id, sale_type,
            display_expires_at, expires_at, produced_at,
            unit_cost, total_cost, decided_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19,
            $20, $21, $22, $23,
            $24, $25, $26,
            $27, $28, $29
          ) RETURNING id
        `, [
          data.storeId, data.sessionId || null, checkId, d.productId, d.productName, d.categoryName || null,
          d.initialQty, d.soldQty, d.remainingQty, discrepancy,
          d.suggestedDestination, d.suggestedReason, d.finalDestination, d.overrideReason || null, isOverride,
          d.shelfLifeDays ?? null, d.displayLifeHours ?? null, d.isReexposable ?? false, d.maxReexpositions ?? 0,
          d.currentReexpositionCount ?? 0, d.isRecyclable ?? false, d.recycleIngredientId || null, d.saleType || 'jour',
          d.displayExpiresAt || null, d.expiresAt || null, d.producedAt || null,
          unitCost, totalCost, data.decidedBy,
        ]);
        savedIds.push(decResult.rows[0].id);

        // Aussi inserer dans daily_inventory_check_items pour coherence
        await client.query(`
          INSERT INTO daily_inventory_check_items (check_id, product_id, product_name, replenished_qty, sold_qty, remaining_qty, discrepancy, destination, display_status, reexposition_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [checkId, d.productId, d.productName, d.initialQty, d.soldQty, d.remainingQty, discrepancy,
            d.finalDestination, 'ok', d.currentReexpositionCount ?? 0]);

        // 2. Appliquer les effets sur le stock (skip en mode passation — inventaire uniquement)
        const isPassation = data.closeType === 'passation';
        if (d.remainingQty > 0 && !isPassation) {
          if (d.finalDestination === 'recycle') {
            // Reduire stock produit
            await client.query(
              `UPDATE product_store_stock SET stock_quantity = GREATEST(0, stock_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [d.remainingQty, d.productId, data.storeId]
            );
            // Incrementer stock ingredient de recyclage
            if (d.recycleIngredientId) {
              // Lock inventory row before increment
              await client.query(
                `SELECT id FROM inventory WHERE ingredient_id = $1 AND store_id = $2 FOR UPDATE`,
                [d.recycleIngredientId, data.storeId]
              );
              await client.query(
                `UPDATE inventory SET current_quantity = current_quantity + $1, updated_at = NOW()
                 WHERE ingredient_id = $2 AND store_id = $3`,
                [d.remainingQty, d.recycleIngredientId, data.storeId]
              );
              await client.query(
                `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
                 VALUES ($1, 'recycle', $2, $3, $4, $5)`,
                [d.recycleIngredientId, d.remainingQty,
                 `Recyclage invendu: ${d.productName} x${d.remainingQty}`,
                 data.decidedBy, data.storeId]
              );
            }
            // Tracker: produit recycle
            await client.query(
              `UPDATE product_display_tracking SET status = 'recycled', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [d.productId, data.storeId]
            );
            // Enregistrer en product_losses type recyclage
            await client.query(
              `INSERT INTO product_losses (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost, ingredients_consumed, declared_by, store_id)
               VALUES ($1, $2, 'recyclage', 'recycle', $3, $4, $5, true, $6, $7)`,
              [d.productId, d.remainingQty, `Recyclage fin de journee: ${d.productName}`, unitCost, totalCost, data.decidedBy, data.storeId]
            );

          } else if (d.finalDestination === 'waste') {
            // Reduire stock produit
            await client.query(
              `UPDATE product_store_stock SET stock_quantity = GREATEST(0, stock_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [d.remainingQty, d.productId, data.storeId]
            );
            // Transaction stock
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
              [d.productId, -d.remainingQty, `Perte fin de journee: ${d.productName} x${d.remainingQty}`, data.decidedBy, data.storeId]
            );
            // Enregistrer en product_losses
            const lossReason = (d.expiresAt && new Date(d.expiresAt) <= getLocalNow()) ? 'perime' : 'invendu_fin_journee';
            const lossType = lossReason === 'perime' ? 'perime' : 'vitrine';
            await client.query(
              `INSERT INTO product_losses (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost, ingredients_consumed, declared_by, store_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
              [d.productId, d.remainingQty, lossType, lossReason,
               `Destruction fin de journee: ${d.productName}`, unitCost, totalCost, data.decidedBy, data.storeId]
            );
            // Tracker: produit gaspille
            await client.query(
              `UPDATE product_display_tracking SET status = 'wasted', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [d.productId, data.storeId]
            );

          } else if (d.finalDestination === 'reexpose') {
            // Increment reexposition counter, stock reste
            const reexCount = d.currentReexpositionCount ?? 0;
            await client.query(
              `INSERT INTO product_display_tracking (product_id, store_id, current_reexposition_count, first_displayed_at, last_reexposed_at, status)
               VALUES ($1, $2, $3, NOW(), NOW(), 'active')
               ON CONFLICT (product_id, store_id, first_displayed_at) DO UPDATE
               SET current_reexposition_count = product_display_tracking.current_reexposition_count + 1,
                   last_reexposed_at = NOW(), updated_at = NOW()`,
              [d.productId, data.storeId, reexCount + 1]
            );
          }
        }
      }

      await client.query('COMMIT');
      return { checkId, decisionIds: savedIds, count: savedIds.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Historique des decisions par magasin/date
   */
  async findAll(filters: { storeId?: string; dateFrom?: string; dateTo?: string; destination?: string; productId?: string; limit?: number; offset?: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    const tz = getUserTimezone();

    if (filters.storeId) {
      conditions.push(`ud.store_id = $${idx++}`);
      params.push(filters.storeId);
    }
    if (filters.dateFrom) {
      conditions.push(`DATE(ud.created_at AT TIME ZONE '${tz}') >= $${idx++}`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push(`DATE(ud.created_at AT TIME ZONE '${tz}') <= $${idx++}`);
      params.push(filters.dateTo);
    }
    if (filters.destination) {
      conditions.push(`ud.final_destination = $${idx++}`);
      params.push(filters.destination);
    }
    if (filters.productId) {
      conditions.push(`ud.product_id = $${idx++}`);
      params.push(filters.productId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const countResult = await db.query(`SELECT COUNT(*) FROM unsold_decisions ud ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const result = await db.query(`
      SELECT ud.*,
             u.first_name as decided_by_first_name, u.last_name as decided_by_last_name
      FROM unsold_decisions ud
      LEFT JOIN users u ON u.id = ud.decided_by
      ${where}
      ORDER BY ud.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    return { rows: result.rows, total };
  },

  /**
   * Statistiques tableau de bord invendus.
   * Retourne: par destination, par categorie, top produits pertes, tendances quotidiennes
   */
  async stats(filters: { storeId?: string; month: number; year: number }) {
    const tz = getUserTimezone();
    const storeCondition = filters.storeId ? `AND ud.store_id = $3` : '';
    const params: (string | number)[] = [filters.month, filters.year];
    if (filters.storeId) params.push(filters.storeId);

    // Par destination
    const byDestination = await db.query(`
      SELECT ud.final_destination,
             COUNT(*) as decision_count,
             SUM(ud.remaining_qty) as total_qty,
             SUM(ud.total_cost) as total_cost
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
      GROUP BY ud.final_destination
    `, params);

    // Par categorie + destination
    const byCategory = await db.query(`
      SELECT ud.category_name,
             ud.final_destination,
             SUM(ud.remaining_qty) as total_qty,
             SUM(ud.total_cost) as total_cost
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
        AND ud.remaining_qty > 0
      GROUP BY ud.category_name, ud.final_destination
      ORDER BY ud.category_name
    `, params);

    // Top produits avec le plus de pertes (waste)
    const topWasteProducts = await db.query(`
      SELECT ud.product_id, ud.product_name, ud.category_name,
             COUNT(*) as waste_count,
             SUM(ud.remaining_qty) as total_qty,
             SUM(ud.total_cost) as total_cost
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
        AND ud.final_destination = 'waste'
        AND ud.remaining_qty > 0
      GROUP BY ud.product_id, ud.product_name, ud.category_name
      ORDER BY SUM(ud.total_cost) DESC
      LIMIT 10
    `, params);

    // Tendance quotidienne
    const daily = await db.query(`
      SELECT DATE(ud.created_at AT TIME ZONE '${tz}') as date,
             ud.final_destination,
             SUM(ud.remaining_qty) as total_qty,
             SUM(ud.total_cost) as total_cost,
             COUNT(*) as count
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
        AND ud.remaining_qty > 0
      GROUP BY DATE(ud.created_at AT TIME ZONE '${tz}'), ud.final_destination
      ORDER BY date
    `, params);

    // Taux d'override (operateur a change la suggestion)
    const overrideRate = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE ud.is_override) as override_count,
        COUNT(*) as total_count
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
        AND ud.remaining_qty > 0
    `, params);

    // Produits avec taux de destruction recurrent eleve (alerte surproduction)
    const recurringWaste = await db.query(`
      SELECT ud.product_id, ud.product_name, ud.category_name,
             COUNT(DISTINCT DATE(ud.created_at AT TIME ZONE '${tz}')) as waste_days,
             SUM(ud.remaining_qty) as total_qty,
             SUM(ud.total_cost) as total_cost
      FROM unsold_decisions ud
      WHERE EXTRACT(MONTH FROM ud.created_at AT TIME ZONE '${tz}') = $1
        AND EXTRACT(YEAR FROM ud.created_at AT TIME ZONE '${tz}') = $2
        ${storeCondition}
        AND ud.final_destination = 'waste'
        AND ud.remaining_qty > 0
      GROUP BY ud.product_id, ud.product_name, ud.category_name
      HAVING COUNT(DISTINCT DATE(ud.created_at AT TIME ZONE '${tz}')) >= 5
      ORDER BY COUNT(DISTINCT DATE(ud.created_at AT TIME ZONE '${tz}')) DESC
    `, params);

    return {
      byDestination: byDestination.rows,
      byCategory: byCategory.rows,
      topWasteProducts: topWasteProducts.rows,
      daily: daily.rows,
      overrideRate: overrideRate.rows[0] || { override_count: 0, total_count: 0 },
      recurringWaste: recurringWaste.rows,
    };
  },

  /**
   * Verifie si des decisions ont deja ete enregistrees pour la session en cours
   */
  async findBySession(sessionId: string) {
    const result = await db.query(
      `SELECT * FROM unsold_decisions WHERE session_id = $1 ORDER BY created_at`,
      [sessionId]
    );
    return result.rows;
  },
};

export { computeSuggestion };
