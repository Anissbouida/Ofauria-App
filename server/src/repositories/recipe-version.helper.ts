/**
 * Versioning complet d'une recette (mig 346).
 *
 * Capture l'etat de la fiche AVANT une modification, quel que soit le chemin
 * d'ecriture : formulaire recette (recipe.repository.update), nomenclature par
 * format (recipe-component.repository.replaceForFormat), leviers financiers
 * (updateFinance). Avant, seul le formulaire versionnait, et seulement le
 * modele legacy : une recette composee avait des versions vides.
 *
 * Les colonnes historiques de recipe_versions restent alimentees (l'UI les
 * lit) ; la capture complete va dans `snapshot` (JSONB).
 */

interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> }

export async function snapshotRecipeVersion(
  q: Queryable,
  recipeId: string,
  changedBy: string | null,
  changeNote: string | null,
): Promise<number | null> {
  const rec = await q.query(
    `SELECT r.*, vtc.total_cost AS computed_total_cost
     FROM recipes r LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
     WHERE r.id = $1`,
    [recipeId]
  );
  const recipe = rec.rows[0];
  if (!recipe) return null;

  const [ingredients, subRecipes, components, formats, packaging] = await Promise.all([
    q.query(
      `SELECT ri.ingredient_id, ing.name AS ingredient_name, ri.quantity, COALESCE(ri.unit, ing.unit) AS unit
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1 ORDER BY ing.name`, [recipeId]),
    q.query(
      `SELECT rsr.sub_recipe_id, sr.name AS sub_recipe_name, rsr.quantity
       FROM recipe_sub_recipes rsr JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1 ORDER BY sr.name`, [recipeId]),
    q.query(
      `SELECT c.role, c.source_recipe_id, br.name AS source_recipe_name,
              c.source_ingredient_id, ing.name AS source_ingredient_name,
              c.quantite, c.unite, c.ordre, c.perte_pct
       FROM recipe_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       WHERE c.recipe_id = $1 ORDER BY c.ordre`, [recipeId]),
    q.query(
      `SELECT f.id, f.contenant_id, f.quantite_par_format, f.quantite_par_format_unite, f.nb_par_defaut,
              f.nb_parts, f.poids_cru_g, f.poids_cuit_g, f.densite_kg_l, f.cout_emballage_unitaire,
              f.is_default, f.is_active, f.product_id, f.prix_vente_unitaire_override, f.margin_multiplier_override,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'role', fc.role, 'source_recipe_id', fc.source_recipe_id, 'source_recipe_name', br.name,
                  'source_ingredient_id', fc.source_ingredient_id, 'source_ingredient_name', ing.name,
                  'quantite', fc.quantite, 'unite', fc.unite, 'ordre', fc.ordre, 'perte_pct', fc.perte_pct
                ) ORDER BY fc.ordre)
                FROM recipe_format_components fc
                LEFT JOIN recipes br ON br.id = fc.source_recipe_id
                LEFT JOIN ingredients ing ON ing.id = fc.source_ingredient_id
                WHERE fc.format_id = f.id
              ), '[]'::json) AS components
       FROM recipe_formats f WHERE f.recipe_id = $1 ORDER BY f.ordre`, [recipeId]),
    q.query(
      `SELECT rp.packaging_id, pi.name AS packaging_name, rp.quantity, rp.unit
       FROM recipe_packaging rp JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`, [recipeId]),
  ]);

  const snapshot = {
    recipe: {
      name: recipe.name, instructions: recipe.instructions, is_base: recipe.is_base,
      product_id: recipe.product_id, category_id: recipe.category_id, contenant_id: recipe.contenant_id,
      yield_quantity: recipe.yield_quantity, yield_unit: recipe.yield_unit, piece_weight_kg: recipe.piece_weight_kg,
      pieces_par_fournee: recipe.pieces_par_fournee, compo_par_piece: recipe.compo_par_piece,
      mode_cout: recipe.mode_cout, perte_standard_pct: recipe.perte_standard_pct,
      margin_multiplier: recipe.margin_multiplier,
      taux_main_oeuvre_dh_h: recipe.taux_main_oeuvre_dh_h, main_oeuvre_min: recipe.main_oeuvre_min,
      cout_energie_fournee: recipe.cout_energie_fournee, taux_frais_structure_pct: recipe.taux_frais_structure_pct,
      temperature_pate_cible_c: recipe.temperature_pate_cible_c, hydratation_pct: recipe.hydratation_pct,
      total_cost: recipe.computed_total_cost,
    },
    etapes: recipe.etapes ?? [],
    ingredients: ingredients.rows,
    sub_recipes: subRecipes.rows,
    components: components.rows,
    formats: formats.rows,
    packaging: packaging.rows,
  };

  const next = await q.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM recipe_versions WHERE recipe_id = $1`,
    [recipeId]
  );
  const versionNumber: number = next.rows[0].next_version;

  await q.query(
    `INSERT INTO recipe_versions
       (recipe_id, version_number, name, instructions, yield_quantity, yield_unit, piece_weight_kg,
        total_cost, is_base, ingredients, sub_recipes, changed_by, change_note, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [recipeId, versionNumber, recipe.name, recipe.instructions, recipe.yield_quantity,
     recipe.yield_unit || 'unit', recipe.piece_weight_kg ?? null, recipe.computed_total_cost ?? 0,
     recipe.is_base, JSON.stringify(ingredients.rows), JSON.stringify(subRecipes.rows),
     changedBy, changeNote, JSON.stringify(snapshot)]
  );
  return versionNumber;
}
