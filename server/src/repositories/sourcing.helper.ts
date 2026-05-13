import type { PoolClient } from 'pg';
import { productionRepository } from './production.repository.js';

/**
 * Helper de sourcing partage entre approvisionnement (DRA) et commande client.
 *
 * Recoit une liste de lignes (id ligne, produit, qte demandee) et :
 *   1) compte le stock magasin (backroom) + stock frigo valide
 *   2) split chaque ligne en fromStock / fromFrigo / toProduce
 *   3) applique le calcul inverse contenant pour les qtes a produire
 *   4) cree UN production_plan agregeant tous les produits a produire
 *   5) cree les production_plan_items avec floor min_production_quantity
 *   6) declenche en best-effort la detection des plans semi-finis dependants
 *
 * Volontairement ne touche PAS a la table source (replenishment_request_items
 * ou order_items) — l'appelant prend les valeurs retournees et fait l'UPDATE
 * sur sa propre table. Cela evite de parametrer le nom de table dans le helper.
 */

export interface SourcingInputItem {
  itemId: string;
  productId: string;
  requestedQuantity: number;
}

export interface SourcingResultItem {
  itemId: string;
  productId: string;
  sourceType: 'stock' | 'mixed' | 'production';
  qtyFromStock: number;
  qtyToProduce: number;
  productionPlanId: string | null;
}

export interface SourcingResult {
  items: SourcingResultItem[];
  productionPlanId: string | null;
  semiFinishedInfo: unknown;
}

export interface ComputeSourcingParams {
  items: SourcingInputItem[];
  storeId: string;
  createdBy: string;
  planLabel: string;
  /** target_role du plan — null pour les commandes (multi-rôle), role chef pour DRA */
  targetRole?: string | null;
  /** Colonne de liaison sur production_plans : 'replenishment_request_id' ou 'order_id' */
  linkColumn: 'replenishment_request_id' | 'order_id';
  linkId: string;
}

