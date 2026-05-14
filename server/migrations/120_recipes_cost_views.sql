-- Migration 120 : vues SQL pour le cout calcule des recettes
--
-- Probleme : le champ recipes.total_cost etait stocke en brute lors des create/update.
-- En cas d'evolution de la formule de cout (ajout conversion d'unite g/kg, ml/l, etc.)
-- les recettes anciennes restaient avec un cout obsolete. Resultat : la liste
-- affichait des couts faux tandis que les recalculs frontend etaient corrects.
--
-- Solution : 2 vues qui calculent le cout a la volee depuis recipe_ingredients +
-- recipe_packaging + recipe_sub_recipes. Les readers doivent utiliser ces vues
-- au lieu de lire recipes.total_cost.
--
-- v_recipe_direct_cost : cout des ingredients + emballages d'une recette (sans
--   sous-recettes). Sert de base pour calculer le cout d'une recette utilisee
--   comme sous-recette.
--
-- v_recipe_total_cost : cout final = direct_cost + somme des sous-recettes
--   referencees, en utilisant le direct_cost de la sous-recette (donc pas la
--   valeur stockee). Supporte 1 niveau de nesting (preparations de base = leaf).

CREATE OR REPLACE VIEW v_recipe_direct_cost AS
SELECT r.id,
       r.yield_quantity,
       (
         COALESCE((
           SELECT SUM(
             ri.quantity * COALESCE(ing.unit_cost, 0) *
             CASE
               WHEN COALESCE(ri.unit, ing.unit) = 'g'  AND ing.unit = 'kg' THEN 0.001
               WHEN COALESCE(ri.unit, ing.unit) = 'kg' AND ing.unit = 'g'  THEN 1000
               WHEN COALESCE(ri.unit, ing.unit) = 'ml' AND ing.unit = 'l'  THEN 0.001
               WHEN COALESCE(ri.unit, ing.unit) = 'l'  AND ing.unit = 'ml' THEN 1000
               ELSE 1
             END
           )
           FROM recipe_ingredients ri
           JOIN ingredients ing ON ing.id = ri.ingredient_id
           WHERE ri.recipe_id = r.id
         ), 0)
         +
         COALESCE((
           SELECT SUM(rp.quantity * COALESCE(pi.unit_cost, 0))
           FROM recipe_packaging rp
           JOIN packaging_items pi ON pi.id = rp.packaging_id
           WHERE rp.recipe_id = r.id
         ), 0)
       ) AS direct_cost
FROM recipes r;

CREATE OR REPLACE VIEW v_recipe_total_cost AS
SELECT r.id,
       (
         COALESCE(vdc.direct_cost, 0)
         +
         COALESCE((
           SELECT SUM(
             rsr.quantity * COALESCE(vdc2.direct_cost, 0) / NULLIF(vdc2.yield_quantity, 0)
           )
           FROM recipe_sub_recipes rsr
           JOIN v_recipe_direct_cost vdc2 ON vdc2.id = rsr.sub_recipe_id
           WHERE rsr.recipe_id = r.id
         ), 0)
       ) AS total_cost
FROM recipes r
LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = r.id;

COMMENT ON VIEW v_recipe_total_cost IS
  'Cout total recalcule a la volee. Utiliser cette vue partout au lieu de recipes.total_cost.';
