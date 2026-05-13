import { db } from '../config/database.js';
import { getUserTimezone, getLocalNow } from '../utils/timezone.js';
import { productLotRepository } from './product-lot.repository.js';

/**
 * Moteur de suggestion intelligent pour le devenir des invendus.
 * Determine la destination (reexpose / recycle / waste) selon :
 *   - DLV (date limite de vente) et heures d'exposition
 *   - Nombre de reexpositions max atteint ou non
 *   - Recyclabilite du produit et ingredient de recyclage configure
 *   - Type de vente (jour / dlv / commande)
 */
function computeSuggestion(product: Record<string, unknown>): { destination: 'reexpose' | 'recycle' | 'waste' | 'retour_stock'; reason: string } {
  const now = getLocalNow();
  const saleType = (product.sale_type as string) || 'jour';
  const shelfLifeDays = parseInt(String(product.shelf_life_days)) || 0;
  const displayLifeHours = parseInt(String(product.display_life_hours)) || 0;
  const isReexposable = product.is_reexposable as boolean;
  // Si is_reexposable=true mais max_reexpositions non configure (=0), on autorise
  // 1 reexposition par defaut (J+1). L'admin peut surcharger via la fiche produit.
  const maxReexpositionsRaw = parseInt(String(product.max_reexpositions)) || 0;
  const maxReexpositions = isReexposable && maxReexpositionsRaw === 0 ? 1 : maxReexpositionsRaw;
  const currentReexCount = parseInt(String(product.current_reexposition_count || product.reexposition_count)) || 0;
  const isRecyclable = product.is_recyclable as boolean;
  const recycleIngredientIdLegacy = product.recycle_ingredient_id as string | null;
  // Multi-destinations: array de { ingredient_id, label, ingredient_name, unit, yield_ratio }
  // injecté par la requête SQL via product_recycle_destinations.
  const recycleDestinations = (product.recycle_destinations as Array<{ ingredient_id: string }> | null) || null;
  // On considère le produit comme ayant une cible de recyclage si:
  //   (a) la nouvelle table multi-destinations contient au moins une ligne active, OU
  //   (b) le champ legacy recycle_ingredient_id est encore renseigné (compat ascendante)
  const recycleIngredientId =
    (recycleDestinations && recycleDestinations.length > 0
      ? recycleDestinations[0].ingredient_id
      : recycleIngredientIdLegacy) || null;
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
    // Non reexposable et DLV (display) > 1 jour : retour reserve possible (vitrine froide)
    // Les produits dont la DLV vitrine est <= 24h ne peuvent pas faire un J+1 quel
    // que soit le shelf_life_days, parce que l'expo cumulee depasserait la limite.
    if (!isReexposable && displayLifeHours > 24 && expiresAt && expiresAt > now) {
      const hoursLeftDLC = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursLeftDLC > 24) {
        return { destination: 'retour_stock', reason: `DLV vitrine ${displayLifeHours}h, DLC encore valide (${Math.round(hoursLeftDLC / 24)}j) — retour reserve.` };
      }
    }
    if (isRecyclable && recycleIngredientId) {
      return { destination: 'recycle', reason: 'Produit DLV non re-exposable — recyclage possible.' };
    }
    return { destination: 'waste', reason: `Produit non re-exposable (DLV vitrine ${displayLifeHours}h) — destruction en fin de journee.` };
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
   *
   * Fenetre de comptabilisation :
   *   - Si une session de caisse est ouverte pour le store -> depuis opened_at jusqu'a maintenant
   *     (gere proprement les shifts qui chevauchent minuit)
   *   - Sinon fallback -> journee locale courante
   *
   * Couverture :
   *   - Produits avec stock magasin > 0 (vitrine theorique)
   *   - Produits approvisionnes pendant la fenetre (meme si tout vendu -> controle approv vs vendus)
   *   - Produits vendus pendant la fenetre (controle de vente, meme si stock = 0)
   */
  async getUnsoldWithSuggestions(storeId: string, closeType?: string) {
    const tz = getUserTimezone();
    // Fenetre d'analyse : TOUJOURS cloisonnee par shift.
    //   -> depuis la derniere fermeture (peu importe son type) OU l'ouverture de la session courante.
    //   On veut voir ce qui s'est passe DANS LE SHIFT COURANT uniquement (approvisionnement,
    //   ventes, comptage vitrine du moment), peu importe que ce soit une passation ou une
    //   fin de journee. Chaque shift ne compte que son propre approv et sa propre passation
    //   recue, sans cumuler les shifts anterieurs deja cloturres.
    void closeType;
    const windowResult = await db.query(
      `SELECT
         (SELECT closed_at FROM cash_register_sessions
           WHERE store_id = $1 AND status = 'closed' AND closed_at IS NOT NULL
           ORDER BY closed_at DESC LIMIT 1) as last_closed_at,
         (SELECT opened_at FROM cash_register_sessions
           WHERE store_id = $1 AND status = 'open'
           ORDER BY opened_at DESC LIMIT 1) as current_open_at`,
      [storeId]
    );
    const lastClosedAt: Date | null = windowResult.rows[0]?.last_closed_at ?? null;
    const currentOpenAt: Date | null = windowResult.rows[0]?.current_open_at ?? null;
    let windowStart: Date | null = lastClosedAt ?? currentOpenAt ?? null;
    // Garde-fou : si la session est restee ouverte depuis plus de 24h (oubli de fermeture),
    // on ne cumule pas tout l'historique. On limite a 24h glissantes pour eviter des comptes
    // d'approvisionnement aberrants (ex : 5 jours de stock cumule).
    if (windowStart) {
      const minStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (windowStart < minStart) windowStart = minStart;
    }
    const result = await db.query(`
      WITH sales_window AS (
        SELECT si.product_id, SUM(si.quantity)::int as sold_qty
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
         WHERE s.store_id = $1
           AND (
             ($2::timestamptz IS NOT NULL AND s.created_at >= $2::timestamptz)
             OR ($2::timestamptz IS NULL AND DATE(s.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}'))
           )
         GROUP BY si.product_id
      ),
      replen_window AS (
        SELECT ri2.product_id,
               SUM(COALESCE(ri2.qty_received, ri2.qty_to_store, ri2.requested_quantity))::int as replenished_qty
          FROM replenishment_request_items ri2
          JOIN replenishment_requests rr2 ON rr2.id = ri2.request_id
         WHERE rr2.store_id = $1
           AND (
             ($2::timestamptz IS NOT NULL AND rr2.created_at >= $2::timestamptz)
             OR ($2::timestamptz IS NULL AND DATE(rr2.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}'))
           )
           AND rr2.status IN ('closed', 'closed_with_discrepancy', 'transferred', 'preparing', 'acknowledged', 'partially_received')
         GROUP BY ri2.product_id
      ),
      relevant_products AS (
        SELECT pss.product_id, COALESCE(pss.vitrine_quantity, 0)::int as current_stock
          FROM product_store_stock pss
         WHERE pss.store_id = $1 AND COALESCE(pss.vitrine_quantity, 0) > 0
        UNION
        SELECT st.product_id, 0 FROM sales_window st
        UNION
        SELECT rt.product_id, 0 FROM replen_window rt
      )
      SELECT
        rp.product_id,
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
        -- current_stock = source de verite du stock vitrine maintenant (utilise comme theorique cote UI)
        -- initial_stock = derive algebriquement : ce qu'il y avait au debut de la fenetre
        --               = stock_maintenant + ventes_depuis - approv_depuis
        MAX(rp.current_stock) as current_stock,
        COALESCE(st.sold_qty, 0)::int as sold_qty,
        COALESCE(rt.replenished_qty, 0)::int as replenished_today_qty,
        GREATEST(0, MAX(rp.current_stock) + COALESCE(st.sold_qty, 0) - COALESCE(rt.replenished_qty, 0))::int as initial_stock,
        COALESCE(pdt.current_reexposition_count, 0) as reexposition_count,
        pdt.display_expires_at,
        pdt.produced_at,
        pdt.expires_at,
        pdt.status as display_status,
        rd.destinations as recycle_destinations
      FROM relevant_products rp
      JOIN products p ON p.id = rp.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN ingredients ri ON ri.id = p.recycle_ingredient_id
      LEFT JOIN sales_window st ON st.product_id = rp.product_id
      LEFT JOIN replen_window rt ON rt.product_id = rp.product_id
      LEFT JOIN LATERAL (
        -- Priorise la ligne la plus recente AVEC produced_at + expires_at remplis
        -- (les lignes "fantomes" creees par les reexpositions n'ont pas ces infos
        -- et fausseraient la suggestion en se faisant passer pour la ligne courante).
        SELECT pdt2.current_reexposition_count, pdt2.display_expires_at, pdt2.produced_at, pdt2.expires_at, pdt2.status
        FROM product_display_tracking pdt2
        WHERE pdt2.product_id = rp.product_id AND pdt2.store_id = $1 AND pdt2.status = 'active'
        ORDER BY (pdt2.produced_at IS NULL), pdt2.produced_at DESC, pdt2.updated_at DESC
        LIMIT 1
      ) pdt ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'ingredient_id', prd.ingredient_id,
          'label', prd.label,
          'ingredient_name', i.name,
          'unit', i.unit,
          'yield_ratio', prd.yield_ratio
        ) ORDER BY prd.display_order, i.name) as destinations
        FROM product_recycle_destinations prd
        JOIN ingredients i ON i.id = prd.ingredient_id
        WHERE prd.product_id = rp.product_id AND prd.is_active = true
      ) rd ON true
      GROUP BY rp.product_id, p.name, p.image_url, p.cost_price, p.price,
               c.name, c.slug, p.shelf_life_days, p.display_life_hours,
               p.is_reexposable, p.is_recyclable, p.recycle_ingredient_id, p.max_reexpositions,
               p.sale_type, ri.name, st.sold_qty, rt.replenished_qty,
               pdt.current_reexposition_count, pdt.display_expires_at, pdt.produced_at,
               pdt.expires_at, pdt.status, rd.destinations
      ORDER BY c.name, p.name
    `, [storeId, windowStart]);

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
      discrepancyMotif?: string;
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
          // Phase 1 — FEFO sur product_lots vitrine pour identifier les lots impactes
          // (sert au mirror sur lots + tracabilite chaine).
          // includeExpired=true car on traite ici aussi les destructions / recyclages
          // de lots deja expires (DLV ou DDE). Pour retour_stock on filtrera les
          // lots non-expires explicitement plus bas.
          const fefoPlan = await productLotRepository.planFefoVitrineConsumption(
            client, d.productId, data.storeId, d.remainingQty,
            { includeExpired: d.finalDestination !== 'retour_stock' }
          );
          const primaryLotId = fefoPlan[0]?.lotId ?? null;

          if (d.finalDestination === 'recycle') {
            // Vitrine -> ingredient recycle. d.recycleIngredientId peut etre overide
            // par la caissiere via le dropdown multi-destinations (Phase recyclage).
            await client.query(
              `UPDATE product_store_stock SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [d.remainingQty, d.productId, data.storeId]
            );

            // Mirror sur product_lots : recycled_qty += qty pour chaque lot consomme FEFO
            for (const step of fefoPlan) {
              await productLotRepository.consumeVitrineRecycle(client, step.lotId, step.qty);
            }

            let recycledIngredientLotId: string | null = null;
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

              // Phase 1 — Cree un ingredient_lot dedie au lot recycle pour preserver
              // la DLC residuelle et le lien arriere vers le product_lot source.
              // Permet le FEFO ingredient et l'audit "ce sachet vient de telle fournee".
              const sourceLot = primaryLotId ? await productLotRepository.findById(primaryLotId) : null;
              const dlcResiduelle = sourceLot?.expires_at ?? null;
              const sourceLotNumber = sourceLot?.lot_number ?? 'NOSRC';
              const recLotNumber = `REC-${sourceLotNumber}-${Date.now().toString().slice(-6)}`.slice(0, 50);

              const ingLotResult = await client.query(
                `INSERT INTO ingredient_lots
                   (ingredient_id, lot_number, supplier_lot_number,
                    quantity_received, quantity_remaining, economat_quantity, pesage_quantity, unit_cost,
                    manufactured_date, expiration_date, received_at, store_id,
                    status, notes, source_product_lot_id)
                 VALUES ($1, $2, $3, $4, $4, $4, 0, $5, CURRENT_DATE, $6, CURRENT_DATE, $7, 'active', $8, $9)
                 RETURNING id`,
                [
                  d.recycleIngredientId, recLotNumber, sourceLotNumber,
                  d.remainingQty, unitCost,
                  dlcResiduelle, data.storeId,
                  `Recyclage de ${d.productName} (lot ${sourceLotNumber}) x${d.remainingQty}`,
                  primaryLotId,
                ]
              );
              recycledIngredientLotId = ingLotResult.rows[0].id;

              await client.query(
                `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
                 VALUES ($1, 'recycle', $2, $3, $4, $5, $6)`,
                [d.recycleIngredientId, d.remainingQty,
                 `Recyclage invendu: ${d.productName} x${d.remainingQty}`,
                 data.decidedBy, data.storeId, recycledIngredientLotId]
              );
            }

            // Tracker: produit recycle
            await client.query(
              `UPDATE product_display_tracking SET status = 'recycled', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [d.productId, data.storeId]
            );
            // Enregistrer en product_losses type recyclage avec lien chaine
            await client.query(
              `INSERT INTO product_losses
                 (product_id, quantity, loss_type, reason, reason_note,
                  unit_cost, total_cost, ingredients_consumed,
                  declared_by, store_id, source_product_lot_id, recycled_ingredient_lot_id)
               VALUES ($1, $2, 'recyclage', 'recycle', $3, $4, $5, true, $6, $7, $8, $9)`,
              [d.productId, d.remainingQty, `Recyclage fin de journee: ${d.productName}`,
               unitCost, totalCost, data.decidedBy, data.storeId,
               primaryLotId, recycledIngredientLotId]
            );

          } else if (d.finalDestination === 'waste') {
            // Les invendus sont exposes en vitrine — decrement de vitrine_quantity
            await client.query(
              `UPDATE product_store_stock SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [d.remainingQty, d.productId, data.storeId]
            );
            // Mirror sur product_lots
            for (const step of fefoPlan) {
              await productLotRepository.consumeVitrineWaste(client, step.lotId, step.qty);
            }
            // Transaction stock
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
              [d.productId, -d.remainingQty, `Perte fin de journee: ${d.productName} x${d.remainingQty}`, data.decidedBy, data.storeId]
            );
            const lossReason = (d.expiresAt && new Date(d.expiresAt) <= getLocalNow()) ? 'perime' : 'invendu_fin_journee';
            const lossType = lossReason === 'perime' ? 'perime' : 'vitrine';
            await client.query(
              `INSERT INTO product_losses
                 (product_id, quantity, loss_type, reason, reason_note,
                  unit_cost, total_cost, ingredients_consumed,
                  declared_by, store_id, source_product_lot_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10)`,
              [d.productId, d.remainingQty, lossType, lossReason,
               `Destruction fin de journee: ${d.productName}`,
               unitCost, totalCost, data.decidedBy, data.storeId, primaryLotId]
            );
            await client.query(
              `UPDATE product_display_tracking SET status = 'wasted', updated_at = NOW()
               WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [d.productId, data.storeId]
            );

          } else if (d.finalDestination === 'retour_stock') {
            // Phase 2 — Retour reserve : vitrine -> backroom sans toucher la DLV
            // (modele Cumule). Seuls les produits revendables (DLC OK + DLV restante)
            // doivent prendre cette branche — controle cote frontend via computeSuggestion.
            await client.query(
              `UPDATE product_store_stock
               SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1),
                   stock_quantity   = stock_quantity + $1,
                   updated_at = NOW()
               WHERE product_id = $2 AND store_id = $3`,
              [d.remainingQty, d.productId, data.storeId]
            );
            // Mirror sur product_lots : returnVitrineToBackroom (vitrine_qty - qty, backroom_qty + qty)
            for (const step of fefoPlan) {
              await productLotRepository.returnVitrineToBackroom(client, step.lotId, step.qty);
            }
            // Transaction stock — type 'retour_invendus' pour distinguer
            // d'un waste ou d'un restock fournisseur.
            await client.query(
              `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
               VALUES ($1, 'retour_invendus', $2, (SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $3), $4, $5, $3)`,
              [d.productId, d.remainingQty,
               `Retour reserve fin de journee: ${d.productName} x${d.remainingQty}`,
               data.decidedBy, data.storeId]
            );
            // PAS d'ecriture dans product_losses (le retour n'est pas une perte).

          } else if (d.finalDestination === 'reexpose') {
            // Increment reexposition counter, stock reste en vitrine
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

          // Memoriser le lot principal sur la decision pour audit
          if (primaryLotId) {
            await client.query(
              `UPDATE unsold_decisions SET product_lot_id = $1 WHERE id = $2`,
              [primaryLotId, decResult.rows[0].id]
            );
          }
        }

        // ─── Phase 5 — Comptage physique : ecart inventaire ─────────────────
        // Si la qty physiquement comptee est inferieure au theorique (initial - sold),
        // le manquant est un ecart vitrine (vol/casse/erreur). On le passe en perte
        // type 'vitrine' avec motif 'ecart_inventaire' + note. Aucun effet en passation.
        if (discrepancy > 0 && data.closeType === 'fin_journee') {
          // Decrement vitrine pour les unites manquantes (sortent du systeme)
          await client.query(
            `UPDATE product_store_stock SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
             WHERE product_id = $2 AND store_id = $3`,
            [discrepancy, d.productId, data.storeId]
          );

          // Mirror sur product_lots (FEFO sur ce qui reste apres les decisions principales).
          // includeExpired car l'ecart peut concerner des lots deja expires.
          const ecartFefo = await productLotRepository.planFefoVitrineConsumption(
            client, d.productId, data.storeId, discrepancy, { includeExpired: true }
          );
          for (const step of ecartFefo) {
            await productLotRepository.consumeVitrineWaste(client, step.lotId, step.qty);
          }

          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
             VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
            [d.productId, -discrepancy,
             `Ecart inventaire fin de journee: ${d.productName} x${discrepancy}`,
             data.decidedBy, data.storeId]
          );

          await client.query(
            `INSERT INTO product_losses
               (product_id, quantity, loss_type, reason, reason_note,
                unit_cost, total_cost, ingredients_consumed,
                declared_by, store_id, source_product_lot_id)
             VALUES ($1, $2, 'vitrine', 'ecart_inventaire', $3, $4, $5, true, $6, $7, $8)`,
            [d.productId, discrepancy,
             `Ecart inventaire: ${d.discrepancyMotif || 'Non precise'} (${d.productName} -${discrepancy})`,
             unitCost, unitCost * discrepancy,
             data.decidedBy, data.storeId,
             ecartFefo[0]?.lotId ?? null]
          );
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

  /**
   * Recupere les destinations de recyclage configurees pour un produit.
   * Utilise par l'UI pour proposer un choix multi-destinations a la caissiere.
   */
  async getRecycleDestinations(productId: string) {
    const result = await db.query(
      `SELECT prd.ingredient_id, prd.label, prd.display_order, i.name as ingredient_name, i.unit
       FROM product_recycle_destinations prd
       JOIN ingredients i ON i.id = prd.ingredient_id
       WHERE prd.product_id = $1 AND prd.is_active = true
       ORDER BY prd.display_order, i.name`,
      [productId]
    );
    return result.rows;
  },

  /**
   * Phase 3 — Retourne les unites en vitrine dont la DLC ou la DLV est atteinte / depassee.
   * Sert d'alerte bloquante a la fermeture journee : la caissiere doit confirmer la
   * destruction avant de pouvoir cloturer la caisse.
   *
   * Important : il peut exister PLUSIEURS lignes product_display_tracking actives pour
   * un meme (product, store) — notamment des "fantomes" sans DLC/DLV crees lors d'une
   * reexposition. On detecte donc l'expiration des lors qu'AU MOINS UNE ligne active
   * indique DLC ou DLV depassee. La pire (la plus ancienne) est remontee pour affichage.
   */
  async getExpiredItems(storeId: string) {
    // Source de verite : product_lots (lots actifs avec vitrine_qty > 0).
    // On evite product_display_tracking qui peut contenir des lignes orphelines
    // 'active' qui n'ont pas ete sync avec les lots (faux positifs).
    const result = await db.query(`
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.cost_price,
        p.shelf_life_days,
        p.display_life_hours,
        c.name as category_name,
        pss.vitrine_quantity::numeric as vitrine_qty,
        worst.expires_at,
        worst.display_expires_at,
        worst.produced_at,
        worst.first_displayed_at,
        CASE
          WHEN worst.expires_at IS NOT NULL AND worst.expires_at <= CURRENT_DATE THEN 'dlc_expiree'
          WHEN worst.display_expires_at IS NOT NULL AND worst.display_expires_at <= NOW() THEN 'dlv_expiree'
          ELSE NULL
        END as expiry_reason
      FROM product_store_stock pss
      JOIN products p ON p.id = pss.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN LATERAL (
        -- Pire lot expire en vitrine (DLC depassee OU DLV/DDE depassee)
        SELECT pl.expires_at, pl.display_expires_at, pl.produced_at, pl.first_displayed_at
        FROM product_lots pl
        WHERE pl.product_id = pss.product_id
          AND pl.store_id = pss.store_id
          AND pl.status = 'active'
          AND pl.vitrine_qty > 0
          AND (
            (pl.expires_at IS NOT NULL AND pl.expires_at <= CURRENT_DATE)
            OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at <= NOW())
          )
        ORDER BY pl.expires_at ASC NULLS LAST,
                 pl.display_expires_at ASC NULLS LAST
        LIMIT 1
      ) worst ON true
      WHERE pss.store_id = $1
        AND COALESCE(pss.vitrine_quantity, 0) > 0
      ORDER BY c.name, p.name
    `, [storeId]);
    return result.rows;
  },

  /**
   * Phase 3 — Detruit en bloc les unites expirees confirmees par la caissiere.
   * Pour chaque produit :
   *   1. Decremente vitrine_quantity (clamp a 0 si plus que prevu)
   *   2. Insere une perte (loss_type='perime', reason='dlc_expiree' ou 'dlv_expiree')
   *   3. Logue la transaction (product_stock_transactions type='waste')
   *   4. Marque le tracker display comme wasted
   */
  async destroyExpiredItems(data: {
    storeId: string;
    decidedBy: string;
    items: { productId: string; quantity: number; reason: string; unitCost?: number; productName?: string }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const destroyed: { productId: string; quantity: number; reason: string }[] = [];
      for (const item of data.items) {
        if (item.quantity <= 0) continue;
        const unitCost = item.unitCost ?? 0;
        const totalCost = unitCost * item.quantity;
        const productName = item.productName ?? 'Produit';

        await client.query(
          `UPDATE product_store_stock SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
           WHERE product_id = $2 AND store_id = $3`,
          [item.quantity, item.productId, data.storeId]
        );

        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
          [item.productId, -item.quantity, `Destruction DLV/DLC: ${productName} x${item.quantity}`, data.decidedBy, data.storeId]
        );

        await client.query(
          `INSERT INTO product_losses (product_id, quantity, loss_type, reason, reason_note, unit_cost, total_cost, ingredients_consumed, declared_by, store_id)
           VALUES ($1, $2, 'perime', $3, $4, $5, $6, true, $7, $8)`,
          [item.productId, item.quantity, item.reason || 'perime',
           `Destruction ${item.reason === 'dlc_expiree' ? 'DLC' : 'DLV'} expiree: ${productName}`,
           unitCost, totalCost, data.decidedBy, data.storeId]
        );

        await client.query(
          `UPDATE product_display_tracking SET status = 'wasted', updated_at = NOW()
           WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
          [item.productId, data.storeId]
        );

        destroyed.push({ productId: item.productId, quantity: item.quantity, reason: item.reason });
      }
      await client.query('COMMIT');
      return { destroyed, count: destroyed.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

export { computeSuggestion };
