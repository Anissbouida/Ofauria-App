-- 621 — Coût de revient incomplet d'une fiche (scénario 1, constat 108).
--
-- POURQUOI
--   Un ingrédient sans prix comptait pour 0 DH et une conversion d'unité douteuse
--   (litres d'un ingrédient au kilo, sans densité) était comptée à 1 l = 1 kg : le
--   coût de revient paraissait juste alors qu'il était faux, sans aucune marque.
--
-- CE QUI CHANGE
--   Vue v_recipe_cost_gaps : une ligne par trou dans le coût d'une fiche, y compris
--   à travers ses préparations de base (récursif, profondeur 8) :
--     motif 'sans_prix'        : ingrédient dont le coût unitaire est nul ;
--     motif 'conversion'       : conversion d'unité douteuse (v_recipe_component_cost_v2.conversion_ok) ;
--     motif 'preparation_vide' : préparation de base sans aucune ligne.
--   `via` nomme la préparation de base par laquelle le trou remonte (NULL = ligne directe).
--   Les montants ne changent pas : la fiche est marquée « coût incomplet ».
--
-- INVERSION
--   DROP VIEW v_recipe_cost_gaps.

CREATE OR REPLACE VIEW v_recipe_cost_gaps AS
WITH RECURSIVE lines AS (
  SELECT f.recipe_id, c.source_ingredient_id, c.source_recipe_id, vc.conversion_ok,
         ing.name AS ingredient_name, ing.unit_cost, sr.name AS sub_name
    FROM recipe_format_components c
    JOIN recipe_formats f ON f.id = c.format_id AND f.is_active
    JOIN v_recipe_component_cost_v2 vc ON vc.component_id = c.id
    LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
    LEFT JOIN recipes sr ON sr.id = c.source_recipe_id
),
direct AS (
  SELECT recipe_id, ingredient_name::text AS composant, 'sans_prix'::text AS motif
    FROM lines WHERE source_ingredient_id IS NOT NULL AND COALESCE(unit_cost, 0) <= 0
  UNION
  SELECT recipe_id, COALESCE(ingredient_name, sub_name)::text, 'conversion'
    FROM lines WHERE conversion_ok IS FALSE
  UNION
  SELECT l.recipe_id, l.sub_name::text, 'preparation_vide'
    FROM lines l
   WHERE l.source_recipe_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM recipe_format_components c2 JOIN recipe_formats f2 ON f2.id = c2.format_id
                      WHERE f2.recipe_id = l.source_recipe_id)
),
gaps (recipe_id, composant, motif, via, depth) AS (
  SELECT recipe_id, composant, motif, NULL::text, 0 FROM direct
  UNION
  SELECT l.recipe_id, g.composant, g.motif, l.sub_name::text, g.depth + 1
    FROM gaps g JOIN lines l ON l.source_recipe_id = g.recipe_id
   WHERE g.depth < 8
)
SELECT DISTINCT recipe_id, composant, motif, via FROM gaps;

COMMENT ON VIEW v_recipe_cost_gaps IS
  'Trous du coût de revient d''une fiche (mig 621) : ingrédient sans prix, conversion douteuse, préparation vide ; récursif par les préparations de base (via).';
