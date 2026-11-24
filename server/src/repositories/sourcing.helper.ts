import type { PoolClient } from 'pg';
import { productionRepository } from './production.repository.js';
import { roundQty } from '../utils/quantity.js';
import { formatYieldPerBatch } from '@ofauria/shared';

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
  // Route d'appro du manque (mig 469 item_kind) :
  //   stock/mixed      — couvert (partiellement) par le stock/frigo
  //   production       — article fabriqué : plan de production créé
  //   purchase         — article de revente : à acheter (pas de production)
  //   service          — prestation/abonnement : intangible, rien à approvisionner
  sourceType: 'stock' | 'mixed' | 'production' | 'purchase' | 'service';
  qtyFromStock: number;
  /** Quantité non couverte par le stock : à produire (fabriqué) ou à acheter (revente). */
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
  /** Date du besoin (retrait de la commande) : le plan est daté dessus, jamais avant aujourd'hui (O2C L2, G-FF-01). */
  needDate?: string | null;
}

export async function computeSourcingAndCreatePlan(
  client: PoolClient,
  params: ComputeSourcingParams
): Promise<SourcingResult> {
  const { items, storeId, createdBy, planLabel, targetRole, linkColumn, linkId, needDate } = params;

  if (items.length === 0) {
    return { items: [], productionPlanId: null, semiFinishedInfo: null };
  }

  const productIds = items.map((i) => i.productId);

  // 1) Stock magasin (backroom) DISPONIBLE À LA VENTE = stock − déjà réservé
  //    (mig 389). Une commande ne peut promettre que ce que les commandes
  //    précédentes non livrées n'ont pas déjà réservé.
  const stockResult = await client.query(
    `SELECT product_id,
            GREATEST(COALESCE(stock_quantity, 0) - COALESCE(reserved_quantity, 0), 0) as stock_quantity
     FROM product_store_stock
     WHERE product_id = ANY($1) AND store_id = $2`,
    [productIds, storeId]
  );
  const stockMap: Record<string, number> = {};
  for (const row of stockResult.rows) {
    // Quantités décimales (mig 512) : 3,2 kg en stock comptent 3,2, plus 3.
    stockMap[row.product_id] = roundQty(parseFloat(row.stock_quantity));
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
    frigoMap[row.product_id] = roundQty(parseFloat(row.frigo_quantity));
  }

  // 3) Profil contenant (calcul inverse)
  //    Contenant de la recette (2b-1 : la surcharge par produit, jamais remplie, est retirée).
  const profileResult = await client.query(
    `SELECT p.id AS produit_id,
            r.contenant_id AS contenant_id,
            pc.quantite_theorique AS quantite_theorique,
            pc.pertes_fixes AS pertes_fixes,
            (pc.quantite_theorique - pc.pertes_fixes) AS quantite_nette_cible
     FROM products p
     LEFT JOIN recipes r ON r.product_id = p.id
     LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
     WHERE p.id = ANY($1)
       AND r.contenant_id IS NOT NULL`,
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

  // 3bis) Nature de l'article (mig 469) : route le manque. Un article fabriqué
  //       part en production ; un article de revente part à l'achat (jamais en
  //       production, il n'a pas de recette) ; un service/abonnement est
  //       intangible et ne s'approvisionne pas.
  const kindResult = await client.query(
    `SELECT id, item_kind FROM products WHERE id = ANY($1)`, [productIds]
  );
  const kindMap: Record<string, string> = {};
  for (const row of kindResult.rows) kindMap[row.id] = (row.item_kind as string) || 'manufactured';

  // 3 bis) Règle de lot du format (mig 662, audit 2026-11 C-04). Le profil ci-dessus lit
  //    recipes.contenant_id, que plus aucune fiche ne renseigne : l'arrondi au contenant ne
  //    se déclenchait jamais. La règle « fournées entières » du format lié au produit (ou du
  //    format par défaut de sa fiche) prime ; son rendement validé par le chef est la cible.
  const lotResult = await client.query(
    `SELECT DISTINCT ON (pid) pid, contenant_id, nb_par_defaut, rendement_unite, rendement_kg
       FROM (
         SELECT COALESCE(rf.product_id, r.product_id) AS pid, rf.contenant_id, rf.nb_par_defaut,
                rf.rendement_unite, rf.rendement_kg, (rf.product_id IS NOT NULL) AS direct, rf.ordre
           FROM recipe_formats rf
           JOIN recipes r ON r.id = rf.recipe_id
          WHERE rf.is_active = true AND r.archived_at IS NULL AND rf.lot_rule = 'entier'
            AND (rf.product_id = ANY($1) OR (r.product_id = ANY($1) AND rf.is_default))
       ) f
      WHERE pid = ANY($1)
      ORDER BY pid, direct DESC, ordre`,
    [productIds]
  );
  for (const row of lotResult.rows) {
    const y = formatYieldPerBatch(row);
    if (y > 0) profileMap[row.pid] = { contenantId: row.contenant_id, quantiteNetteCible: y, quantiteTheorique: y };
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

  // Réservations à poser sur le stock magasin (mig 389) : uniquement en contexte
  // commande (linkColumn 'order_id'), pour la part backroom servie du stock.
  const reservations: { itemId: string; productId: string; quantity: number }[] = [];

  for (const item of items) {
    const available = Math.max(stockRemaining[item.productId] || 0, 0);
    const requested = item.requestedQuantity;
    const fromStock = Math.min(available, requested);
    stockRemaining[item.productId] = roundQty(available - fromStock);
    let remaining = roundQty(requested - fromStock);

    if (linkColumn === 'order_id' && fromStock > 0) {
      reservations.push({ itemId: item.itemId, productId: item.productId, quantity: fromStock });
    }

    const frigoAvailable = Math.max(frigoRemaining[item.productId] || 0, 0);
    const fromFrigo = Math.min(frigoAvailable, remaining);
    frigoRemaining[item.productId] = roundQty(frigoAvailable - fromFrigo);
    remaining = roundQty(remaining - fromFrigo);

    // Nature de l'article → route du manque (mig 469).
    const kind = kindMap[item.productId] || 'manufactured';
    const intangible = kind === 'service' || kind === 'subscription';
    // Un service/abonnement est toujours « fulfillable » : aucun manque à sourcer.
    const toProduce = intangible ? 0 : remaining;

    let sourceType: SourcingResultItem['sourceType'];
    if (intangible) {
      sourceType = 'service';
    } else if (toProduce === 0) {
      sourceType = fromFrigo > 0 ? 'mixed' : 'stock';
    } else if (kind === 'resale') {
      // Revente : le manque part à l'achat, jamais en production.
      sourceType = (fromStock > 0 || fromFrigo > 0) ? 'mixed' : 'purchase';
    } else {
      // Fabriqué : le manque part en production.
      sourceType = (fromStock === 0 && fromFrigo === 0) ? 'production' : 'mixed';
    }

    resultItems.push({
      itemId: item.itemId,
      productId: item.productId,
      sourceType,
      qtyFromStock: fromStock + fromFrigo,
      qtyToProduce: toProduce,
      productionPlanId: null,
    });

    // Seuls les articles FABRIQUÉS alimentent le plan de production. La revente
    // (sourceType 'purchase') est signalée sur la ligne sans créer de plan :
    // l'auto-création d'une demande d'achat reste à faire (purchase_requests est
    // aujourd'hui lié aux ingrédients, pas aux produits).
    if (toProduce > 0 && kind === 'manufactured') {
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
        surplusFrigo = roundQty(effectiveQty - toProduce);
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
       VALUES (GREATEST(CURRENT_DATE, COALESCE(($6::timestamptz AT TIME ZONE 'Africa/Casablanca')::date, CURRENT_DATE)),
               'daily', $1, $2, $3, $4, $5) RETURNING id`,
      [planLabel, createdBy, targetRole ?? null, storeId, linkId, needDate ?? null]
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
            quantite_nette_cible, quantite_brute_totale, qty_from_frigo, surplus_frigo, order_item_id,
            requested_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          productionPlanId, pi.productId, effectiveQty,
          pi.contenantId || null, pi.nbContenants || null,
          pi.quantiteNetteCible || null, pi.quantiteBrute || null,
          pi.qtyFromFrigo || 0, pi.surplusFrigo || 0,
          // M2-08 : la ligne de commande servie (contexte commande seulement).
          linkColumn === 'order_id' ? pi.itemId : null,
          // Mig 662 : quantité demandée quand la fabrication a été arrondie à la fournée.
          (pi.surplusFrigo || 0) > 0 ? roundQty(effectiveQty - pi.surplusFrigo) : null,
        ]
      );
      // Lier la ligne resultat au plan
      const resultItem = resultItems.find((r) => r.itemId === pi.itemId);
      if (resultItem) resultItem.productionPlanId = productionPlanId;
    }
  }

  // 5 bis) Réservation du stock magasin promis à la commande (mig 389).
  //        Posée dans la même transaction que le sourcing : le reserved_quantity
  //        bougera de pair avec les réservations. Relâché par trigger quand la
  //        commande est livrée (completed) ou annulée (cancelled).
  for (const r of reservations) {
    await client.query(
      `INSERT INTO order_stock_reservations (order_id, order_item_id, product_id, store_id, quantity)
       VALUES ($1, $2, $3, $4, $5)`,
      [linkId, r.itemId, r.productId, storeId, r.quantity]
    );
    await client.query(
      `UPDATE product_store_stock
          SET reserved_quantity = reserved_quantity + $3, updated_at = now()
        WHERE product_id = $1 AND store_id = $2`,
      [r.productId, storeId, r.quantity]
    );
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
