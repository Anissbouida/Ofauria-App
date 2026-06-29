import { db } from '../config/database.js';
import {
  yieldInSellingUnit,
  requiresPieceWeight,
  YieldConversionError,
  type SellingUnit,
} from '../utils/units.js';

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
 * Returns 1 if units are incompatible (no conversion possible).
 */
function unitConversionFactor(fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return 1;
  const from = UNIT_TO_BASE[fromUnit];
  const to = UNIT_TO_BASE[toUnit];
  if (!from || !to || from.base !== to.base) return 1; // incompatible units
  return from.factor / to.factor;
}

export const recipeRepository = {
  async findAll() {
    // total_cost vient de la vue v_recipe_total_cost (recalcule a la volee).
    // Le champ recipes.total_cost stocke n'est jamais lu — toujours obsolete potentiel.
    // formats_nb / formats_perte_pct exposes pour badge "multi-format" et alerte perte.
    // formats : tableau JSON agrege via subquery pour les UI qui ont besoin de connaitre
    // les formats par recette (ex: ProductionPage — Phase B multi-format).
    const result = await db.query(
      `SELECT r.id, r.name, r.is_base, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.category_id, r.mode_cout, r.compo_par_piece,
              rc.code AS category_code, rc.label AS category_label, rc.color AS category_color,
              r.created_at, r.updated_at,
              vtc.total_cost,
              vfs.nb_formats AS formats_nb,
              vfs.perte_pct AS formats_perte_pct,
              df.nb_par_defaut AS rendement,
              dfc.nom AS default_contenant_nom,
              dfc.id IS NOT NULL AND dfc.nom ILIKE '%assemblage%' AS rendement_a_definir,
              (vtc.total_cost IS NULL OR vtc.total_cost = 0) AS compo_vide,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', rf.id,
                  'contenant_id', rf.contenant_id,
                  'contenant_nom', pcf.nom,
                  'quantite_par_format_g', rf.quantite_par_format_g,
                  'quantite_par_format_unite', rf.quantite_par_format_unite,
                  'nb_par_defaut', rf.nb_par_defaut
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
              pc.poids_kg as contenant_poids_kg
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       LEFT JOIN recipe_categories rc ON rc.id = r.category_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_format_summary vfs ON vfs.recipe_id = r.id
       LEFT JOIN LATERAL (
         SELECT rf.nb_par_defaut, rf.contenant_id
         FROM recipe_formats rf
         WHERE rf.recipe_id = r.id AND rf.is_active = true
         ORDER BY rf.is_default DESC, rf.ordre LIMIT 1
       ) df ON true
       LEFT JOIN production_contenants dfc ON dfc.id = df.contenant_id
       ORDER BY r.is_base DESC, r.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    // total_cost vient de la vue v_recipe_total_cost. On override le champ stocke.
    // total_weight_kg : idem, calcule a la volee a partir des ingredients
    // (densite 1 pour les liquides, pieces ignorees).
    const recipeResult = await db.query(
      `SELECT r.id, r.name, r.is_base, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.category_id,
              rc.code AS category_code, rc.label AS category_label, rc.color AS category_color,
              r.taux_main_oeuvre_dh_h, r.cout_energie_fournee, r.taux_frais_structure_pct,
              r.mode_cout, r.perte_standard_pct, r.pieces_par_fournee, r.compo_par_piece,
              r.created_at, r.updated_at,
              vtc.total_cost,
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
              pc.poids_kg as contenant_poids_kg
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       LEFT JOIN recipe_categories rc ON rc.id = r.category_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
       LEFT JOIN v_recipe_format_summary vfs ON vfs.recipe_id = r.id
       WHERE r.id = $1`,
      [id]
    );
    if (!recipeResult.rows[0]) return null;

    const ingredientsResult = await db.query(
      `SELECT ri.*, ing.name as ingredient_name, COALESCE(ri.unit, ing.unit) as unit, ing.unit as ingredient_base_unit, ing.unit_cost
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [id]
    );

    // sub_total_cost / sub_total_weight_kg : valeurs directes de la sous-recette
    // (vues v_recipe_direct_cost / v_recipe_direct_weight_kg). Le frontend divise
    // par sub_yield_quantity pour obtenir cout/poids par unite de rendement.
    const subRecipesResult = await db.query(
      `SELECT rsr.id, rsr.sub_recipe_id, rsr.quantity,
              sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
              sr.yield_unit as sub_yield_unit,
              vdc.direct_cost AS sub_total_cost,
              vdw.direct_weight_kg AS sub_total_weight_kg
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = sr.id
       LEFT JOIN v_recipe_direct_weight_kg vdw ON vdw.id = sr.id
       WHERE rsr.recipe_id = $1`,
      [id]
    );

    // Fetch packaging
    const packagingResult = await db.query(
      `SELECT rp.id, rp.packaging_id, rp.quantity, rp.unit, rp.notes,
              pi.name as packaging_name, pi.format, pi.unit_cost, pi.unit as base_unit, pi.category
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [id]
    );

    // Formats de production : poids, nb, ventilation cout matiere/MO/energie/structure
    const formatsResult = await db.query(
      `SELECT rf.id, rf.contenant_id, rf.quantite_par_format_g, rf.quantite_par_format_unite, rf.nb_par_defaut,
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
       JOIN production_contenants pc ON pc.id = rf.contenant_id
       LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rf.id
       WHERE rf.recipe_id = $1 AND rf.is_active = true
       ORDER BY rf.ordre ASC, pc.nom ASC`,
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
       LEFT JOIN v_rcomp_cost cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre`,
      [id]
    );

    return {
      ...recipeResult.rows[0],
      ingredients: ingredientsResult.rows,
      sub_recipes: subRecipesResult.rows,
      composition: compositionResult.rows,
      packaging: packagingResult.rows,
      formats: formatsResult.rows,
    };
  },

  /** Find recipe by product ID (with ingredients & sub-recipes & packaging) */
  async findByProductId(productId: string) {
    const recipeResult = await db.query(
      `SELECT r.id, r.name, r.is_base, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.piece_weight_kg, r.margin_multiplier, r.etapes,
              r.created_at, r.updated_at,
              vtc.total_cost,
              p.name as product_name, p.price as product_price
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       WHERE r.product_id = $1`,
      [productId]
    );
    if (!recipeResult.rows[0]) return null;

    const recipeId = recipeResult.rows[0].id;
    const ingredientsResult = await db.query(
      `SELECT ri.*, ing.name as ingredient_name, COALESCE(ri.unit, ing.unit) as unit, ing.unit as ingredient_base_unit, ing.unit_cost
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [recipeId]
    );
    const subRecipesResult = await db.query(
      `SELECT rsr.id, rsr.sub_recipe_id, rsr.quantity,
              sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
              sr.yield_unit as sub_yield_unit,
              vdc.direct_cost AS sub_total_cost
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = sr.id
       WHERE rsr.recipe_id = $1`,
      [recipeId]
    );
    const packagingResult = await db.query(
      `SELECT rp.id, rp.packaging_id, rp.quantity, rp.unit, rp.notes,
              pi.name as packaging_name, pi.format, pi.unit_cost, pi.unit as base_unit, pi.category
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [recipeId]
    );

    const formatsResult = await db.query(
      `SELECT rf.id, rf.contenant_id, rf.quantite_par_format_g, rf.quantite_par_format_unite, rf.nb_par_defaut,
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
      ingredients: ingredientsResult.rows,
      sub_recipes: subRecipesResult.rows,
      packaging: packagingResult.rows,
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
   *  total_cost vient de la vue v_recipe_total_cost. */
  async findBaseRecipes() {
    const result = await db.query(
      `SELECT r.id, r.name, r.yield_quantity, r.yield_unit, vtc.total_cost,
              vtw.total_weight_kg
       FROM recipes r
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
       WHERE r.is_base = true
       ORDER BY r.name`
    );
    return result.rows;
  },

  async create(data: {
    productId?: string; name: string; instructions?: string; yieldQuantity?: number; yieldUnit?: string;
    pieceWeightKg?: number | null; isBase?: boolean;
    categoryId?: string | null;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    // Frais indirects (defaults pris dans company_settings via INSERT a l'inscription)
    tauxMainOeuvreDhH?: number; coutEnergieFournee?: number; tauxFraisStructurePct?: number;
    ingredients: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
    formats?: { contenantId: string; quantiteParFormatG: number; quantiteParFormatUnite?: string; nbParDefaut: number; coutEmballageUnitaire?: number; ordre?: number; prixVenteUnitaireOverride?: number | null; marginMultiplierOverride?: number | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Garde-fou yield_unit vs products.sale_unit : si pas de piece_weight_kg
      // alors qu'il est requis, on refuse l'enregistrement avec un message clair.
      await this.ensureYieldUnitCompatible(
        client,
        data.productId || null,
        data.yieldUnit || 'unit',
        data.pieceWeightKg ?? null,
      );

      // Calcul du cout JS pour syncProductPrice uniquement (le champ recipes.total_cost
      // n'est plus stocke — il est calcule a la volee via v_recipe_total_cost).
      let totalCost = 0;
      for (const ing of (data.ingredients ?? [])) {
        const ingResult = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      // Sous-recettes : on lit le direct_cost depuis la vue (jamais la valeur stockee)
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            `SELECT vdc.direct_cost AS total_cost, vdc.yield_quantity
             FROM v_recipe_direct_cost vdc WHERE vdc.id = $1`, [sr.subRecipeId]
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

      const margin = data.marginMultiplier && data.marginMultiplier > 0 ? data.marginMultiplier : 3;
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
        `INSERT INTO recipes (product_id, name, instructions, yield_quantity, yield_unit, piece_weight_kg, total_cost, is_base, contenant_id, etapes, margin_multiplier,
                              taux_main_oeuvre_dh_h, cout_energie_fournee, taux_frais_structure_pct, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [data.productId || null, data.name, data.instructions || null, data.yieldQuantity || 1, data.yieldUnit || 'unit',
         data.pieceWeightKg ?? null,
         data.isBase || false, data.contenantId || null, JSON.stringify(data.etapes || []), margin,
         tauxMo, coutEnergie, tauxStruct, data.categoryId ?? null]
      );

      const recipeId = recipeResult.rows[0].id;

      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
          [recipeId, ing.ingredientId, ing.quantity, ing.unit || null]
        );
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

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [recipeId, sr.subRecipeId, sr.quantity]
          );
        }
      }

      // Insert recipe_packaging links
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          await client.query(
            `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
            [recipeId, pk.packagingId, pk.quantity, pk.unit ?? null]
          );
        }
      }

      // Insert recipe_formats (multi-formats de production)
      if (data.formats && data.formats.length > 0) {
        for (const fmt of data.formats) {
          await client.query(
            `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite, nb_par_defaut, cout_emballage_unitaire, ordre, prix_vente_unitaire_override, margin_multiplier_override)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
               quantite_par_format_g = EXCLUDED.quantite_par_format_g,
               quantite_par_format_unite = EXCLUDED.quantite_par_format_unite,
               nb_par_defaut = EXCLUDED.nb_par_defaut,
               cout_emballage_unitaire = EXCLUDED.cout_emballage_unitaire,
               ordre = EXCLUDED.ordre,
               prix_vente_unitaire_override = EXCLUDED.prix_vente_unitaire_override,
               margin_multiplier_override = EXCLUDED.margin_multiplier_override,
               updated_at = NOW()`,
            [recipeId, fmt.contenantId, fmt.quantiteParFormatG, fmt.quantiteParFormatUnite || 'g', fmt.nbParDefaut, fmt.coutEmballageUnitaire ?? 0, fmt.ordre ?? 0,
             fmt.prixVenteUnitaireOverride ?? null, fmt.marginMultiplierOverride ?? null]
          );
        }
      }

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

      await client.query('COMMIT');
      return recipeResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
    if (!productId || yieldQuantity <= 0) return;

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
        console.warn(`syncProductPrice skip product=${productId}: ${err.message}`);
        return;
      }
      throw err;
    }
    if (yieldInSU <= 0) return;

    const costPerSellingUnit = totalCost / yieldInSU;
    const computedPrice = costPerSellingUnit * marginMultiplier;
    const finalPrice = overridePrice !== null && overridePrice >= 0 ? overridePrice : computedPrice;

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
    categoryId?: string | null;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    tauxMainOeuvreDhH?: number; coutEnergieFournee?: number; tauxFraisStructurePct?: number;
    ingredients?: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
    formats?: { contenantId: string; quantiteParFormatG: number; quantiteParFormatUnite?: string; nbParDefaut: number; coutEmballageUnitaire?: number; ordre?: number; prixVenteUnitaireOverride?: number | null; marginMultiplierOverride?: number | null }[];
    changedBy?: string; changeNote?: string;
  }) {
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
        const versionNumResult = await client.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM recipe_versions WHERE recipe_id = $1`,
          [id]
        );
        const nextVersion = versionNumResult.rows[0].next_version;

        await client.query(
          `INSERT INTO recipe_versions (recipe_id, version_number, name, instructions, yield_quantity, yield_unit, piece_weight_kg, total_cost, is_base, ingredients, sub_recipes, changed_by, change_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            id,
            nextVersion,
            currentRecipe.name,
            currentRecipe.instructions,
            currentRecipe.yield_quantity,
            currentRecipe.yield_unit || 'unit',
            currentRecipe.piece_weight_kg ?? null,
            currentRecipe.total_cost,
            currentRecipe.is_base,
            JSON.stringify(currentRecipe.ingredients),
            JSON.stringify(currentRecipe.sub_recipes),
            data.changedBy || null,
            data.changeNote || null,
          ]
        );
      }

      let totalCost = 0;
      for (const ing of (data.ingredients ?? [])) {
        const ingResult = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            `SELECT vdc.direct_cost AS total_cost, vdc.yield_quantity
             FROM v_recipe_direct_cost vdc WHERE vdc.id = $1`, [sr.subRecipeId]
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
      // total_cost n'est plus stocke (vue v_recipe_total_cost gere) — on le force a 0.
      // Frais indirects : si data ne les fournit pas, on conserve les valeurs existantes (COALESCE).
      await client.query(
        `UPDATE recipes SET name = $1, instructions = $2, yield_quantity = $3, yield_unit = $4, piece_weight_kg = $5, total_cost = 0, is_base = $6, contenant_id = $7, etapes = $8, margin_multiplier = $9,
           taux_main_oeuvre_dh_h = COALESCE($10, taux_main_oeuvre_dh_h),
           cout_energie_fournee = COALESCE($11, cout_energie_fournee),
           taux_frais_structure_pct = COALESCE($12, taux_frais_structure_pct),
           category_id = $13,
           updated_at = NOW()
         WHERE id = $14`,
        [data.name, data.instructions || null, data.yieldQuantity || 1, data.yieldUnit || 'unit', data.pieceWeightKg ?? null,
         data.isBase || false, data.contenantId || null, JSON.stringify(data.etapes || []), margin,
         data.tauxMainOeuvreDhH ?? null, data.coutEnergieFournee ?? null, data.tauxFraisStructurePct ?? null,
         data.categoryId ?? null, id]
      );

      // Re-insert ingredients — UNIQUEMENT si fournis (édition unifiée : le formulaire
      // ne les envoie pas pour un produit composé → la composition de l'éditeur reste intacte).
      if (data.ingredients !== undefined) {
        await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
        for (const ing of data.ingredients) {
          await client.query(
            `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
            [id, ing.ingredientId, ing.quantity, ing.unit || null]
          );
        }
      }

      // Re-insert sub-recipes — idem, uniquement si fournies.
      if (data.subRecipes !== undefined) {
        await client.query('DELETE FROM recipe_sub_recipes WHERE recipe_id = $1', [id]);
        for (const sr of data.subRecipes) {
          const hasCycle = await this.detectCycle(sr.subRecipeId, id, client);
          if (hasCycle) {
            throw new Error(`Référence circulaire détectée: la sous-recette créerait un cycle`);
          }
        }
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [id, sr.subRecipeId, sr.quantity]
          );
        }
      }

      // Re-insert recipe_packaging
      await client.query('DELETE FROM recipe_packaging WHERE recipe_id = $1', [id]);
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          await client.query(
            `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
            [id, pk.packagingId, pk.quantity, pk.unit ?? null]
          );
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
        // 1. Soft-delete des formats qui ne sont plus dans data.formats
        await client.query(
          `UPDATE recipe_formats
           SET is_active = false, updated_at = NOW()
           WHERE recipe_id = $1 AND contenant_id <> ALL($2::uuid[])`,
          [id, keptContenants],
        );
        // 2. Upsert (insert ou reactive + maj des valeurs)
        for (const fmt of data.formats) {
          await client.query(
            `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite, nb_par_defaut, cout_emballage_unitaire, ordre, prix_vente_unitaire_override, margin_multiplier_override, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
             ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
               quantite_par_format_g = EXCLUDED.quantite_par_format_g,
               quantite_par_format_unite = EXCLUDED.quantite_par_format_unite,
               nb_par_defaut = EXCLUDED.nb_par_defaut,
               cout_emballage_unitaire = EXCLUDED.cout_emballage_unitaire,
               ordre = EXCLUDED.ordre,
               prix_vente_unitaire_override = EXCLUDED.prix_vente_unitaire_override,
               margin_multiplier_override = EXCLUDED.margin_multiplier_override,
               is_active = true,
               updated_at = NOW()`,
            [id, fmt.contenantId, fmt.quantiteParFormatG, fmt.quantiteParFormatUnite || 'g', fmt.nbParDefaut, fmt.coutEmballageUnitaire ?? 0, fmt.ordre ?? 0,
             fmt.prixVenteUnitaireOverride ?? null, fmt.marginMultiplierOverride ?? null]
          );
        }
      }

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
   *  Lit directement la vue v_recipe_total_cost qui inclut ingredients + sous-recettes
   *  + emballages avec conversion d'unite. Plus de duplication de formule en JS. */
  async computeFullCost(recipeId: string): Promise<number> {
    const result = await db.query(
      `SELECT total_cost FROM v_recipe_total_cost WHERE id = $1`,
      [recipeId]
    );
    return parseFloat(result.rows[0]?.total_cost || '0');
  },

  /** When a packaging price changes, propagate price changes to products. */
  async recalcOnPackagingChange(packagingId: string) {
    const recipes = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_packaging WHERE packaging_id = $1`,
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

    const parents = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_sub_recipes WHERE sub_recipe_id = $1`,
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
    const runner = client ?? db;
    const result = await runner.query(
      `WITH RECURSIVE chain AS (
         SELECT sub_recipe_id FROM recipe_sub_recipes WHERE recipe_id = $1
         UNION ALL
         SELECT rsr.sub_recipe_id
         FROM recipe_sub_recipes rsr
         JOIN chain c ON c.sub_recipe_id = rsr.recipe_id
       )
       SELECT 1 FROM chain WHERE sub_recipe_id = $2 LIMIT 1`,
      [subRecipeId, recipeId]
    );
    return result.rows.length > 0;
  },

  async delete(id: string) {
    await db.query('DELETE FROM recipes WHERE id = $1', [id]);
  },
};
