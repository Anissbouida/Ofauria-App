-- Migration 204 : v_recipe_total_cost récursive + consciente du mode (BASCULE)
--
-- POURQUOI
--   Brancher la nomenclature (recipe_format_components) sur le coût LIVE, et
--   corriger l'imbrication >1 niveau.
--   - mode_cout='compose'  → coût = ingrédients propres + composants du format
--       par défaut (recettes de base via coût récursif, ingrédients directs via
--       unit_cost). Hors emballage (ajouté par format dans v_recipe_format_cost).
--   - mode_cout='ratio_poids' (défaut) → comportement legacy inchangé
--       (direct + Σ recipe_sub_recipes), mais désormais RÉCURSIF.
--   Colonnes inchangées (id, total_cost) → v_recipe_format_cost / v_recipe_component_cost
--   continuent de fonctionner. Numériquement IDENTIQUE à aujourd'hui (validé :
--   coût composé == legacy, profondeur d'imbrication actuelle ≤ 1).
--
-- PORTÉE
--   CREATE OR REPLACE d'une seule vue. Garde-fou de récursion depth<12 (les
--   cycles sont déjà interdits par recipe_sub_recipes CHECK recipe_id<>sub_recipe_id).
--
-- INVERSION : restaurer la définition précédente (direct + Σ sub, 1 niveau).

CREATE OR REPLACE VIEW v_recipe_total_cost AS
WITH RECURSIVE
own AS (
  -- Coût "propre" matière d'une recette (hors emballage) :
  -- direct (ingrédients + packaging) + en mode compose, les ingrédients directs
  -- de la nomenclature du format par défaut.
  SELECT r.id,
         COALESCE(dc.direct_cost, 0)
         + CASE WHEN r.mode_cout = 'compose' THEN COALESCE((
             SELECT SUM(c.quantite * fn_unit_conv(c.unite, ing.unit::text) * COALESCE(ing.unit_cost, 0))
             FROM recipe_formats df
             JOIN recipe_format_components c ON c.format_id = df.id AND c.source_ingredient_id IS NOT NULL
             JOIN ingredients ing ON ing.id = c.source_ingredient_id
             WHERE df.recipe_id = r.id AND df.is_default
           ), 0) ELSE 0 END AS own_cost
  FROM recipes r
  LEFT JOIN v_recipe_direct_cost dc ON dc.id = r.id
),
edges AS (
  -- ratio_poids : arêtes legacy (sans conversion d'unité, comme avant)
  SELECT r.id AS parent, rsr.sub_recipe_id AS child,
         rsr.quantity / NULLIF(ch.yield_quantity, 0) AS frac
  FROM recipes r
  JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
  JOIN recipes ch ON ch.id = rsr.sub_recipe_id
  WHERE r.mode_cout <> 'compose'
  UNION ALL
  -- compose : arêtes vers les recettes de base de la nomenclature (format défaut)
  SELECT r.id, c.source_recipe_id,
         c.quantite * fn_unit_conv(c.unite, ch.yield_unit)
           / NULLIF(ch.yield_quantity * (1 - COALESCE(ch.perte_standard_pct, 0) / 100), 0)
  FROM recipes r
  JOIN recipe_formats df ON df.recipe_id = r.id AND df.is_default
  JOIN recipe_format_components c ON c.format_id = df.id AND c.source_recipe_id IS NOT NULL
  JOIN recipes ch ON ch.id = c.source_recipe_id
  WHERE r.mode_cout = 'compose'
),
expand AS (
  SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth
  FROM recipes r
  UNION ALL
  SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
  FROM expand e
  JOIN edges eg ON eg.parent = e.node
  WHERE e.depth < 12
)
SELECT x.root AS id,
       SUM(o.own_cost * x.mult) AS total_cost
FROM expand x
JOIN own o ON o.id = x.node
GROUP BY x.root;
