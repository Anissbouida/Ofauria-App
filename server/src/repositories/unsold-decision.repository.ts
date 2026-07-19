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
   * Fenetre de comptabilisation — TOUJOURS cloisonnee par shift, quel que
   * soit closeType (passation OU fin_journee). Depuis :
   *   - la derniere fermeture (peu importe son type), OU
   *   - l'ouverture de la session courante,
   *   - avec un cap glissant de 24h pour eviter d'aberrer si la session est
   *     restee ouverte plus d'une journee.
   *
   * closeType est accepte pour compat avec l'API mais volontairement ignore :
   * chaque shift ne repond que de son propre appro et de son propre comptage,
   * sans cumuler les shifts anterieurs deja cloturures.
   *
   * Couverture :
   *   - Produits avec stock magasin > 0 (vitrine theorique)
   *   - Produits approvisionnes pendant la fenetre (meme si tout vendu -> controle approv vs vendus)
   *   - Produits vendus pendant la fenetre (controle de vente, meme si stock = 0)
   */
  async getUnsoldWithSuggestions(storeId: string, closeType?: string) {
    const tz = getUserTimezone();
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
      -- N10 — Pertes deja declarees dans la fenetre (LossDeclarationModal,
      -- destroy-expired, ecarts precedents). Sans ce terme, l'initial_stock
      -- derive current + sold - replen sous-estimait la vitrine de depart,
      -- et le clamp GREATEST(0,...) masquait le signe negatif -> l'ecart
      -- inventaire re-comptabilisait des pertes deja tracees.
      losses_window AS (
        SELECT pl.product_id, SUM(pl.quantity)::int as lost_qty
          FROM product_losses pl
         WHERE pl.store_id = $1
           AND (
             ($2::timestamptz IS NOT NULL AND pl.created_at >= $2::timestamptz)
             OR ($2::timestamptz IS NULL AND DATE(pl.created_at AT TIME ZONE '${tz}') = DATE(NOW() AT TIME ZONE '${tz}'))
           )
         GROUP BY pl.product_id
      ),
      relevant_products AS (
        SELECT pss.product_id, COALESCE(pss.vitrine_quantity, 0)::int as current_stock
          FROM product_store_stock pss
         WHERE pss.store_id = $1 AND COALESCE(pss.vitrine_quantity, 0) > 0
        UNION
        SELECT st.product_id, 0 FROM sales_window st
        UNION
        SELECT rt.product_id, 0 FROM replen_window rt
        UNION
        SELECT lw.product_id, 0 FROM losses_window lw
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
        COALESCE(lw.lost_qty, 0)::int as lost_qty,
        -- N10 — Formule complete : initial = current + sold + pertes - approv.
        -- Le GREATEST reste comme garde-fou (initial < 0 signalerait un ecart
        -- deja incoherent avant le comptage, on evite les negatifs cote UI)
        -- mais devient tres rare puisqu'on inclut desormais les pertes deja
        -- declarees dans la fenetre (loss modal, destroy-expired, ecarts).
        GREATEST(0, MAX(rp.current_stock) + COALESCE(st.sold_qty, 0) + COALESCE(lw.lost_qty, 0) - COALESCE(rt.replenished_qty, 0))::int as initial_stock,
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
      LEFT JOIN losses_window lw ON lw.product_id = rp.product_id
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
               p.sale_type, ri.name, st.sold_qty, rt.replenished_qty, lw.lost_qty,
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
    // ─── Idempotence (N3) : refuser un batch sur une session qui a deja des ────
    // decisions. Sans ce garde, un retry reseau ou un usage combine POS +
    // UnsoldDecisionsPage rejouait tous les effets stock (double decrement
    // vitrine, doubles pertes, double recyclage). L'unicite DB (mig 251)
    // protege en dernier recours mais on preferer un 409 explicite.
    if (data.sessionId) {
      const existing = await db.query(
        `SELECT COUNT(*)::int AS n FROM unsold_decisions WHERE session_id = $1`,
        [data.sessionId]
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        const err = new Error('Decisions deja enregistrees pour cette session');
        (err as Error & { code?: string }).code = 'UNSOLD_DECISIONS_ALREADY_SAVED';
        throw err;
      }
    }

    // ─── Re-validation serveur des destinations (F3) ─────────────────────────
    // Les gardes du client (boutons desactives) peuvent etre contournees ou
    // divergent du moteur de suggestion. On recharge la fiche produit et on
    // rejette toute destination incompatible avec ses regles metier (DLC/DLV,
    // is_reexposable, is_recyclable, destinations recyclage configurees).
    // On skip en passation : les destinations y sont neutralisees a 'reexpose'
    // par le controller et aucun effet stock n'est applique.
    const productIds = Array.from(new Set(data.decisions.map((d) => d.productId)));
    const productMeta = new Map<string, {
      is_reexposable: boolean;
      is_recyclable: boolean;
      display_life_hours: number;
      shelf_life_days: number;
      sale_type: string;
      recycle_ingredient_id: string | null;
      recycle_destinations: string[];
      recycle_yields: Map<string, number>;
    }>();
    if (productIds.length > 0 && data.closeType !== 'passation') {
      const prod = await db.query(
        `SELECT p.id, p.is_reexposable, p.is_recyclable,
                COALESCE(p.display_life_hours, 0) AS display_life_hours,
                COALESCE(p.shelf_life_days, 0)   AS shelf_life_days,
                p.sale_type, p.recycle_ingredient_id
           FROM products p
          WHERE p.id = ANY($1::uuid[])`,
        [productIds]
      );
      const dests = await db.query(
        `SELECT product_id, ingredient_id, COALESCE(yield_ratio, 1)::float AS yield_ratio
           FROM product_recycle_destinations
          WHERE product_id = ANY($1::uuid[]) AND is_active = true`,
        [productIds]
      );
      const destByProduct = new Map<string, { id: string; yield: number }[]>();
      for (const r of dests.rows) {
        const arr = destByProduct.get(r.product_id) || [];
        arr.push({ id: r.ingredient_id, yield: r.yield_ratio });
        destByProduct.set(r.product_id, arr);
      }
      for (const r of prod.rows) {
        const rdests = destByProduct.get(r.id) || [];
        productMeta.set(r.id, {
          is_reexposable: r.is_reexposable === true,
          is_recyclable: r.is_recyclable === true,
          display_life_hours: parseInt(String(r.display_life_hours)) || 0,
          shelf_life_days: parseInt(String(r.shelf_life_days)) || 0,
          sale_type: r.sale_type || 'jour',
          recycle_ingredient_id: r.recycle_ingredient_id || null,
          recycle_destinations: rdests.map((x) => x.id),
          recycle_yields: new Map(rdests.map((x) => [x.id, x.yield])),
        });
      }
      for (const d of data.decisions) {
        if ((d.remainingQty ?? 0) <= 0) continue;
        const meta = productMeta.get(d.productId);
        if (!meta) continue;
        const dest = d.finalDestination;
        if (dest === 'reexpose' && !meta.is_reexposable) {
          throw new Error(`Reexposition interdite pour ${d.productName} (produit non reexposable)`);
        }
        if (dest === 'retour_stock') {
          const dlcOk = !d.expiresAt || (new Date(d.expiresAt).getTime() - Date.now()) / 3_600_000 > 24;
          if (meta.display_life_hours <= 24 || !dlcOk) {
            throw new Error(`Retour reserve interdit pour ${d.productName} (DLC/DLV trop courte)`);
          }
        }
        if (dest === 'recycle') {
          const chosen = d.recycleIngredientId || meta.recycle_ingredient_id;
          if (!meta.is_recyclable || !chosen) {
            throw new Error(`Recyclage interdit pour ${d.productName} (destination non configuree)`);
          }
          const allowed = new Set(meta.recycle_destinations);
          if (meta.recycle_ingredient_id) allowed.add(meta.recycle_ingredient_id);
          if (!allowed.has(chosen)) {
            throw new Error(`Destination de recyclage non autorisee pour ${d.productName}`);
          }
        }
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Creer l'inventaire check si pas encore fait.
      // N6 — check_type discriminant : 'passation' pour un changement de shift
      // (le trigger opening ne doit pas s'en emouvoir), 'closing' pour la
      // fermeture journee (declenche le controle d'ouverture du lendemain).
      let checkId = data.checkId;
      if (!checkId) {
        let totalReplenished = 0, totalSold = 0, totalRemaining = 0, totalDiscrepancy = 0;
        for (const d of data.decisions) {
          totalReplenished += d.initialQty;
          totalSold += d.soldQty;
          totalRemaining += d.remainingQty;
          totalDiscrepancy += (d.initialQty - d.soldQty - d.remainingQty);
        }
        const checkType = data.closeType === 'passation' ? 'passation' : 'closing';
        const checkResult = await client.query(`
          INSERT INTO daily_inventory_checks (store_id, session_id, checked_by, total_replenished, total_sold, total_remaining, total_discrepancy, notes, check_type, status, validated_by, validated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'validated', $3, NOW())
          RETURNING id
        `, [data.storeId, data.sessionId || null, data.decidedBy, totalReplenished, totalSold, totalRemaining, totalDiscrepancy, data.notes || null, checkType]);
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
              // N11 — yield_ratio : 0.7 pour baguette->chapelure (perte au sechage).
              // Avant ce fix on ajoutait 1 unite d'ingredient pour 1 produit recycle,
              // surevaluant le stock d'ingredient et faussant le cout de revient.
              const yieldRatio = productMeta.get(d.productId)?.recycle_yields?.get(d.recycleIngredientId) ?? 1;
              const recycledQty = d.remainingQty * yieldRatio;
              // Lock inventory row before increment
              await client.query(
                `SELECT id FROM inventory WHERE ingredient_id = $1 AND store_id = $2 FOR UPDATE`,
                [d.recycleIngredientId, data.storeId]
              );
              await client.query(
                `UPDATE inventory SET current_quantity = current_quantity + $1, updated_at = NOW()
                 WHERE ingredient_id = $2 AND store_id = $3`,
                [recycledQty, d.recycleIngredientId, data.storeId]
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
                  recycledQty, unitCost,
                  dlcResiduelle, data.storeId,
                  `Recyclage de ${d.productName} (lot ${sourceLotNumber}) x${d.remainingQty} @ yield ${yieldRatio}`,
                  primaryLotId,
                ]
              );
              recycledIngredientLotId = ingLotResult.rows[0].id;

              await client.query(
                `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
                 VALUES ($1, 'recycle', $2, $3, $4, $5, $6)`,
                [d.recycleIngredientId, recycledQty,
                 `Recyclage invendu: ${d.productName} x${d.remainingQty} (yield ${yieldRatio})`,
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
            // F1 — Le compteur de reexposition ne s'incrementait jamais :
            // l'INSERT ON CONFLICT (product_id, store_id, first_displayed_at)
            // avec first_displayed_at=NOW() ne matchait jamais, chaque J+1
            // creait une ligne fantome sans produced_at/expires_at que la
            // requete de suggestion ignorait au profit de la ligne d'origine.
            // Fix : UPDATE en priorite la ligne active existante (une seule
            // par (product, store) grace au filtre status='active'), fallback
            // INSERT si le produit n'a jamais eu de tracker.
            const upd = await client.query(
              `UPDATE product_display_tracking
                  SET current_reexposition_count = COALESCE(current_reexposition_count, 0) + 1,
                      last_reexposed_at = NOW(),
                      updated_at = NOW()
                WHERE product_id = $1 AND store_id = $2 AND status = 'active'`,
              [d.productId, data.storeId]
            );
            if (upd.rowCount === 0) {
              await client.query(
                `INSERT INTO product_display_tracking
                   (product_id, store_id, current_reexposition_count, first_displayed_at, last_reexposed_at, status)
                 VALUES ($1, $2, 1, NOW(), NOW(), 'active')`,
                [d.productId, data.storeId]
              );
            }
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
        // N10 — Le surplus (compte > theorique) est traite plus bas : on ne peut
        // pas le mettre en perte (positif) mais on regularise le stock et on
        // trace la transaction. Sans ca, la vitrine reelle divergeait
        // silencieusement du stock systeme.
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

        // ─── N10 — Surplus : compte > theorique ─────────────────────────────
        // Regularise la vitrine a la hausse et trace en transaction 'adjust'.
        // Pas de product_losses (c'est un excedent, pas une perte). En passation
        // on ne modifie rien (comptage contradictoire uniquement).
        if (discrepancy < 0 && data.closeType === 'fin_journee') {
          const surplus = -discrepancy;
          await client.query(
            `UPDATE product_store_stock
                SET vitrine_quantity = vitrine_quantity + $1, updated_at = NOW()
              WHERE product_id = $2 AND store_id = $3`,
            [surplus, d.productId, data.storeId]
          );
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
             VALUES ($1, 'adjust', $2, 0, $3, $4, $5)`,
            [d.productId, surplus,
             `Surplus inventaire fin de journee: ${d.productName} +${surplus} (motif: ${d.discrepancyMotif || 'non precise'})`,
             data.decidedBy, data.storeId]
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
    // F2 — Somme SEULEMENT les vitrine_qty des lots effectivement expires.
    // Avant : on remontait pss.vitrine_quantity (total du produit) + le pire
    // lot -> le POS envoyait quantity = totalVitrine a destroyExpired, et
    // ecrasait le stock frais du meme produit. Correction : quantite exacte
    // agregee sur les seuls lots DLC/DLV depassee.
    const result = await db.query(`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.image_url AS product_image,
        p.cost_price,
        p.shelf_life_days,
        p.display_life_hours,
        c.name AS category_name,
        agg.expired_qty::numeric AS vitrine_qty,
        agg.worst_expires_at AS expires_at,
        agg.worst_display_expires_at AS display_expires_at,
        agg.worst_produced_at AS produced_at,
        agg.worst_first_displayed_at AS first_displayed_at,
        CASE
          WHEN agg.worst_expires_at IS NOT NULL AND agg.worst_expires_at <= CURRENT_DATE THEN 'dlc_expiree'
          WHEN agg.worst_display_expires_at IS NOT NULL AND agg.worst_display_expires_at <= NOW() THEN 'dlv_expiree'
          ELSE NULL
        END AS expiry_reason
      FROM (
        SELECT
          pl.product_id,
          pl.store_id,
          SUM(pl.vitrine_qty)::numeric AS expired_qty,
          MIN(pl.expires_at) AS worst_expires_at,
          MIN(pl.display_expires_at) AS worst_display_expires_at,
          MIN(pl.produced_at) AS worst_produced_at,
          MIN(pl.first_displayed_at) AS worst_first_displayed_at
        FROM product_lots pl
        WHERE pl.store_id = $1
          AND pl.status = 'active'
          AND pl.vitrine_qty > 0
          AND (
            (pl.expires_at IS NOT NULL AND pl.expires_at <= CURRENT_DATE)
            OR (pl.display_expires_at IS NOT NULL AND pl.display_expires_at <= NOW())
          )
        GROUP BY pl.product_id, pl.store_id
      ) agg
      JOIN products p ON p.id = agg.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE agg.expired_qty > 0
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
        const productName = item.productName ?? 'Produit';

        // N4/F2 — FEFO strict sur les lots expires uniquement (aucun lot frais
        // ne doit etre consomme). On borne la destruction a la quantite
        // reellement expiree, sans jamais depasser ce que les lots offrent.
        const expiredLots = await client.query(
          `SELECT id, vitrine_qty, expires_at, display_expires_at
             FROM product_lots
            WHERE product_id = $1 AND store_id = $2
              AND status = 'active' AND vitrine_qty > 0
              AND (
                (expires_at IS NOT NULL AND expires_at <= CURRENT_DATE)
                OR (display_expires_at IS NOT NULL AND display_expires_at <= NOW())
              )
            ORDER BY expires_at ASC NULLS LAST,
                     display_expires_at ASC NULLS LAST,
                     produced_at ASC, id
            FOR UPDATE`,
          [item.productId, data.storeId]
        );

        let remaining = item.quantity;
        const consumedLots: { lotId: string; qty: number }[] = [];
        for (const lot of expiredLots.rows) {
          if (remaining <= 0) break;
          const take = Math.min(parseFloat(String(lot.vitrine_qty)), remaining);
          if (take > 0) {
            consumedLots.push({ lotId: lot.id, qty: take });
            remaining -= take;
          }
        }
        const actualQty = item.quantity - remaining;
        if (actualQty <= 0) continue; // aucun lot expire trouve, on skip
        const totalCost = unitCost * actualQty;

        // Miroir sur product_lots : marquer les lots comme wasted
        for (const step of consumedLots) {
          await productLotRepository.consumeVitrineWaste(client, step.lotId, step.qty);
        }
        const primaryLotId = consumedLots[0]?.lotId ?? null;

        await client.query(
          `UPDATE product_store_stock SET vitrine_quantity = GREATEST(0, vitrine_quantity - $1), updated_at = NOW()
           WHERE product_id = $2 AND store_id = $3`,
          [actualQty, item.productId, data.storeId]
        );

        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
           VALUES ($1, 'waste', $2, 0, $3, $4, $5)`,
          [item.productId, -actualQty, `Destruction DLV/DLC: ${productName} x${actualQty}`, data.decidedBy, data.storeId]
        );

        await client.query(
          `INSERT INTO product_losses
             (product_id, quantity, loss_type, reason, reason_note,
              unit_cost, total_cost, ingredients_consumed, declared_by, store_id,
              source_product_lot_id)
           VALUES ($1, $2, 'perime', $3, $4, $5, $6, true, $7, $8, $9)`,
          [item.productId, actualQty, item.reason || 'perime',
           `Destruction ${item.reason === 'dlc_expiree' ? 'DLC' : 'DLV'} expiree: ${productName}`,
           unitCost, totalCost, data.decidedBy, data.storeId, primaryLotId]
        );

        destroyed.push({ productId: item.productId, quantity: actualQty, reason: item.reason });
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
