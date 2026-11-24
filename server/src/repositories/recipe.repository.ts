import { policyNumber } from '../services/policies.js';
import { db, withTransaction } from '../config/database.js';
import { snapshotRecipeVersion } from './recipe-version.helper.js';
import { writeCompositionLines } from './composition-lines.helper.js';
import { convertWeight, pickQtyUnit, unitIdSql, type WeightUnit } from '../utils/qty-unit.js';
import {
  yieldInSellingUnit,
  requiresPieceWeight,
  YieldConversionError,
  convertQuantity,
  type SellingUnit,
} from '../utils/units.js';
import { logger } from '../utils/logger.js';

// Unit conversion factors to a common base (kg for weight, l for volume)
const UNIT_TO_BASE: Record<string, { base: string; factor: number }> = {
  kg:   { base: 'kg', factor: 1 },
  g:    { base: 'kg', factor: 0.001 },
  l:    { base: 'l',  factor: 1 },
  cl:   { base: 'l',  factor: 0.01 },
  ml:   { base: 'l',  factor: 0.001 },
  unit: { base: 'unit', factor: 1 },
};

/**
 * Convert quantity from one unit to another.
 * Returns the conversion factor: qty_in_fromUnit * factor = qty_in_toUnit
 * Meme famille (g/kg, ml/l) : facteur direct. Poids <-> volume : via la densite
 * de l'ingredient (utils/units.convertQuantity, mig 227/340). Sans densite sur un
 * croisement poids<->volume, le repli est 1 — le meme que la vue SQL, dont
 * conversion_ok signale le cas (la valeur stockee ici n'est pas la reference :
 * recipes.total_cost est toujours relu depuis la vue).
 */
function unitConversionFactor(fromUnit: string, toUnit: string, densiteKgL?: number | null): number {
  if (fromUnit === toUnit) return 1;
  const from = UNIT_TO_BASE[fromUnit];
  const to = UNIT_TO_BASE[toUnit];
  if (from && to && from.base === to.base) return from.factor / to.factor;
  return convertQuantity(1, fromUnit, toUnit, densiteKgL).value;
}

