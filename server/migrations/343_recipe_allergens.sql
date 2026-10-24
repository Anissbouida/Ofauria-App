-- Migration 343 : allergenes agreges de l'ingredient a la recette et au produit
--
-- POURQUOI (audit Production & Fiches techniques 2026-10-23, §2.1 — P2)
--   ingredients.allergens (TEXT[], mig 004) existe depuis le debut mais n'etait
--   jamais agrege : une fiche technique ne savait pas dire « contient gluten,
--   lait, oeufs », alors que c'est une mention obligatoire sur l'etiquette et la
--   premiere question d'un client en boutique. L'information doit remonter
--   toute la nomenclature : un entremets herite des allergenes de sa creme, qui
--   herite de ceux de son lait et de ses oeufs.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   v_recipe_allergens(recipe_id, allergens text[], nb_allergens)
--     Union DISTINCT, normalisee (minuscules, espaces tronques, vides ignores),
--     des allergenes de TOUS les ingredients atteignables depuis la recette :
--       - ingredients directs legacy (recipe_ingredients) ;
--       - composants ingredient du miroir (recipe_components) ;
--       - composants ingredient de TOUS les formats actifs
--         (recipe_format_components x recipe_formats.is_active) — un allergene
--         present dans un seul format est declare : on prefere declarer trop
--         que pas assez ;
--       - recursivement a travers les sous-recettes, par les deux familles
--         d'aretes (recipe_sub_recipes legacy, recipe_components source_recipe_id,
--         recipe_format_components source_recipe_id), profondeur <= 12 comme
--         v_recipe_total_cost.
--     Contrairement au cout, la QUANTITE ne compte pas : une trace suffit.
--   v_product_allergens(product_id, allergens, nb_allergens)
--     Projection par recipes.product_id (1 recette <-> 1 produit).
--
-- PORTEE
--   Deux vues, aucune donnee touchee. Rejouables (CREATE OR REPLACE).
--   Le vocabulaire des allergenes reste libre (celui saisi sur l'ingredient) ;
--   la normalisation evite seulement les doublons « Gluten » / « gluten ».
--
-- INVERSION
--   DROP VIEW IF EXISTS v_product_allergens; DROP VIEW IF EXISTS v_recipe_allergens;

CREATE OR REPLACE VIEW v_recipe_allergens AS
WITH RECURSIVE
edges AS (
  -- sous-recettes legacy
  SELECT rsr.recipe_id AS parent, rsr.sub_recipe_id AS child
  FROM recipe_sub_recipes rsr
  UNION
  -- composants « recette de base » du miroir (format par defaut)
  SELECT c.recipe_id, c.source_recipe_id
  FROM recipe_components c
  WHERE c.source_recipe_id IS NOT NULL
  UNION
  -- composants « recette de base » de tous les formats actifs
  SELECT f.recipe_id, fc.source_recipe_id
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active = true
  WHERE fc.source_recipe_id IS NOT NULL
),
expand AS (
  SELECT r.id AS root, r.id AS node, 0 AS depth, ARRAY[r.id] AS path
  FROM recipes r
  UNION ALL
  SELECT e.root, eg.child, e.depth + 1, e.path || eg.child
  FROM expand e
  JOIN edges eg ON eg.parent = e.node
  WHERE e.depth < 12 AND NOT (eg.child = ANY (e.path))   -- garde anti-cycle
),
node_ingredients AS (
  SELECT ri.recipe_id AS node, ri.ingredient_id FROM recipe_ingredients ri
  UNION
  SELECT c.recipe_id, c.source_ingredient_id FROM recipe_components c WHERE c.source_ingredient_id IS NOT NULL
  UNION
  SELECT f.recipe_id, fc.source_ingredient_id
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active = true
  WHERE fc.source_ingredient_id IS NOT NULL
),
reachable AS (
  SELECT DISTINCT x.root AS recipe_id, lower(btrim(a)) AS allergen
  FROM expand x
  JOIN node_ingredients ni ON ni.node = x.node
  JOIN ingredients ing ON ing.id = ni.ingredient_id
  CROSS JOIN LATERAL unnest(COALESCE(ing.allergens, '{}'::text[])) AS a
  WHERE btrim(a) <> ''
)
SELECT r.id AS recipe_id,
       COALESCE(array_agg(ra.allergen ORDER BY ra.allergen) FILTER (WHERE ra.allergen IS NOT NULL), '{}'::text[]) AS allergens,
       COUNT(ra.allergen)::int AS nb_allergens
FROM recipes r
LEFT JOIN reachable ra ON ra.recipe_id = r.id
GROUP BY r.id;

COMMENT ON VIEW v_recipe_allergens IS
  'Allergenes agreges (mig 343) : union normalisee des allergenes de tous les ingredients atteignables par la nomenclature (legacy + compose + tous formats actifs), profondeur <= 12. Une trace suffit : la quantite ne compte pas.';

CREATE OR REPLACE VIEW v_product_allergens AS
SELECT r.product_id, va.allergens, va.nb_allergens
FROM recipes r
JOIN v_recipe_allergens va ON va.recipe_id = r.id
WHERE r.product_id IS NOT NULL;

COMMENT ON VIEW v_product_allergens IS
  'Allergenes du produit vendu = ceux de sa recette (recipes.product_id, 1:1). Pour l''etiquette et le POS.';