export async function computeSourcingAndCreatePlan(
  client: PoolClient,
  params: ComputeSourcingParams
): Promise<SourcingResult> {
  const { items, storeId, createdBy, planLabel, targetRole, linkColumn, linkId } = params;

  if (items.length === 0) {
    return { items: [], productionPlanId: null, semiFinishedInfo: null };
  }

  const productIds = items.map((i) => i.productId);

  // 1) Stock magasin (backroom)
  const stockResult = await client.query(
    `SELECT product_id, COALESCE(stock_quantity, 0) as stock_quantity
     FROM product_store_stock
     WHERE product_id = ANY($1) AND store_id = $2`,
    [productIds, storeId]
  );
  const stockMap: Record<string, number> = {};
  for (const row of stockResult.rows) {
    stockMap[row.product_id] = Math.floor(parseFloat(row.stock_quantity));
  }

  // 2) Stock frigo (semi-finis disponibles, non expires)
  const frigoResult = await client.query(
    `SELECT product_id, COALESCE(SUM(quantity), 0) as frigo_quantity
     FROM stock_semifini_frigo
     WHERE product_id = ANY($1) AND store_id = $2
       AND is_active = true AND quantity > 0
       AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY product_id`,
    [productIds, storeId]
  );
  const frigoMap: Record<string, number> = {};
  for (const row of frigoResult.rows) {
    frigoMap[row.product_id] = Math.floor(parseFloat(row.frigo_quantity));
  }

  // 3) Profil contenant (calcul inverse)
  //    Hierarchie : produit_profil_production (surcharge) puis recette
  const profileResult = await client.query(
    `SELECT p.id AS produit_id,
            COALESCE(pp.contenant_id, r.contenant_id) AS contenant_id,
            COALESCE(pp.surcharge_quantite_theorique, pc.quantite_theorique) AS quantite_theorique,
            COALESCE(pp.surcharge_pertes_fixes, pc.pertes_fixes) AS pertes_fixes,
            (COALESCE(pp.surcharge_quantite_theorique, pc.quantite_theorique)
             - COALESCE(pp.surcharge_pertes_fixes, pc.pertes_fixes)) AS quantite_nette_cible
     FROM products p
     LEFT JOIN produit_profil_production pp ON pp.produit_id = p.id
     LEFT JOIN recipes r ON r.product_id = p.id
     LEFT JOIN production_contenants pc ON pc.id = COALESCE(pp.contenant_id, r.contenant_id)
     WHERE p.id = ANY($1)
       AND COALESCE(pp.contenant_id, r.contenant_id) IS NOT NULL`,
    [productIds]
  );
  const profileMap: Record<string, { contenantId: string; quantiteNetteCible: number; quantiteTheorique: number }> = {};
  for (const row of profileResult.rows) {
    profileMap[row.produit_id] = {
      contenantId: row.contenant_id,
      quantiteNetteCible: parseFloat(row.quantite_nette_cible),
      quantiteTheorique: parseFloat(row.quantite_theorique),
    };
  }

  // 4) Calcul de sourcing par ligne
  const resultItems: SourcingResultItem[] = [];
  const productionNeeded: {
    productId: string;
    qty: number;
    itemId: string;
    contenantId?: string;
    nbContenants?: number;
    quantiteNetteCible?: number;
    quantiteBrute?: number;
    qtyFromFrigo: number;
    surplusFrigo: number;
  }[] = [];

  // On consomme le stock au fur et a mesure pour eviter qu'un meme produit
  // present dans plusieurs lignes ne soit compte deux fois (cas commande avec
  // 2 lignes du meme brownie : la 2e ligne ne doit pas reutiliser le stock
  // deja "alloue" a la 1re).
  const stockRemaining = { ...stockMap };
  const frigoRemaining = { ...frigoMap };

  for (const item of items) {
    const available = Math.max(stockRemaining[item.productId] || 0, 0);
    const requested = item.requestedQuantity;
    const fromStock = Math.min(available, requested);
    stockRemaining[item.productId] = available - fromStock;
    let remaining = requested - fromStock;

    const frigoAvailable = Math.max(frigoRemaining[item.productId] || 0, 0);
    const fromFrigo = Math.min(frigoAvailable, remaining);
    frigoRemaining[item.productId] = frigoAvailable - fromFrigo;
    remaining -= fromFrigo;

    const toProduce = remaining;
    const sourceType: 'stock' | 'mixed' | 'production' =
      toProduce === 0
        ? (fromFrigo > 0 ? 'mixed' : 'stock')
        : (fromStock === 0 && fromFrigo === 0 ? 'production' : 'mixed');

    resultItems.push({
      itemId: item.itemId,
      productId: item.productId,
      sourceType,
      qtyFromStock: fromStock + fromFrigo,
      qtyToProduce: toProduce,
      productionPlanId: null,
    });

    if (toProduce > 0) {
      const profile = profileMap[item.productId];
      let effectiveQty = toProduce;
      let nbContenants: number | undefined;
      let quantiteNetteCible: number | undefined;
      let quantiteBrute: number | undefined;
      let surplusFrigo = 0;

      if (profile && profile.quantiteNetteCible > 0) {
        nbContenants = Math.ceil(toProduce / profile.quantiteNetteCible);
        quantiteNetteCible = profile.quantiteNetteCible;
        effectiveQty = nbContenants * profile.quantiteNetteCible;
        quantiteBrute = nbContenants * profile.quantiteTheorique;
        surplusFrigo = effectiveQty - toProduce;
      }

      productionNeeded.push({
        productId: item.productId,
        qty: effectiveQty,
        itemId: item.itemId,
        contenantId: profile?.contenantId,
        nbContenants,
        quantiteNetteCible,
        quantiteBrute,
        qtyFromFrigo: fromFrigo,
        surplusFrigo,
      });
    }
  }

  // 5) Creer le plan de production si necessaire
  let productionPlanId: string | null = null;
  if (productionNeeded.length > 0) {
    // La colonne de liaison est differente selon le contexte (DRA ou commande).
    // Le nom de colonne est valide par le typage TS sur linkColumn — donc safe a inliner.
    const planResult = await client.query(
      `INSERT INTO production_plans (plan_date, type, notes, created_by, target_role, store_id, ${linkColumn})
       VALUES (CURRENT_DATE, 'daily', $1, $2, $3, $4, $5) RETURNING id`,
      [planLabel, createdBy, targetRole ?? null, storeId, linkId]
    );
    productionPlanId = planResult.rows[0].id;

    // min_production_quantity floor
    const prodIds = productionNeeded.map((pi) => pi.productId);
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
        `INSERT INTO production_plan_items
           (plan_id, product_id, planned_quantity, contenant_id, nb_contenants,
            quantite_nette_cible, quantite_brute_totale, qty_from_frigo, surplus_frigo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          productionPlanId, pi.productId, effectiveQty,
          pi.contenantId || null, pi.nbContenants || null,
          pi.quantiteNetteCible || null, pi.quantiteBrute || null,
          pi.qtyFromFrigo || 0, pi.surplusFrigo || 0,
        ]
      );
      // Lier la ligne resultat au plan
      const resultItem = resultItems.find((r) => r.itemId === pi.itemId);
      if (resultItem) resultItem.productionPlanId = productionPlanId;
    }
  }

  // 6) Detection semi-finis (best-effort, apres commit cote appelant idealement,
  //    mais ici dans la transaction car le helper ne controle pas le commit)
  let semiFinishedInfo: unknown = null;
  if (productionPlanId) {
    try {
      semiFinishedInfo = await productionRepository.detectAndCreateSemiFinishedPlans(
        productionPlanId, createdBy
      );
    } catch {
      // Non bloquant — l'appelant a le plan, la detection peut etre rejouee plus tard.
    }
  }

  return { items: resultItems, productionPlanId, semiFinishedInfo };
}