export const recipeRepository = {
  /** @param archivedOnly true = uniquement les fiches archivées (vue « Archivées ») ;
      false (défaut) = uniquement les actives. Jamais les deux mélangées. */
  async findAll(archivedOnly = false) {
    // total_cost vient de la vue v_recipe_total_cost_v2 (recalcule a la volee).
    // Le champ recipes.total_cost stocke n'est jamais lu — toujours obsolete potentiel.
    // formats_nb / formats_perte_pct exposes pour badge "multi-format" et alerte perte.
    // formats : tableau JSON agrege via subquery pour les UI qui ont besoin de connaitre
    // les formats par recette (ex: ProductionPage — Phase B multi-format).
    const result = await db.query(
      `SELECT r.id, r.name, r.is_base, COALESCE(r.is_phantom, false) AS is_phantom, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.piece_weight_qty, (SELECT code FROM ref_entries WHERE id = r.piece_weight_unit_id) AS piece_weight_unit,
              r.temperature_pate_cible_c, r.hydratation_pct,
              r.category_id, r.mode_cout, r.compo_par_piece, r.perte_standard_pct,
              rc.code AS category_code, rc.label AS category_label, rc.color AS category_color,
              r.created_at, r.updated_at, r.archived_at,
              vtc.total_cost,
              -- Poids reel des ingredients : sert au cout ramene au kg NET, seule
              -- facon de comparer deux preparations dont les rendements sont
              -- saisis l'un en g et l'autre en kg (sinon DH/g face a DH/kg).
              vtw.total_weight_kg,
              -- Nombre de recettes qui consomment celle-ci, tous chemins confondus
              -- (nomenclature par format, miroir recette, sous-recettes legacy).
              -- Une preparation a 0 est soit morte, soit jamais rattachee.
              (SELECT count(DISTINCT parent) FROM (
                 SELECT rf2.recipe_id AS parent
                   FROM recipe_format_components c2
                   JOIN recipe_formats rf2 ON rf2.id = c2.format_id
                  WHERE c2.source_recipe_id = r.id
                 UNION
                 SELECT c3.recipe_id FROM recipe_components c3 WHERE c3.source_recipe_id = r.id
               ) u WHERE parent <> r.id) AS utilisee_par,
              vfs.nb_formats AS formats_nb,
              vfs.perte_pct AS formats_perte_pct,
              df.nb_par_defaut AS rendement,
              -- Mig 613 : unité du rendement du format par défaut (pièces ou kilos).
              df.rendement_unite AS rendement_unite,
              df.rendement_kg AS rendement_kg,
              -- Poids (kg) d'une fournee du format par defaut, depuis sa composition :
              -- v_recipe_total_weight_kg ne lit que l'ancienne composition et renvoie 0
              -- pour une fiche composee par format. Sert au prix au kilo d'un produit
              -- vendu au poids (scenario 1, constat 27).
              sp.poids_brut_kg AS default_format_weight_kg,
              -- Mig 614 (constat 29) : coût complet et prix HT de la fiche, à la pièce et
              -- au kilo, repris tels quels par le formulaire produit.
              sp.cout_piece AS sale_cout_piece,
              sp.prix_piece AS sale_prix_piece,
              sp.cout_kg AS sale_cout_kg,
              sp.prix_kg AS sale_prix_kg,
              dfc.nom AS default_contenant_nom,
              dfc.id IS NOT NULL AND dfc.nom ILIKE '%assemblage%' AS rendement_a_definir,
              -- Composition vide = aucune ligne (scénario 1, constat 107), et non plus « coût nul » :
              -- un ingrédient sans prix n'est pas une composition vide (constat 108).
              NOT EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats ff ON ff.id = fc.format_id WHERE ff.recipe_id = r.id) AS compo_vide,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', rf.id,
                  'contenant_id', rf.contenant_id,
                  'contenant_nom', pcf.nom,
                  'quantite_par_format', rf.quantite_par_format,
                  'quantite_par_format_unite', rf.quantite_par_format_unite,
                  'nb_par_defaut', rf.nb_par_defaut,
                  'rendement_unite', rf.rendement_unite,
                  'rendement_kg', rf.rendement_kg
                ) ORDER BY rf.ordre, pcf.nom)
                FROM recipe_formats rf
                JOIN production_contenants pcf ON pcf.id = rf.contenant_id
                WHERE rf.recipe_id = r.id AND rf.is_active = true
              ), '[]'::jsonb) AS formats,
              p.name as product_name, p.image_url as product_image, p.price as product_price,
              pc.nom as contenant_nom, pc.type_production as contenant_type,
              pc.quantite_theorique as contenant_quantite_theorique,
              pc.pertes_fixes as contenant_pertes_fixes,
              pc.unite_lancement as contenant_unite_lancement,
              pc.poids_kg as contenant_poids_kg,
              -- Coût de revient incomplet (constat 108, mig 621) : ingrédient sans prix,
              -- conversion douteuse ou préparation vide, directement ou par une base.
              COALESCE(cg.nb, 0) > 0 AS cout_incomplet,
              -- Constat 123 : matière par pièce (ou par kilo) du format par défaut, source unique
              -- fn_recipe_cost ; la liste ne la recalcule plus (÷ rendement faux en saisie par pièce).
              (SELECT fc.matiere_u FROM fn_recipe_cost(r.id, df.id) fc WHERE df.id IS NOT NULL) AS cout_matiere_piece
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       LEFT JOIN recipe_categories rc ON rc.id = r.category_id
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
       LEFT JOIN v_recipe_format_summary vfs ON vfs.recipe_id = r.id
       LEFT JOIN (SELECT recipe_id, COUNT(*) AS nb FROM v_recipe_cost_gaps GROUP BY recipe_id) cg ON cg.recipe_id = r.id
       LEFT JOIN LATERAL (
         SELECT rf.id, rf.nb_par_defaut, rf.contenant_id, rf.rendement_unite, rf.rendement_kg
         FROM recipe_formats rf
         WHERE rf.recipe_id = r.id AND rf.is_active = true
         ORDER BY rf.is_default DESC, rf.ordre LIMIT 1
       ) df ON true
       LEFT JOIN production_contenants dfc ON dfc.id = df.contenant_id
       -- Mig 614 : prix de vente et poids brut de la fournee du format par defaut
       -- (fn_recipe_sale_pricing, meme regle de poids que l'ancien lateral dw).
       LEFT JOIN LATERAL fn_recipe_sale_pricing(r.id) sp ON df.id IS NOT NULL
       WHERE r.archived_at IS ${archivedOnly ? 'NOT NULL' : 'NULL'}
       ORDER BY r.is_base DESC, r.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    // total_cost vient de la vue v_recipe_total_cost_v2. On override le champ stocke.
    // total_weight_kg : idem, calcule a la volee a partir des ingredients
    // (densite 1 pour les liquides, pieces ignorees).
    const recipeResult = await db.query(
      `SELECT r.id, r.name, r.is_base, COALESCE(r.is_phantom, false) AS is_phantom, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.piece_weight_qty, (SELECT code FROM ref_entries WHERE id = r.piece_weight_unit_id) AS piece_weight_unit,
              r.temperature_pate_cible_c, r.hydratation_pct,
              r.category_id,
              rc.code AS category_code, rc.label AS category_label, rc.color AS category_color,
              r.taux_main_oeuvre_dh_h, r.cout_energie_fournee, r.taux_frais_structure_pct,
              r.mode_cout, r.perte_standard_pct, r.pieces_par_fournee, r.compo_par_piece,
              r.created_at, r.updated_at,
              vtc.total_cost,
              NOT EXISTS (SELECT 1 FROM recipe_format_components fc JOIN recipe_formats ff ON ff.id = fc.format_id WHERE ff.recipe_id = r.id) AS compo_vide,
              vtw.total_weight_kg,
              vfs.poids_utilise_kg AS formats_poids_utilise_kg,
              vfs.perte_kg AS formats_perte_kg,
              vfs.perte_pct AS formats_perte_pct,
              vfs.nb_formats AS formats_nb,
              p.name as product_name, p.price as product_price,
              pc.nom as contenant_nom, pc.type_production as contenant_type,
              pc.quantite_theorique as contenant_quantite_theorique,
              pc.pertes_fixes as contenant_pertes_fixes,
              pc.unite_lancement as contenant_unite_lancement,
              pc.poids_kg as contenant_poids_kg,
              COALESCE(va.allergens, '{}'::text[]) AS allergens,
              COALESCE(va.nb_allergens, 0) AS nb_allergens,
              -- Trous du coût de revient (constat 108, mig 621).
              (SELECT COALESCE(json_agg(json_build_object('composant', g.composant, 'motif', g.motif, 'via', g.via)
                                        ORDER BY g.via NULLS FIRST, g.composant), '[]'::json)
                 FROM v_recipe_cost_gaps g WHERE g.recipe_id = r.id) AS cost_gaps,
              r.archived_at, r.archived_by
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       LEFT JOIN recipe_categories rc ON rc.id = r.category_id
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
       LEFT JOIN v_recipe_format_summary vfs ON vfs.recipe_id = r.id
       LEFT JOIN v_recipe_allergens va ON va.recipe_id = r.id
       WHERE r.id = $1`,
      [id]
    );
    if (!recipeResult.rows[0]) return null;

    // Pas 2b-1 : l'ancien modèle (lignes à plat, sous-recettes, emballages par recette)
    // n'est plus lu. La composition vit dans `composition` (miroir du format par défaut)
    // et dans la nomenclature des formats ; les clés historiques restent, vides, pour ne
    // pas casser la forme de la réponse (elles l'étaient déjà pour toute fiche composée).

    // Formats de production : poids, nb, ventilation cout matiere/MO/energie/structure
    const formatsResult = await db.query(
      `SELECT rf.id, rf.contenant_id, rf.quantite_par_format, rf.quantite_par_format_unite, rf.nb_par_defaut,
              rf.cout_emballage_unitaire, rf.ordre, rf.is_active,
              rf.prix_vente_unitaire_override, rf.margin_multiplier_override,
              rf.is_default, rf.nb_parts,
              pc.nom as contenant_nom, pc.unite_lancement as contenant_unite_lancement,
              pc.type_production as contenant_type,
              vfc.poids_format_g, vfc.poids_utilise_g,
              vfc.cout_matiere_format, vfc.cout_matiere_unitaire,
              vfc.cout_mo_format, vfc.cout_energie_format, vfc.cout_struct_format,
              vfc.cout_unitaire_complet, vfc.prix_vente_unitaire, vfc.marge_resolue
       FROM recipe_formats rf
       -- LEFT JOIN : un format sans contenant est legitime — assemblage d'un
       -- produit compose (mig 267) ou preparation pas encore rattachee a un
       -- moule (mig 274). Le JOIN strict les faisait disparaitre de la fiche,
       -- qui affichait alors « aucun format » sur une recette qui en avait un.
       LEFT JOIN production_contenants pc ON pc.id = rf.contenant_id
       LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rf.id
       WHERE rf.recipe_id = $1 AND rf.is_active = true
       ORDER BY rf.ordre ASC, pc.nom ASC NULLS LAST`,
      [id]
    );

    // Composition au niveau recette (recipe_components) — source de vérité pour
    // les produits composés (remplace la vue legacy sub_recipes à l'affichage).
    const compositionResult = await db.query(
      `SELECT c.id, c.role,
              COALESCE(br.name, ing.name) AS name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS type,
              c.quantite, c.unite, cc.cout_dh
       FROM recipe_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN v_rcomp_cost_v2 cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre`,
      [id]
    );

    // Recettes qui CONSOMMENT celle-ci, tous chemins confondus. Modifier une
    // preparation change le cout de ses consommateurs : la fiche doit le montrer
    // avant qu'on enregistre, pas apres.
    const usedByResult = await db.query(
      `SELECT p.id, p.name, p.is_base, u.quantite, u.unite, u.priorite
         FROM (
           -- Priorite 1 : la nomenclature par format, source de verite actuelle.
           -- Un parent multi-format cite la preparation autant de fois qu'il a de
           -- cadres (1200 g, 600 g, 450 g pour l'opera) : on retient celui du
           -- format PAR DEFAUT, sinon la fiche montrerait une quantite au hasard.
           SELECT rf.recipe_id AS parent, c.quantite, c.unite,
                  CASE WHEN rf.is_default THEN 1 ELSE 2 END AS priorite
             FROM recipe_format_components c
             JOIN recipe_formats rf ON rf.id = c.format_id
            WHERE c.source_recipe_id = $1
           UNION ALL
           -- Priorite 3 : le miroir du format par defaut (mig 205).
           SELECT c.recipe_id, c.quantite, c.unite, 3
             FROM recipe_components c WHERE c.source_recipe_id = $1
         ) u
         JOIN recipes p ON p.id = u.parent
        WHERE u.parent <> $1
        ORDER BY p.name, u.priorite`,
      [id]
    );
    // Un meme parent remonte par plusieurs chemins : on garde la PREMIERE ligne,
    // donc la mieux classee (format par defaut avant un autre format, puis le miroir).
    const usedBy: Record<string, unknown>[] = [];
    const vus = new Set<string>();
    for (const row of usedByResult.rows as Record<string, unknown>[]) {
      const key = String(row.id);
      if (vus.has(key)) continue;
      vus.add(key);
      usedBy.push(row);
    }

    return {
      ...recipeResult.rows[0],
      ingredients: [],
      sub_recipes: [],
      composition: compositionResult.rows,
      packaging: [],
      formats: formatsResult.rows,
      used_by: usedBy,
    };
  },

  /** Find recipe by product ID (with ingredients & sub-recipes & packaging) */
  async findByProductId(productId: string) {
    const recipeResult = await db.query(
      `SELECT r.id, r.name, r.is_base, COALESCE(r.is_phantom, false) AS is_phantom, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.piece_weight_qty, (SELECT code FROM ref_entries WHERE id = r.piece_weight_unit_id) AS piece_weight_unit,
              r.temperature_pate_cible_c, r.hydratation_pct,
              r.created_at, r.updated_at,
              vtc.total_cost,
              COALESCE(va.allergens, '{}'::text[]) AS allergens,
              p.name as product_name, p.price as product_price
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_allergens va ON va.recipe_id = r.id
       -- Un produit est rattache a sa recette soit directement (recipes.product_id),
       -- soit par un format de la fiche (« Produit vendu au POS », mig 263). Sans la
       -- 2e branche, un produit lie depuis la fiche restait « sans recette » a la
       -- production : ni etapes, ni ingredients.
       WHERE r.product_id = $1
          OR r.id IN (SELECT rf.recipe_id FROM recipe_formats rf WHERE rf.product_id = $1 AND rf.is_active)
       ORDER BY (r.product_id = $1) DESC NULLS LAST
       LIMIT 1`,
      [productId]
    );
    if (!recipeResult.rows[0]) return null;

    const recipeId = recipeResult.rows[0].id;
    // Pas 2b-1 : ancien modèle non lu (clés historiques renvoyées vides, voir findById).
    const formatsResult = await db.query(
      `SELECT rf.id, rf.contenant_id, rf.quantite_par_format, rf.quantite_par_format_unite, rf.nb_par_defaut,
              rf.cout_emballage_unitaire, rf.ordre, rf.is_active,
              pc.nom as contenant_nom, pc.unite_lancement as contenant_unite_lancement,
              pc.type_production as contenant_type,
              vfc.poids_format_g, vfc.poids_utilise_g,
              vfc.cout_matiere_format, vfc.cout_matiere_unitaire,
              vfc.cout_mo_format, vfc.cout_energie_format, vfc.cout_struct_format,
              vfc.cout_unitaire_complet, vfc.prix_vente_unitaire
       FROM recipe_formats rf
       JOIN production_contenants pc ON pc.id = rf.contenant_id
       LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rf.id
       WHERE rf.recipe_id = $1 AND rf.is_active = true
       ORDER BY rf.ordre ASC, pc.nom ASC`,
      [recipeId]
    );

    return {
      ...recipeResult.rows[0],
      ingredients: [],
      sub_recipes: [],
      packaging: [],
      formats: formatsResult.rows,
    };
  },

  /** List recipe categories (sections de production) — pour les selecteurs UI. */
  async listCategories() {
    const result = await db.query(
      `SELECT id, code, label, color, display_order
       FROM recipe_categories
       ORDER BY display_order, label`
    );
    return result.rows;
  },

  /** List only base recipes (for sub-recipe picker).
   *  total_cost vient de la vue v_recipe_total_cost_v2. */
  async findBaseRecipes() {
    const result = await db.query(
      `SELECT r.id, r.name, r.yield_quantity, r.yield_unit, vtc.total_cost,
              vtw.total_weight_kg
       FROM recipes r
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
       WHERE r.is_base = true AND r.archived_at IS NULL
       ORDER BY r.name`
    );
    return result.rows;
  },

  async create(data: {
    productId?: string; name: string; instructions?: string; yieldQuantity?: number; yieldUnit?: string;
    pieceWeightKg?: number | null; isBase?: boolean;
    /** M3-04 : poids de pièce dans l'unité saisie, prioritaire sur pieceWeightKg. */
    pieceWeightQty?: number | null; pieceWeightUnit?: WeightUnit;
    temperaturePateCibleC?: number | null; hydratationPct?: number | null;
    categoryId?: string | null;
    // Auteur de la creation (audit BOM : recipe_formats.updated_by).
    changedBy?: string | null;
    // Mode de saisie des quantites de composition, decide a la creation de la
    // fiche (par fournee/lot = false, par piece/unite = true). Colonne recipes.
    compoParPiece?: boolean;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    // Frais indirects (defaults pris dans company_settings via INSERT a l'inscription)
    tauxMainOeuvreDhH?: number; coutEnergieFournee?: number; tauxFraisStructurePct?: number;
    perteStandardPct?: number;
    ingredients: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
    formats?: { contenantId: string; quantiteParFormatG: number; quantiteParFormatUnite?: string; nbParDefaut: number; coutEmballageUnitaire?: number; ordre?: number; prixVenteUnitaireOverride?: number | null; marginMultiplierOverride?: number | null }[];
  }) {
    // M3-04 : le poids de pièce s'écrit en quantité + unité saisie ; le kg sert aux calculs.
    const pieceWeight = pickQtyUnit(data.pieceWeightQty, data.pieceWeightUnit, data.pieceWeightKg, 'kg');
    data = { ...data, pieceWeightKg: pieceWeight ? convertWeight(pieceWeight.qty, pieceWeight.unit, 'kg') : data.pieceWeightKg };
    return withTransaction(async () => {
      const client = await db.getClient();

      // Garde-fou yield_unit vs products.sale_unit : si pas de piece_weight_kg
      // alors qu'il est requis, on refuse l'enregistrement avec un message clair.
      await this.ensureYieldUnitCompatible(
        client,
        data.productId || null,
        data.yieldUnit || 'unit',
        data.pieceWeightKg ?? null,
      );

      // Calcul du cout JS pour syncProductPrice uniquement (le champ recipes.total_cost
      // n'est plus stocke — il est calcule a la volee via v_recipe_total_cost_v2).
      let totalCost = 0;
      for (const ing of (data.ingredients ?? [])) {
        const ingResult = await client.query('SELECT unit_cost, unit, densite_kg_l FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          const densite = ingResult.rows[0].densite_kg_l != null ? parseFloat(ingResult.rows[0].densite_kg_l) : null;
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit, densite);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      // Sous-recettes : on lit le direct_cost depuis la vue (jamais la valeur stockee)
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            `SELECT COALESCE(vtc.total_cost, 0) AS total_cost, r.yield_quantity
             FROM recipes r LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id WHERE r.id = $1`, [sr.subRecipeId]
          );
          if (srResult.rows[0]) {
            const costPerUnit = parseFloat(srResult.rows[0].total_cost) / (srResult.rows[0].yield_quantity || 1);
            totalCost += costPerUnit * sr.quantity;
          }
        }
      }

      // Emballages
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          const pkResult = await client.query('SELECT unit_cost FROM packaging_items WHERE id = $1', [pk.packagingId]);
          if (pkResult.rows[0]) {
            totalCost += parseFloat(pkResult.rows[0].unit_cost) * pk.quantity;
          }
        }
      }

      // M1-03 : sans multiplicateur saisi, la politique « Multiplicateur de marge » (×3 par défaut).
      const margin = data.marginMultiplier && data.marginMultiplier > 0
        ? data.marginMultiplier
        : await policyNumber('production.margin_multiplier', 'value');
      // total_cost INSERT a 0 par defaut — la vraie valeur vient toujours de la vue.
      // Frais indirects : si non fournis, on les pre-remplit depuis company_settings.
      const csResult = await client.query(
        `SELECT taux_main_oeuvre_defaut_dh_h, taux_frais_structure_defaut_pct FROM company_settings LIMIT 1`
      );
      const csDefaults = csResult.rows[0] || {};
      const tauxMo = data.tauxMainOeuvreDhH ?? parseFloat(csDefaults.taux_main_oeuvre_defaut_dh_h || '0');
      const coutEnergie = data.coutEnergieFournee ?? 0;
      const tauxStruct = data.tauxFraisStructurePct ?? parseFloat(csDefaults.taux_frais_structure_defaut_pct || '0');
      const recipeResult = await client.query(
        `INSERT INTO recipes (product_id, name, instructions, yield_quantity, yield_unit, piece_weight_qty, total_cost, is_base, contenant_id, etapes, margin_multiplier,
                              taux_main_oeuvre_dh_h, cout_energie_fournee, taux_frais_structure_pct, category_id,
                              temperature_pate_cible_c, hydratation_pct, compo_par_piece, piece_weight_unit_id)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 CASE WHEN $6::numeric IS NULL THEN NULL ELSE ${unitIdSql('$18')} END) RETURNING *`,
        [data.productId || null, data.name, data.instructions || null, data.yieldQuantity || 1, data.yieldUnit || 'unit',
         pieceWeight?.qty ?? null,
         data.isBase || false, data.contenantId || null, JSON.stringify(data.etapes || []), margin,
         tauxMo, coutEnergie, tauxStruct, data.categoryId ?? null,
         data.temperaturePateCibleC ?? null, data.hydratationPct ?? null, data.compoParPiece ?? false, pieceWeight?.unit ?? 'kg']
      );

      const recipeId = recipeResult.rows[0].id;
      // M9 (mig 588) : sous-ensemble fantôme, pour une base seulement.
      if (data.isBase && (data as { isPhantom?: boolean }).isPhantom) {
        await client.query(`UPDATE recipes SET is_phantom = true WHERE id = $1`, [recipeId]);
      }

      // Cycle detection for sub-recipes
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const hasCycle = await this.detectCycle(sr.subRecipeId, recipeId, client);
          if (hasCycle) {
            throw new Error(`Référence circulaire détectée: la sous-recette créerait un cycle`);
          }
        }
      }

      // Insert recipe_formats (multi-formats de production)
      if (data.formats && data.formats.length > 0) {
        for (const fmt of data.formats) {
          await client.query(
            `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, cout_emballage_unitaire, ordre, prix_vente_unitaire_override, margin_multiplier_override, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
               quantite_par_format = EXCLUDED.quantite_par_format,
               quantite_par_format_unite = EXCLUDED.quantite_par_format_unite,
               nb_par_defaut = EXCLUDED.nb_par_defaut,
               cout_emballage_unitaire = EXCLUDED.cout_emballage_unitaire,
               ordre = EXCLUDED.ordre,
               prix_vente_unitaire_override = EXCLUDED.prix_vente_unitaire_override,
               margin_multiplier_override = EXCLUDED.margin_multiplier_override,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [recipeId, fmt.contenantId, fmt.quantiteParFormatG, fmt.quantiteParFormatUnite || 'g', fmt.nbParDefaut, fmt.coutEmballageUnitaire ?? 0, fmt.ordre ?? 0,
             fmt.prixVenteUnitaireOverride ?? null, fmt.marginMultiplierOverride ?? null, data.changedBy ?? null]
          );
        }
      }

      // Pas 2b-1 : des lignes « à plat » reçues par l'API (import, données de départ,
      // anciens appels) vont dans la nomenclature du format par défaut, jamais plus dans
      // l'ancien modèle.
      await writeCompositionLines(client, recipeId, {
        ingredients: data.ingredients ?? [],
        subRecipes: data.subRecipes ?? [],
        packaging: data.packaging ?? [],
      }, data.changedBy ?? null);

      await this.syncProductPrice(
        client,
        data.productId || null,
        totalCost,
        data.yieldQuantity || 1,
        data.yieldUnit || 'unit',
        data.pieceWeightKg ?? null,
        margin,
        data.salePrice ?? null,
      );

      return recipeResult.rows[0];
    });
  },

  /** Garde-fou : si la recette est liee a un produit dont sale_unit ne coincide
   *  pas avec yield_unit, piece_weight_kg est obligatoire (sinon le prix de vente
   *  ne peut pas etre calcule). Throw un Error avec un message clair que le
   *  controller traduit en 422.
   */
  async ensureYieldUnitCompatible(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    productId: string | null,
    yieldUnit: string,
    pieceWeightKg: number | null,
  ) {
    if (!productId) return; // recette sans produit lie (sous-recette pure) : pas de prix a calculer
    const productResult = await executor.query(
      `SELECT sale_unit FROM products WHERE id = $1`,
      [productId],
    );
    const row = (productResult as { rows: { sale_unit: string | null }[] }).rows[0];
    if (!row) return;
    const sellingUnit: SellingUnit = row.sale_unit === 'weight' ? 'weight' : 'unit';
    if (!requiresPieceWeight(yieldUnit, sellingUnit)) return;
    if (pieceWeightKg !== null && pieceWeightKg > 0) return;
    const target = sellingUnit === 'weight' ? 'au kg' : 'a la piece';
    const err = new Error(
      `Le rendement est en "${yieldUnit}" mais le produit lie est vendu ${target}. ` +
      `Indique le poids unitaire d'une piece (en kg) pour permettre le calcul du prix de vente.`,
    );
    (err as Error & { code?: string }).code = 'PIECE_WEIGHT_REQUIRED';
    throw err;
  },

  /** Sync linked product cost_price + price.
   *
   *  Convertit d'abord le rendement de la recette (yieldQuantity dans yieldUnit)
   *  vers l'unite de vente du produit (products.sale_unit = 'unit' | 'weight').
   *  Ainsi cost_price et price sont TOUJOURS dans la meme unite que le produit :
   *   - sale_unit='weight' -> ecrit dans products.price_per_kg (DH/kg)
   *   - sale_unit='unit'   -> ecrit dans products.price       (DH/piece)
   *
   *  Si la conversion est impossible (combinaison non geree, ou piece_weight_kg
   *  manquant alors qu'il est requis), on ne touche a rien et on log. Le garde-fou
   *  de validation a la creation/edition de recette est cense empecher ce cas;
   *  ici c'est un filet de securite pour les cascades de propagation (sous-recettes,
   *  ingredients, packaging) afin de ne pas casser les flux en aval.
   *
   *  Si `overridePrice` est fourni (saisie manuelle), il est utilise tel quel
   *  pour le prix; cost_price est tout de meme recalcule.
   */
  async syncProductPrice(
    executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    productId: string | null,
    totalCost: number,
    yieldQuantity: number,
    yieldUnit: string,
    pieceWeightKg: number | null,
    marginMultiplier: number,
    overridePrice: number | null = null,
  ) {
    if (!productId) return;

    // Mig 614 (constat 29) : fiche composée par format → coût complet et prix de la fiche
    // (fn_recipe_sale_pricing), comme le formulaire produit. L'ancien calcul ci-dessous
    // divisait la fournée entière par yield_quantity (1 pour une fiche par format) et ne
    // comptait que la matière.
    const fiche = (await executor.query(
      `SELECT p.sale_unit, sp.cout_piece, sp.prix_piece, sp.cout_kg, sp.prix_kg
         FROM products p
         JOIN recipes r ON r.product_id = p.id
         CROSS JOIN LATERAL fn_recipe_sale_pricing(r.id) sp
        WHERE p.id = $1
        LIMIT 1`,
      [productId],
    ) as { rows: { sale_unit: string | null; cout_piece: string | null; prix_piece: string | null; cout_kg: string | null; prix_kg: string | null }[] }).rows[0];
    if (fiche) {
      const auPoids = fiche.sale_unit === 'weight';
      const cout = Number(auPoids ? fiche.cout_kg : fiche.cout_piece);
      const prixFiche = Number(auPoids ? fiche.prix_kg : fiche.prix_piece);
      const prix = overridePrice !== null && overridePrice >= 0 ? overridePrice : prixFiche;
      // Garde-fou F-025 : coût nul (fiche sans composant) ou poids inconnu → on ne
      // touche pas au produit.
      if (!(cout > 0) || !(prix > 0)) return;
      // Au poids : price (affiché au catalogue « /kg ») et price_per_kg (lu en caisse)
      // portent la même valeur.
      await executor.query(
        auPoids
          ? `UPDATE products SET cost_price = $1, price = $2, price_per_kg = $2, updated_at = NOW() WHERE id = $3`
          : `UPDATE products SET cost_price = $1, price = $2, updated_at = NOW() WHERE id = $3`,
        [cout, prix, productId],
      );
      return;
    }

    if (yieldQuantity <= 0) return;

    // Lire l'unite de vente du produit
    const productResult = await executor.query(
      `SELECT sale_unit FROM products WHERE id = $1`,
      [productId],
    );
    const productRow = (productResult as { rows: { sale_unit: string | null }[] }).rows[0];
    if (!productRow) return;
    const sellingUnit: SellingUnit = productRow.sale_unit === 'weight' ? 'weight' : 'unit';

    // Convertir le rendement dans l'unite de vente
    let yieldInSU: number;
    try {
      yieldInSU = yieldInSellingUnit(yieldQuantity, yieldUnit, sellingUnit, pieceWeightKg);
    } catch (err) {
      if (err instanceof YieldConversionError) {
        logger.warn(`syncProductPrice skip product=${productId}: ${err.message}`);
        return;
      }
      throw err;
    }
    if (yieldInSU <= 0) return;

    const costPerSellingUnit = totalCost / yieldInSU;
    const computedPrice = costPerSellingUnit * marginMultiplier;
    const hasOverride = overridePrice !== null && overridePrice >= 0;
    const finalPrice = hasOverride ? overridePrice : computedPrice;

    // Garde-fou F-025 : une fiche fraichement creee (ou enregistree) sans composant
    // a un cout nul. Sans prix de vente explicite, le prix calcule (cout x marge)
    // vaudrait 0 et ECRASERAIT le prix catalogue du produit (observe : baguettes,
    // tartes... passees a 0 DH, vendues a 0 en caisse). On ne touche alors ni au
    // prix ni au cout : le prix sera recalcule des que des composants seront ajoutes.
    if (!hasOverride && totalCost <= 0) {
      return;
    }

    if (sellingUnit === 'weight') {
      // Vendu au kg : on alimente price_per_kg (lu par POS et sales).
      // products.price reste intact (saisi manuellement ou non).
      await executor.query(
        `UPDATE products SET cost_price = $1, price_per_kg = $2, updated_at = NOW() WHERE id = $3`,
        [costPerSellingUnit, finalPrice, productId],
      );
    } else {
      await executor.query(
        `UPDATE products SET cost_price = $1, price = $2, updated_at = NOW() WHERE id = $3`,
        [costPerSellingUnit, finalPrice, productId],
      );
    }
  },

  async update(id: string, data: {
    name: string; instructions?: string; yieldQuantity?: number; yieldUnit?: string;
    pieceWeightKg?: number | null; isBase?: boolean;
    /** M3-04 : poids de pièce dans l'unité saisie, prioritaire sur pieceWeightKg. */
    pieceWeightQty?: number | null; pieceWeightUnit?: WeightUnit;
    temperaturePateCibleC?: number | null; hydratationPct?: number | null;
    categoryId?: string | null;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    tauxMainOeuvreDhH?: number; coutEnergieFournee?: number; tauxFraisStructurePct?: number;
    perteStandardPct?: number;
    ingredients?: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
    formats?: { contenantId: string; quantiteParFormatG: number; quantiteParFormatUnite?: string; nbParDefaut: number; coutEmballageUnitaire?: number; ordre?: number; prixVenteUnitaireOverride?: number | null; marginMultiplierOverride?: number | null }[];
    changedBy?: string; changeNote?: string;
  }) {
    // M3-04 : voir create().
    const pieceWeight = pickQtyUnit(data.pieceWeightQty, data.pieceWeightUnit, data.pieceWeightKg, 'kg');
    data = { ...data, pieceWeightKg: pieceWeight ? convertWeight(pieceWeight.qty, pieceWeight.unit, 'kg') : data.pieceWeightKg };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Snapshot current state for versioning
      const currentRecipe = await this.findById(id);

      // Garde-fou yield_unit vs sale_unit : voir create() pour le rationale.
      await this.ensureYieldUnitCompatible(
        client,
        currentRecipe?.product_id || null,
        data.yieldUnit || 'unit',
        data.pieceWeightKg ?? null,
      );

      if (currentRecipe) {
        // Version complete (mig 346) : legacy + nomenclature composee + formats + etapes + frais.
        await snapshotRecipeVersion(client, id, data.changedBy || null, data.changeNote || null);
      }

      let totalCost = 0;
      for (const ing of (data.ingredients ?? [])) {
        const ingResult = await client.query('SELECT unit_cost, unit, densite_kg_l FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          const densite = ingResult.rows[0].densite_kg_l != null ? parseFloat(ingResult.rows[0].densite_kg_l) : null;
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit, densite);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            `SELECT COALESCE(vtc.total_cost, 0) AS total_cost, r.yield_quantity
             FROM recipes r LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id WHERE r.id = $1`, [sr.subRecipeId]
          );
          if (srResult.rows[0]) {
            const costPerUnit = parseFloat(srResult.rows[0].total_cost) / (srResult.rows[0].yield_quantity || 1);
            totalCost += costPerUnit * sr.quantity;
          }
        }
      }

      // Cout emballages
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          const pkResult = await client.query('SELECT unit_cost FROM packaging_items WHERE id = $1', [pk.packagingId]);
          if (pkResult.rows[0]) {
            totalCost += parseFloat(pkResult.rows[0].unit_cost) * pk.quantity;
          }
        }
      }

      const margin = data.marginMultiplier && data.marginMultiplier > 0
        ? data.marginMultiplier
        : parseFloat(currentRecipe?.margin_multiplier || '3');
      // total_cost n'est plus stocke (vue v_recipe_total_cost_v2 gere) — on le force a 0.
      // Frais indirects : si data ne les fournit pas, on conserve les valeurs existantes (COALESCE).
      // Un champ ABSENT du payload (undefined -> null en parametre) est PRESERVE via
      // COALESCE : une sauvegarde partielle (edition unifiee, import xlsx en MAJ) ne
      // doit jamais vider etapes, categorie, poids-piece ni parametres de pate. Pour
      // effacer explicitement l'un de ces champs, utiliser l'endpoint dedie (identity,
      // etapes) ou envoyer une valeur vide typee ("" pour instructions).
      await client.query(
        `UPDATE recipes SET name = COALESCE($1, name),
           instructions = COALESCE($2, instructions),
           yield_quantity = COALESCE($3, yield_quantity),
           yield_unit = COALESCE($4, yield_unit),
           piece_weight_unit_id = CASE WHEN $5::numeric IS NULL THEN piece_weight_unit_id ELSE ${unitIdSql('$18')} END,
           piece_weight_qty = COALESCE($5::numeric, piece_weight_qty),
           total_cost = 0,
           is_base = COALESCE($6, is_base),
           contenant_id = COALESCE($7, contenant_id),
           etapes = COALESCE($8::jsonb, etapes),
           margin_multiplier = $9,
           taux_main_oeuvre_dh_h = COALESCE($10, taux_main_oeuvre_dh_h),
           cout_energie_fournee = COALESCE($11, cout_energie_fournee),
           taux_frais_structure_pct = COALESCE($12, taux_frais_structure_pct),
           category_id = COALESCE($13, category_id),
           perte_standard_pct = COALESCE($14, perte_standard_pct),
           temperature_pate_cible_c = COALESCE($16, temperature_pate_cible_c),
           hydratation_pct = COALESCE($17, hydratation_pct),
           updated_at = NOW()
         WHERE id = $15`,
        [data.name ?? null, data.instructions ?? null, data.yieldQuantity ?? null, data.yieldUnit ?? null, pieceWeight?.qty ?? null,
         data.isBase ?? null, data.contenantId ?? null,
         data.etapes === undefined ? null : JSON.stringify(data.etapes), margin,
         data.tauxMainOeuvreDhH ?? null, data.coutEnergieFournee ?? null, data.tauxFraisStructurePct ?? null,
         data.categoryId ?? null, data.perteStandardPct ?? null, id,
         data.temperaturePateCibleC ?? null, data.hydratationPct ?? null, pieceWeight?.unit ?? 'kg']
      );

      // Sous-recettes reçues à plat : refus d'un cycle avant toute écriture.
      for (const sr of data.subRecipes ?? []) {
        const hasCycle = await this.detectCycle(sr.subRecipeId, id, client);
        if (hasCycle) {
          throw new Error(`Référence circulaire détectée: la sous-recette créerait un cycle`);
        }
      }

      // recipe_formats : soft-delete + upsert.
      //
      // Probleme avec DELETE brut : si un recipe_format est reference par un
      // production_plan_items historique (status produced), le FK cascade
      // (ON DELETE SET NULL) tente d'UPDATE format_id = NULL, ce qui viole
      // l'index unique partiel uq_plan_item_product_legacy quand un autre
      // plan_item du meme (plan_id, product_id) avait deja format_id IS NULL.
      // -> erreur transaction abort, save plante.
      //
      // Solution : on ne supprime jamais physiquement. Les formats absents de
      // data.formats sont marques is_active=false (preserve l'historique).
      // Les formats presents sont upsertes (ON CONFLICT reactive si etait
      // inactif). Si data.formats est undefined, on ne touche a rien.
      // IMPORTANT : on ne gère les formats QUE si une liste NON VIDE est fournie.
      // Une liste vide (ou absente) ne désactive RIEN — sinon une sauvegarde de
      // métadonnées (édition unifiée) effaçait tous les formats gérés par l'éditeur.
      if (data.formats !== undefined && data.formats.length > 0) {
        const keptContenants = data.formats.map((f) => f.contenantId);
        // 1. Soft-delete des formats qui ne sont plus dans data.formats.
        //
        //    Piege SQL : `contenant_id <> ALL(...)` vaut NULL — donc faux — pour
        //    un format sans contenant. Ces formats echappaient au soft-delete.
        //    Ca compte depuis la mig 274, qui donne a chaque preparation de base
        //    un format d'attente a contenant NULL : sans le second predicat, le
        //    jour ou le chef rattache un vrai contenant, l'ancien resterait actif
        //    a cote et la base afficherait deux formats.
        //
        //    Restreint aux BASES a dessein : cote produits finis, 50 formats ont
        //    aussi un contenant NULL (assemblages, mig 267) et sont legitimes —
        //    les desactiver casserait leur nomenclature.
        await client.query(
          `UPDATE recipe_formats f
           SET is_active = false, is_default = false, updated_at = NOW()
           FROM recipes r
           WHERE r.id = f.recipe_id
             AND f.recipe_id = $1
             AND (f.contenant_id <> ALL($2::uuid[]) OR (f.contenant_id IS NULL AND r.is_base))`,
          [id, keptContenants],
        );
        // 2. Upsert (insert ou reactive + maj des valeurs)
        for (const fmt of data.formats) {
          await client.query(
            `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, cout_emballage_unitaire, ordre, prix_vente_unitaire_override, margin_multiplier_override, is_active, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
             ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
               quantite_par_format = EXCLUDED.quantite_par_format,
               quantite_par_format_unite = EXCLUDED.quantite_par_format_unite,
               nb_par_defaut = EXCLUDED.nb_par_defaut,
               cout_emballage_unitaire = EXCLUDED.cout_emballage_unitaire,
               ordre = EXCLUDED.ordre,
               prix_vente_unitaire_override = EXCLUDED.prix_vente_unitaire_override,
               margin_multiplier_override = EXCLUDED.margin_multiplier_override,
               is_active = true,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [id, fmt.contenantId, fmt.quantiteParFormatG, fmt.quantiteParFormatUnite || 'g', fmt.nbParDefaut, fmt.coutEmballageUnitaire ?? 0, fmt.ordre ?? 0,
             fmt.prixVenteUnitaireOverride ?? null, fmt.marginMultiplierOverride ?? null, data.changedBy ?? null]
          );
        }
        // Filet de securite : si la desactivation ci-dessus a retire le format par
        // defaut (is_default remis a false), en promouvoir un parmi les formats
        // actifs restants — sinon la recette se retrouverait sans format par defaut.
        await client.query(
          `UPDATE recipe_formats SET is_default = true, updated_at = NOW()
           WHERE id = (
             SELECT id FROM recipe_formats
             WHERE recipe_id = $1 AND is_active
             ORDER BY ordre, created_at LIMIT 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM recipe_formats
             WHERE recipe_id = $1 AND is_active AND is_default
           )`,
          [id],
        );
      }

      // Pas 2b-1 : des lignes « à plat » fournies ET non vides remplacent la nomenclature
      // du format par défaut (jamais plus l'ancien modèle). Le formulaire envoie
      // `ingredients: []` : un tableau vide ou une clé absente ne touche à rien, la
      // composition gérée par l'éditeur reste intacte.
      await writeCompositionLines(client, id, {
        ingredients: data.ingredients ?? [],
        subRecipes: data.subRecipes ?? [],
        packaging: data.packaging ?? [],
      }, data.changedBy ?? null);

      await this.syncProductPrice(
        client,
        currentRecipe?.product_id || null,
        totalCost,
        data.yieldQuantity || 1,
        data.yieldUnit || 'unit',
        data.pieceWeightKg ?? null,
        margin,
        data.salePrice ?? null,
      );

      await client.query('COMMIT');

      // Recalculate cost of parent recipes that use this one as sub-recipe
      await this.recalcParents(id);

      return this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Compute cost for a recipe.
   *  Lit directement la vue v_recipe_total_cost_v2 qui inclut ingredients + sous-recettes
   *  + emballages avec conversion d'unite. Plus de duplication de formule en JS. */
  async computeFullCost(recipeId: string): Promise<number> {
    const result = await db.query(
      `SELECT total_cost FROM v_recipe_total_cost_v2 WHERE id = $1`,
      [recipeId]
    );
    return parseFloat(result.rows[0]?.total_cost || '0');
  },

  /** When a packaging price changes, propagate price changes to products. */
  async recalcOnPackagingChange(packagingId: string) {
    const recipes = await db.query(
      // Pas 2b-1 : l'emballage est une ligne de nomenclature (mig 634), plus recipe_packaging.
      `SELECT DISTINCT f.recipe_id
         FROM recipe_format_components rfc
         JOIN recipe_formats f ON f.id = rfc.format_id AND f.is_active
        WHERE rfc.source_packaging_id = $1`,
      [packagingId]
    );
    for (const row of recipes.rows) {
      // total_cost vient de la vue (toujours a jour). Pas d'UPDATE recipes.total_cost.
      const totalCost = await this.computeFullCost(row.recipe_id);
      const recipe = await this.findById(row.recipe_id);
      if (!recipe) continue;
      const margin = parseFloat(recipe.margin_multiplier || '3');
      const yieldQty = parseFloat(recipe.yield_quantity || '1');
      const yieldUnit = recipe.yield_unit || 'unit';
      const pieceWeightKg = recipe.piece_weight_kg !== null && recipe.piece_weight_kg !== undefined
        ? parseFloat(recipe.piece_weight_kg as string) : null;
      await this.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, yieldUnit, pieceWeightKg, margin);
      // Cascade aux parents (si cette recette est utilisee comme sous-recette)
      await this.recalcParents(row.recipe_id);
    }
  },

  /** When a base recipe cost changes, propagate price changes to parent recipes' products. */
  async recalcParents(subRecipeId: string, visited = new Set<string>()) {
    if (visited.has(subRecipeId)) return; // prevent infinite loop
    visited.add(subRecipeId);

    // Remonte vers les recettes parentes par la nomenclature composée (miroir
    // recipe_components + recipe_format_components). L'ancien modèle n'est plus lu (2b-1).
    const parents = await db.query(
      `SELECT recipe_id FROM recipe_components WHERE source_recipe_id = $1
       UNION
       SELECT f.recipe_id
         FROM recipe_format_components rfc
         JOIN recipe_formats f ON f.id = rfc.format_id
        WHERE rfc.source_recipe_id = $1`,
      [subRecipeId]
    );
    for (const row of parents.rows) {
      const recipe = await this.findById(row.recipe_id);
      if (!recipe) continue;
      // total_cost vient de la vue (auto-reflete les changements du sous-arbre).
      // On ne touche plus recipes.total_cost — uniquement products.price via sync.
      const totalCost = await this.computeFullCost(row.recipe_id);
      const margin = parseFloat(recipe.margin_multiplier || '3');
      const yieldQty = parseFloat(recipe.yield_quantity || '1');
      const yieldUnit = recipe.yield_unit || 'unit';
      const pieceWeightKg = recipe.piece_weight_kg !== null && recipe.piece_weight_kg !== undefined
        ? parseFloat(recipe.piece_weight_kg as string) : null;
      await this.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, yieldUnit, pieceWeightKg, margin);

      // Recurse up to grandparents
      await this.recalcParents(row.recipe_id, visited);
    }
  },

  async findVersions(recipeId: string) {
    const result = await db.query(
      `SELECT rv.*, u.first_name || ' ' || u.last_name as changed_by_name
       FROM recipe_versions rv
       LEFT JOIN users u ON u.id = rv.changed_by
       WHERE rv.recipe_id = $1
       ORDER BY rv.version_number DESC`,
      [recipeId]
    );
    return result.rows;
  },

  async detectCycle(recipeId: string, subRecipeId: string, client?: { query: typeof db.query }): Promise<boolean> {
    // Check if adding subRecipeId as a sub-recipe of recipeId would create a cycle.
    // Walks the sub-recipe tree starting from subRecipeId; if recipeId appears in that
    // descendant chain, adding the edge recipeId -> subRecipeId would close a loop.
    // Accepts an optional transaction client so the check sees uncommitted DELETEs
    // performed earlier in the same update transaction.
    // Pas 2b-1 : arêtes de la nomenclature composée (format actif + miroir), plus l'ancien modèle.
    if (recipeId === subRecipeId) return true;
    const runner = client ?? db;
    const result = await runner.query(
      `WITH RECURSIVE edges AS (
         SELECT f.recipe_id AS parent, rfc.source_recipe_id AS child
           FROM recipe_format_components rfc
           JOIN recipe_formats f ON f.id = rfc.format_id AND f.is_active
          WHERE rfc.source_recipe_id IS NOT NULL
         UNION
         SELECT rc.recipe_id, rc.source_recipe_id FROM recipe_components rc WHERE rc.source_recipe_id IS NOT NULL
       ), chain AS (
         SELECT child AS sub_recipe_id, 1 AS depth FROM edges WHERE parent = $1
         UNION
         SELECT e.child, c.depth + 1
         FROM edges e
         JOIN chain c ON c.sub_recipe_id = e.parent
         WHERE c.depth < 20
       )
       SELECT 1 FROM chain WHERE sub_recipe_id = $2 LIMIT 1`,
      [subRecipeId, recipeId]
    );
    return result.rows.length > 0;
  },

  /**
   * Archivage (mig 346) — remplace la suppression physique : la fiche sort des
   * listes et des selecteurs mais reste lisible depuis l'historique de
   * production, et restaurable. Idempotent (deja archivee = ignoree).
   */
  async archive(ids: string[], userId: string | null) {
    const result = await db.query(
      `UPDATE recipes SET archived_at = NOW(), archived_by = $2, updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
      [ids, userId]
    );
    return { archivedCount: result.rowCount ?? 0 };
  },

  async restore(ids: string[]) {
    const result = await db.query(
      `UPDATE recipes SET archived_at = NULL, archived_by = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND archived_at IS NOT NULL`,
      [ids]
    );
    return { restoredCount: result.rowCount ?? 0 };
  },

  /**
   * Suppression en masse. Chaque fiche est supprimée dans son propre ordre SQL :
   * une recette référencée ailleurs (sous-recette, composant, plan de production —
   * FK ON DELETE RESTRICT) est conservée et remontée dans `blocked` au lieu de
   * faire échouer tout le lot.
   */
  async bulkDelete(ids: string[]) {
    const { rows } = await db.query('SELECT id, name FROM recipes WHERE id = ANY($1::uuid[])', [ids]);
    let deletedCount = 0;
    const blocked: { id: string; name: string }[] = [];
    for (const r of rows) {
      try {
        await db.query('DELETE FROM recipes WHERE id = $1', [r.id]);
        deletedCount++;
      } catch (err) {
        if ((err as { code?: string }).code === '23503') {
          blocked.push({ id: r.id, name: r.name });
          continue;
        }
        throw err;
      }
    }
    return { deletedCount, blocked };
  },

  /** Archive (retire des listes/sélecteurs sans supprimer). Idempotent. */
  async bulkArchive(ids: string[]) {
    const result = await db.query(
      `UPDATE recipes SET archived_at = now(), updated_at = now()
       WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
      [ids]
    );
    return { archivedCount: result.rowCount ?? 0 };
  },

  async bulkRestore(ids: string[]) {
    const result = await db.query(
      `UPDATE recipes SET archived_at = NULL, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND archived_at IS NOT NULL`,
      [ids]
    );
    return { restoredCount: result.rowCount ?? 0 };
  },

  // Explosion à plat (mig 400) : ingrédients élémentaires roulés sur tous les niveaux.
  async getExplosion(recipeId: string) {
    const result = await db.query(
      `SELECT ingredient_id, ingredient_name, unit,
              -- 6 décimales : arrondir à 3 en kg AVANT la conversion faisait 1,45 g de sel → « 1 g ».
              ROUND(total_qty, 6)  AS total_qty,
              ROUND(rolled_cost, 4) AS rolled_cost
       FROM v_recipe_explosion_v2
       WHERE recipe_id = $1
       ORDER BY rolled_cost DESC NULLS LAST, ingredient_name`,
      [recipeId]
    );
    // Unité d'affichage = celle SAISIE sur les fiches de l'arbre quand toutes les lignes de
    // l'ingrédient l'emploient (40 g de fromage restait « 0,04 kg », l'unité de stock) ;
    // sinon l'unité de stock du cumul.
    const entered = new Map<string, { unit: string; factor: number }>((await db.query(
      `WITH RECURSIVE tree(id) AS (
         SELECT $1::uuid
         UNION
         SELECT rc.source_recipe_id FROM recipe_components rc JOIN tree t ON rc.recipe_id = t.id
          WHERE rc.source_recipe_id IS NOT NULL
       ), u AS (
         SELECT rc.source_ingredient_id AS ingredient_id, array_agg(DISTINCT lower(rc.unite)) AS units
           FROM recipe_components rc JOIN tree t ON rc.recipe_id = t.id
          WHERE rc.source_ingredient_id IS NOT NULL
          GROUP BY rc.source_ingredient_id
       )
       SELECT u.ingredient_id, u.units[1] AS unit,
              fn_convert_factor(i.unit::text, u.units[1]::text, 'ingredient', i.id) AS factor
         FROM u JOIN ingredients i ON i.id = u.ingredient_id
        WHERE cardinality(u.units) = 1 AND u.units[1] IS DISTINCT FROM lower(i.unit)`, [recipeId])).rows
      .filter(r => r.factor != null && Number(r.factor) > 0)
      .map(r => [r.ingredient_id as string, { unit: r.unit as string, factor: Number(r.factor) }]));
    const lines = result.rows.map(r => {
      const total = r.total_qty != null ? parseFloat(r.total_qty) : 0;
      const e = entered.get(r.ingredient_id);
      return {
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        unit: r.unit,
        total_qty: total,
        display_qty: e ? Math.round(total * e.factor * 1000) / 1000 : total,
        display_unit: e ? e.unit : r.unit,
        rolled_cost: r.rolled_cost != null ? parseFloat(r.rolled_cost) : 0,
      };
    });
    // Base des quantités : la composition décrit une pièce, ou une fournée du format par défaut.
    const basis = (await db.query(
      `SELECT r.compo_par_piece, f.nb_par_defaut, f.rendement_unite, f.rendement_kg
         FROM recipes r
         LEFT JOIN LATERAL (SELECT nb_par_defaut, rendement_unite, rendement_kg FROM recipe_formats
                             WHERE recipe_id = r.id AND is_active ORDER BY is_default DESC, ordre LIMIT 1) f ON true
        WHERE r.id = $1`, [recipeId])).rows[0];
    const total = Math.round(lines.reduce((s, x) => s + x.rolled_cost, 0) * 100) / 100;
    return {
      lines, total_cost: total,
      basis: basis ? {
        par_piece: basis.compo_par_piece === true,
        nb_par_defaut: basis.nb_par_defaut != null ? Number(basis.nb_par_defaut) : null,
        rendement_kg: basis.rendement_unite === 'kg' && basis.rendement_kg != null ? Number(basis.rendement_kg) : null,
      } : null,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Remplacement de composant en masse A→B, annulable (mig 401) — roadmap lot 6
  // ═══════════════════════════════════════════════════════════════════════════

  // Recettes impactées par le remplacement de `sourceId` (3 tables), avec la version active
  // de chaque fiche (M4-05 : outil de mise à jour des nomenclatures).
  async previewBulkReplace(sourceId: string, targetId: string) {
    const ings = (await db.query(
      `SELECT id, name, unit FROM ingredients WHERE id = ANY($1::uuid[])`, [[sourceId, targetId]]
    )).rows as { id: string; name: string; unit: string }[];
    const source = ings.find(i => i.id === sourceId) ?? null;
    const target = ings.find(i => i.id === targetId) ?? null;
    const recipes = (await db.query(
      `SELECT r.id, r.name, SUM(a.cnt)::int AS occurrences,
              (SELECT b.version_no FROM bom_versions b WHERE b.recipe_id = r.id AND b.status = 'active') AS active_version
       FROM (
         SELECT recipe_id, count(*) cnt FROM recipe_components WHERE source_ingredient_id = $1 GROUP BY recipe_id
         UNION ALL
         SELECT rf.recipe_id, count(*) FROM recipe_format_components rfc
           JOIN recipe_formats rf ON rf.id = rfc.format_id
          WHERE rfc.source_ingredient_id = $1 GROUP BY rf.recipe_id
       ) a
       JOIN recipes r ON r.id = a.recipe_id
       GROUP BY r.id, r.name
       ORDER BY occurrences DESC, r.name`,
      [sourceId]
    )).rows as { id: string; name: string; occurrences: number; active_version: number | null }[];
    const rows_count = recipes.reduce((s, r) => s + r.occurrences, 0);
    return {
      source, target,
      unit_mismatch: !!source && !!target && source.unit !== target.unit,
      recipes, recipes_count: recipes.length, rows_count,
    };
  },

  /**
   * Applique et journalise (annulable). M4-05 :
   *  - mode « replace » : A → B sur les fiches choisies (toutes par défaut), quantités × ratio ;
   *  - mode « substitute » : B déclaré substitut de A (recipe_line_substitutes) pour les fiches
   *    choisies, ou une ligne générale si aucune fiche n'est choisie ; la composition ne change pas.
   * Rend aussi les fiches réellement modifiées (pour activer leur nouvelle version).
   */
  async applyBulkReplace(sourceId: string, targetId: string, userId: string,
    opts: { mode?: 'replace' | 'substitute'; ratio?: number; recipeIds?: string[] | null; priority?: number; validFrom?: string | null; validTo?: string | null } = {}) {
    if (sourceId === targetId) throw new Error('La source et la cible doivent être différentes');
    const mode = opts.mode ?? 'replace';
    const ratio = opts.ratio ?? 1;
    if (!(ratio > 0)) throw new Error('Le ratio doit être positif');
    const scope = opts.recipeIds?.length ? opts.recipeIds : null;
    return withTransaction(async () => {
      if (mode === 'substitute') {
        const targets: (string | null)[] = scope ?? [null];
        const ids: string[] = [];
        for (const rid of targets) {
          const r = await db.query(
            `INSERT INTO recipe_line_substitutes (recipe_id, ingredient_id, substitute_ingredient_id, ratio, priority, valid_from, valid_to, note, created_by)
             VALUES ($1, $2, $3, $4::numeric, $5::int, $6::date, $7::date, 'Remplacement en masse', $8)
             ON CONFLICT DO NOTHING RETURNING id`,
            [rid, sourceId, targetId, ratio, opts.priority ?? 1, opts.validFrom ?? null, opts.validTo ?? null, userId]);
          if (r.rows[0]) ids.push(r.rows[0].id);
        }
        if (!ids.length) return { rows_count: 0, recipes_count: 0, log_id: null, recipe_ids: [] as string[], mode };
        const log = (await db.query(
          `INSERT INTO recipe_bulk_replace_log (source_ingredient_id, target_ingredient_id, affected, recipes_count, rows_count, performed_by, mode, ratio, recipe_ids, substitute_ids)
           VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, 'substitute', $6::numeric, $7::uuid[], $8::uuid[]) RETURNING id`,
          [sourceId, targetId, scope ? ids.length : 0, ids.length, userId, ratio, scope, ids])).rows[0];
        return { rows_count: ids.length, recipes_count: scope ? ids.length : 0, log_id: log.id as string, recipe_ids: [] as string[], mode };
      }

      // Pas 2b-1 : seule la nomenclature par format est remplacée (le miroir suit par trigger).
      const rfc = (await db.query(
        `SELECT rfc.id::text FROM recipe_format_components rfc JOIN recipe_formats rf ON rf.id = rfc.format_id
          WHERE rfc.source_ingredient_id = $1 AND ($2::uuid[] IS NULL OR rf.recipe_id = ANY($2::uuid[]))`,
        [sourceId, scope])).rows.map(r => r.id as string);
      if (rfc.length === 0) return { rows_count: 0, recipes_count: 0, log_id: null, recipe_ids: [] as string[], mode };
      // Le miroir recipe_components est resynchronisé automatiquement par trigger
      // (mig 412) à la mise à jour de recipe_format_components ci-dessous.
      await db.query(
        `UPDATE recipe_format_components SET source_ingredient_id = $2, quantite = quantite * $3::numeric, updated_at = NOW() WHERE id::text = ANY($1::text[])`,
        [rfc, targetId, ratio]);
      const recipeIds = (await db.query(
        `SELECT DISTINCT rf.recipe_id::text AS id FROM recipe_format_components rfc JOIN recipe_formats rf ON rf.id = rfc.format_id WHERE rfc.id::text = ANY($1::text[])`,
        [rfc])).rows.map(r => r.id as string);
      // La clé recipe_ingredients reste dans le journal (vide) pour la forme des anciens journaux.
      const affected = { recipe_ingredients: [] as string[], recipe_format_components: rfc };
      const rowsCount = rfc.length;
      const log = (await db.query(
        `INSERT INTO recipe_bulk_replace_log (source_ingredient_id, target_ingredient_id, affected, recipes_count, rows_count, performed_by, mode, ratio, recipe_ids)
         VALUES ($1, $2, $3, $4, $5, $6, 'replace', $7::numeric, $8::uuid[]) RETURNING id`,
        [sourceId, targetId, JSON.stringify(affected), recipeIds.length, rowsCount, userId, ratio, scope]
      )).rows[0];
      return { rows_count: rowsCount, recipes_count: recipeIds.length, log_id: log.id as string, recipe_ids: recipeIds, mode };
    });
  },

  /** Versions activées après un remplacement (M4-05), pour le journal. */
  async markBulkReplaceVersions(logId: string, count: number) {
    await db.query(`UPDATE recipe_bulk_replace_log SET activated_versions = $2::int WHERE id = $1`, [logId, count]);
  },

  // Annule : restaure la source (quantités ÷ ratio) sur exactement les lignes journalisées,
  // ou retire les substituts créés (mode « substitute »).
  async revertBulkReplace(logId: string, userId: string) {
    return withTransaction(async () => {
      const log = (await db.query(`SELECT * FROM recipe_bulk_replace_log WHERE id = $1 FOR UPDATE`, [logId])).rows[0];
      if (!log) return { ok: false, reason: 'not_found' as const };
      if (log.reverted_at) return { ok: false, reason: 'already_reverted' as const };
      let restored = 0;
      if (log.mode === 'substitute') {
        restored = (await db.query(`DELETE FROM recipe_line_substitutes WHERE id = ANY($1::uuid[])`, [log.substitute_ids ?? []])).rowCount ?? 0;
      } else {
        const a = log.affected as { recipe_format_components?: string[] };
        const S = log.source_ingredient_id, T = log.target_ingredient_id, ratio = Number(log.ratio ?? 1);
        // Le miroir recipe_components est resynchronisé par trigger (mig 412) au revert
        // de recipe_format_components ci-dessous ; les clés recipe_components et
        // recipe_ingredients des anciens journaux sont ignorées (ancien modèle retiré, 2b-1).
        const r3 = await db.query(
          `UPDATE recipe_format_components SET source_ingredient_id = $1, quantite = quantite / $4::numeric, updated_at = NOW()
            WHERE id::text = ANY($3::text[]) AND source_ingredient_id = $2`,
          [S, T, a.recipe_format_components ?? [], ratio]);
        restored = r3.rowCount ?? 0;
      }
      await db.query(`UPDATE recipe_bulk_replace_log SET reverted_at = NOW(), reverted_by = $2 WHERE id = $1`, [logId, userId]);
      return { ok: true as const, restored };
    });
  },

  /**
   * M4-04 — une nomenclature supplémentaire devient la fiche par défaut de son produit ;
   * l'ancienne fiche par défaut devient une alternative du même produit. En une transaction,
   * fiches verrouillées (l'index unique sur product_id impose de libérer l'ancienne d'abord).
   */
  async makeDefaultRecipe(recipeId: string) {
    return withTransaction(async () => {
      const t = (await db.query(
        `SELECT id, name, alternative_for_product_id, archived_at FROM recipes WHERE id = $1 FOR UPDATE`, [recipeId])).rows[0];
      if (!t) throw Object.assign(new Error('Fiche introuvable'), { statusCode: 404 });
      if (!t.alternative_for_product_id) throw Object.assign(new Error('Cette fiche n\'est pas une nomenclature supplémentaire d\'un produit'), { statusCode: 409 });
      if (t.archived_at) throw Object.assign(new Error('Fiche archivée : restaurez-la d\'abord'), { statusCode: 409 });
      const productId = t.alternative_for_product_id as string;
      const cur = (await db.query(`SELECT id FROM recipes WHERE product_id = $1 FOR UPDATE`, [productId])).rows[0];
      if (cur) {
        await db.query(
          `UPDATE recipes SET product_id = NULL, alternative_for_product_id = $2, usage = 'alternative', updated_at = now() WHERE id = $1`,
          [cur.id, productId]);
      }
      await db.query(
        `UPDATE recipes SET product_id = $2, alternative_for_product_id = NULL, usage = 'fabrication', updated_at = now() WHERE id = $1`,
        [recipeId, productId]);
      return { productId, defaultRecipeId: recipeId, previousDefaultId: (cur?.id as string | undefined) ?? null };
    });
  },

  // Derniers remplacements (pour annuler).
  async listBulkReplaceLogs(limit = 10) {
    const r = await db.query(
      `SELECT l.id, l.recipes_count, l.rows_count, l.performed_at, l.reverted_at, l.mode, l.ratio::float8 AS ratio, l.activated_versions,
              si.name AS source_name, ti.name AS target_name,
              u.first_name AS performed_by_name
       FROM recipe_bulk_replace_log l
       JOIN ingredients si ON si.id = l.source_ingredient_id
       JOIN ingredients ti ON ti.id = l.target_ingredient_id
       LEFT JOIN users u ON u.id = l.performed_by
       ORDER BY l.performed_at DESC
       LIMIT $1`, [limit]
    );
    return r.rows;
  },
};
