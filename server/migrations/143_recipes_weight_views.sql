-- Migration 143 : vues SQL pour le poids calcule des recettes (en kg).
--
-- Probleme : le poids total d'une recette n'etait pas calculable cote client
-- pour les sous-recettes dont yield_unit = 'unit' (preparations de base
-- comptees a la piece comme "Mousse Chocolat Blanc" yield 1 unit). Resultat :
-- le smart button "Poids total" sous-estimait les recettes qui utilisent ces
-- preparations comme ingredient.
--
-- Solution : 2 vues qui calculent le poids a la volee. Densite = 1 pour les
-- liquides (approximation standard en patisserie). Les pieces non liquides
-- (unit) sont ignorees dans le total.
--
-- v_recipe_direct_weight_kg : poids des ingredients d'une recette (sans
--   sous-recettes). Sert de base pour calculer le poids d'une sous-recette.
--
-- v_recipe_total_weight_kg : poids final = direct + somme des sous-recettes,
--   chaque sous-recette etant prise au prorata de quantity / yield_quantity.

CREATE OR REPLACE VIEW v_recipe_direct_weight_kg AS
SELECT r.id,
       r.yield_quantity,
       (
         COALESCE((
           SELECT SUM(
             ri.quantity *
             CASE LOWER(COALESCE(ri.unit, ing.unit))
               WHEN 'kg' THEN 1
               WHEN 'g'  THEN 0.001
               WHEN 'l'  THEN 1
               WHEN 'cl' THEN 0.01
               WHEN 'ml' THEN 0.001
               ELSE 0
             END
           )
           FROM recipe_ingredients ri
           JOIN ingredients ing ON ing.id = ri.ingredient_id
           WHERE ri.recipe_id = r.id
         ), 0)
       ) AS direct_weight_kg
FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_total_weight_kg AS
SELECT r.id,
       (
         COALESCE(vdw.direct_weight_kg, 0)
         +
         COALESCE((
           SELECT SUM(
             rsr.quantity * COALESCE(vdw2.direct_weight_kg, 0) / NULLIF(vdw2.yield_quantity, 0)
           )
           FROM recipe_sub_recipes rsr
           JOIN v_recipe_direct_weight_kg vdw2 ON vdw2.id = rsr.sub_recipe_id
           WHERE rsr.recipe_id = r.id
         ), 0)
       ) AS total_weight_kg
FROM recipes r
LEFT JOIN v_recipe_direct_weight_kg vdw ON vdw.id = r.id;

COMMENT ON VIEW v_recipe_total_weight_kg IS
  'Poids total en kg recalcule a la volee. Inclut les sous-recettes meme si leur yield_unit est en pieces.';
