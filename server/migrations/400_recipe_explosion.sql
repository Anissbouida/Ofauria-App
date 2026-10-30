-- 400 — Explosion de nomenclature à plat avec coût roulé (Production, roadmap lot 5)
--
-- v_recipe_total_cost (mig 120/205) calcule déjà le coût multi-niveaux par
-- récursion, mais ne sort que le TOTAL par recette, pas la liste à plat des
-- ingrédients élémentaires. Pour une recette composée de sous-recettes (ex. Opéra
-- = 5 sous-recettes), on ne savait pas « au total, combien de farine / sucre /
-- beurre ? » ni d'où vient chaque dirham. C'est l'équivalent du « BOM Explosion
-- Item » d'ERPNext.
--
-- v_recipe_explosion déplie la nomenclature sur tous les niveaux (même récursion
-- EXACTE que v_recipe_total_cost : mêmes arêtes sous-recettes legacy + composants
-- compose, mêmes conversions d'unité/densité et pertes), puis agrège par ingrédient
-- élémentaire : quantité totale (dans l'unité de l'ingrédient) et coût roulé.
--
-- GARANTIE : Σ(rolled_cost) d'une recette = v_recipe_total_cost − coût emballage
-- (l'explosion ne couvre que les ingrédients, pas recipe_packaging). Vérifié sur
-- tout le catalogue : 0 écart > 0,02 DH sur les recettes sans emballage.
--
-- Choix : une VUE (pas de table matérialisée + trigger). Les coûts d'entrée sont
-- déjà des vues vivantes ; l'explosion à la demande d'une recette (WHERE recipe_id)
-- reste rapide (récursion bornée à 12 niveaux), toujours cohérente, sans refresh.
--
-- INVERSION : DROP VIEW IF EXISTS v_recipe_explosion;

CREATE OR REPLACE VIEW v_recipe_explosion AS
WITH RECURSIVE edges AS (
  -- Sous-recettes « legacy » (recipe_sub_recipes) pour les modes non-compose.
  SELECT r.id AS parent,
         rsr.sub_recipe_id AS child,
         rsr.quantity / NULLIF(ch.yield_quantity, 0) AS frac
  FROM recipes r
  JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
  JOIN recipes ch ON ch.id = rsr.sub_recipe_id
  WHERE r.mode_cout::text <> 'compose'
  UNION ALL
  -- Sous-recettes « composant » (recipe_components) pour le mode compose.
  SELECT r.id,
         c.source_recipe_id,
         c.quantite * fn_unit_conv(c.unite::text, ch.yield_unit::text)
           / NULLIF(ch.yield_quantity * (1 - COALESCE(ch.perte_standard_pct, 0) / 100), 0)
  FROM recipes r
  JOIN recipe_components c ON c.recipe_id = r.id AND c.source_recipe_id IS NOT NULL
  JOIN recipes ch ON ch.id = c.source_recipe_id
  WHERE r.mode_cout::text = 'compose'
),
expand AS (
  SELECT r.id AS root, r.id AS node, 1::numeric AS mult, 0 AS depth
  FROM recipes r
  UNION ALL
  SELECT e.root, eg.child, e.mult * eg.frac, e.depth + 1
  FROM expand e
  JOIN edges eg ON eg.parent = e.node
  WHERE e.depth < 12
),
node_ings AS (
  -- Ingrédients directs (recipe_ingredients) — tous modes.
  SELECT ri.recipe_id AS node,
         ri.ingredient_id,
         ri.quantity * fn_unit_conv(COALESCE(NULLIF(ri.unit::text, ''), ing.unit::text), ing.unit::text, ing.densite_kg_l) AS qty,
         ri.quantity * fn_unit_conv(COALESCE(NULLIF(ri.unit::text, ''), ing.unit::text), ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0) AS cost
  FROM recipe_ingredients ri
  JOIN ingredients ing ON ing.id = ri.ingredient_id
  UNION ALL
  -- Ingrédients « composant » (recipe_components) — mode compose uniquement,
  -- cohérent avec own_cost de v_recipe_total_cost.
  SELECT c.recipe_id,
         c.source_ingredient_id,
         c.quantite * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l),
         c.quantite * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l) * COALESCE(ing.unit_cost, 0)
  FROM recipe_components c
  JOIN recipes r ON r.id = c.recipe_id AND r.mode_cout::text = 'compose'
  JOIN ingredients ing ON ing.id = c.source_ingredient_id
  WHERE c.source_ingredient_id IS NOT NULL
)
SELECT
  x.root            AS recipe_id,
  ni.ingredient_id,
  ing.name          AS ingredient_name,
  ing.unit,
  SUM(ni.qty * x.mult)  AS total_qty,
  SUM(ni.cost * x.mult) AS rolled_cost
FROM expand x
JOIN node_ings ni ON ni.node = x.node
JOIN ingredients ing ON ing.id = ni.ingredient_id
GROUP BY x.root, ni.ingredient_id, ing.name, ing.unit;

COMMENT ON VIEW v_recipe_explosion IS
  'Explosion à plat d''une recette : chaque ingrédient élémentaire avec quantité et coût roulés sur tous les niveaux (roadmap production lot 5).';
