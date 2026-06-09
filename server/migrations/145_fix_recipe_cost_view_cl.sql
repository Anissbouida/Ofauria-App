-- Migration 145 : completer la matrice de conversion d'unite dans v_recipe_direct_cost
--
-- Probleme : la version initiale (migration 120) ne couvre que g/kg et ml/l.
-- Toute recette utilisant `cl` comme unite ingredient (ex: 36.66 cl de lait avec
-- un cout stocke en DH/l) etait calculee SANS conversion -> facteur 1 -> cout
-- multiplie par 100 (36.66 cl traite comme 36.66 l).
--
-- Symptome utilisateur : la liste des recettes affichait des couts aberrants
-- (ex: 403 DH pour une creme patissiere alors que le total reel est 4.62 DH).
-- Le client React recalculait correctement dans la vue detail via sa propre
-- matrice de conversion, d'ou l'incoherence liste vs detail.
--
-- Correction : etendre le CASE a toutes les combinaisons same-base :
--   - g <-> kg
--   - l <-> cl, l <-> ml, cl <-> ml
-- Les conversions cross-base (ex: g vers l) ne sont jamais legitimes -> facteur 1
-- comme garde-fou (le cout sera faux mais c'est une erreur de saisie).

CREATE OR REPLACE VIEW v_recipe_direct_cost AS
SELECT r.id,
       r.yield_quantity,
       (
         COALESCE((
           SELECT SUM(
             ri.quantity * COALESCE(ing.unit_cost, 0) *
             CASE
               -- Pas de conversion necessaire
               WHEN COALESCE(ri.unit, ing.unit) = ing.unit THEN 1
               -- Conversions Poids
               WHEN COALESCE(ri.unit, ing.unit) = 'g'  AND ing.unit = 'kg' THEN 0.001
               WHEN COALESCE(ri.unit, ing.unit) = 'kg' AND ing.unit = 'g'  THEN 1000
               -- Conversions Volume l/ml
               WHEN COALESCE(ri.unit, ing.unit) = 'ml' AND ing.unit = 'l'  THEN 0.001
               WHEN COALESCE(ri.unit, ing.unit) = 'l'  AND ing.unit = 'ml' THEN 1000
               -- Conversions Volume cl (manquaient en 120)
               WHEN COALESCE(ri.unit, ing.unit) = 'cl' AND ing.unit = 'l'  THEN 0.01
               WHEN COALESCE(ri.unit, ing.unit) = 'l'  AND ing.unit = 'cl' THEN 100
               WHEN COALESCE(ri.unit, ing.unit) = 'cl' AND ing.unit = 'ml' THEN 10
               WHEN COALESCE(ri.unit, ing.unit) = 'ml' AND ing.unit = 'cl' THEN 0.1
               -- Cross-base ou unite inconnue : pas de conversion
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

COMMENT ON VIEW v_recipe_direct_cost IS
  'Cout direct (ingredients + emballages) recalcule a la volee. Conversion d''unite : g/kg, l/cl/ml. Cross-base ignore.';
