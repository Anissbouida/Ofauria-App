import { db } from '../config/database.js';

/**
 * Lecture dediee a l'impression de la fiche technique.
 *
 * Pourquoi ne pas reutiliser recipeRepository.findById : sa requete `formats`
 * fait un JOIN (non LEFT) sur production_contenants, donc elle perd les formats
 * d'assemblage sans contenant — or ils doivent figurer sur la fiche papier. Et
 * elle ne remonte que la composition du format PAR DEFAUT, alors que la fiche a
 * besoin de la nomenclature de CHAQUE format : c'est justement ce qui change
 * d'un cadre a l'autre.
 *
 * Cout par format : les deux moteurs coexistent (mig 203). On lit les deux vues
 * et on choisit selon recipes.mode_cout.
 *   - compose     -> v_recipe_compose_cost : cout du lancement complet
 *   - ratio_poids -> v_recipe_format_cost  : cout deja rapporte a la piece
 */

export interface FicheRow {
  recipe: Record<string, unknown>;
  ingredients: Record<string, unknown>[];
  formats: Record<string, unknown>[];
  components: Record<string, unknown>[];
  /** Composition des sous-recettes citees par la nomenclature imprimee. */
  bases: Record<string, unknown>[];
}

export const recipeFicheRepository = {
  /**
   * @param formatId  Restreint la fiche a UN format (le cadre selectionne dans
   *                  l'editeur de nomenclature). null = tous les formats actifs.
   */
  async findForFiche(recipeId: string, formatId?: string | null): Promise<FicheRow | null> {
    const recipe = await db.query(
      `SELECT r.id, r.name, r.is_base, r.mode_cout, r.yield_quantity, r.yield_unit,
              r.perte_standard_pct, r.instructions, r.etapes, r.margin_multiplier,
              rc.label AS category_label,
              p.name AS product_name,
              vtc.total_cost
         FROM recipes r
         LEFT JOIN recipe_categories rc ON rc.id = r.category_id
         LEFT JOIN products p ON p.id = r.product_id
         LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
        WHERE r.id = $1`,
      [recipeId]
    );
    if (!recipe.rows[0]) return null;

    const ingredients = await db.query(
      `SELECT ing.name,
              ri.quantity,
              COALESCE(NULLIF(ri.unit, ''), ing.unit) AS unit,
              ri.quantity
                * COALESCE(ing.unit_cost, 0)
                * fn_unit_conv(COALESCE(NULLIF(ri.unit, ''), ing.unit), ing.unit, ing.densite_kg_l) AS cout_dh
         FROM recipe_ingredients ri
         JOIN ingredients ing ON ing.id = ri.ingredient_id
        WHERE ri.recipe_id = $1
        ORDER BY ing.name`,
      [recipeId]
    );

    const formats = await db.query(
      `SELECT rf.id, rf.is_default, rf.nb_par_defaut, rf.nb_parts,
              rf.quantite_par_format, rf.quantite_par_format_unite,
              rf.margin_multiplier_override, rf.prix_vente_unitaire_override,
              pc.nom AS contenant_nom,
              vcc.cout_compose_dh,
              vfc.cout_matiere_format, vfc.cout_matiere_unitaire,
              vfc.cout_unitaire_complet, vfc.prix_vente_unitaire
         FROM recipe_formats rf
         LEFT JOIN production_contenants pc ON pc.id = rf.contenant_id
         LEFT JOIN v_recipe_compose_cost vcc ON vcc.format_id = rf.id
         LEFT JOIN v_recipe_format_cost vfc ON vfc.id = rf.id
        WHERE rf.recipe_id = $1 AND rf.is_active = true
          AND ($2::uuid IS NULL OR rf.id = $2::uuid)
        ORDER BY rf.ordre, pc.nom NULLS LAST`,
      [recipeId, formatId ?? null]
    );

    const components = await db.query(
      `SELECT c.format_id, c.role, c.quantite, c.unite, c.perte_pct, c.ordre,
              c.source_recipe_id,
              COALESCE(br.name, ing.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS source_type,
              vcc.cout_dh, vcc.conversion_ok
         FROM recipe_format_components c
         JOIN recipe_formats rf ON rf.id = c.format_id
         LEFT JOIN recipes br ON br.id = c.source_recipe_id
         LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
         LEFT JOIN v_recipe_component_cost vcc ON vcc.component_id = c.id
        WHERE rf.recipe_id = $1
          AND ($2::uuid IS NULL OR rf.id = $2::uuid)
        ORDER BY c.ordre`,
      [recipeId, formatId ?? null]
    );

    // Composition des preparations de base citees par la nomenclature imprimee.
    // Sur un opera, la fiche liste « Biscuit Joconde 1200 g » : sans le detail de
    // la Joconde, le chef doit ouvrir une deuxieme fiche. On descend UN niveau
    // (les composants directs de chaque sous-recette), pas l'arbre entier — une
    // fiche de production n'est pas un explorateur de nomenclature.
    const bases = await db.query(
      `WITH sources AS (
         SELECT DISTINCT c.source_recipe_id AS id
           FROM recipe_format_components c
           JOIN recipe_formats rf ON rf.id = c.format_id
          WHERE rf.recipe_id = $1
            AND ($2::uuid IS NULL OR rf.id = $2::uuid)
            AND c.source_recipe_id IS NOT NULL
       )
       SELECT br.id            AS base_id,
              br.name          AS base_name,
              br.yield_quantity, br.yield_unit, br.perte_standard_pct,
              vtc.total_cost   AS base_cost,
              bes.besoin_net,
              ing.name         AS ingredient_name,
              ri.quantity,
              COALESCE(NULLIF(ri.unit, ''), ing.unit) AS unit,
              ri.quantity
                * COALESCE(ing.unit_cost, 0)
                * fn_unit_conv(COALESCE(NULLIF(ri.unit, ''), ing.unit), ing.unit, ing.densite_kg_l) AS cout_dh
         FROM sources s
         JOIN recipes br ON br.id = s.id
         LEFT JOIN v_recipe_total_cost vtc ON vtc.id = br.id
         -- Besoin NET de cette preparation pour le(s) format(s) imprime(s),
         -- exprime dans SON unite de rendement. La perte de ligne majore la
         -- quantite : 450 g a poser dans le cadre avec 5 % de casse, c'est
         -- 474 g a sortir du labo.
         LEFT JOIN LATERAL (
           SELECT SUM(
                    c.quantite
                    * fn_unit_conv(c.unite::text, br.yield_unit::text)
                    / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)
                  ) AS besoin_net
             FROM recipe_format_components c
             JOIN recipe_formats rf2 ON rf2.id = c.format_id
            WHERE c.source_recipe_id = br.id
              AND rf2.recipe_id = $1
              AND ($2::uuid IS NULL OR rf2.id = $2::uuid)
         ) bes ON true
         LEFT JOIN recipe_ingredients ri ON ri.recipe_id = br.id
         LEFT JOIN ingredients ing ON ing.id = ri.ingredient_id
        ORDER BY br.name, ing.name`,
      [recipeId, formatId ?? null]
    );

    return {
      recipe: recipe.rows[0],
      ingredients: ingredients.rows,
      formats: formats.rows,
      components: components.rows,
      bases: bases.rows,
    };
  },
};
