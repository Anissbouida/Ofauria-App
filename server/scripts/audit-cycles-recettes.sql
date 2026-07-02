-- ============================================================================
-- AUDIT COMPOSITION RECETTES : cycles, profondeur, incohérences de mode/unités
-- ============================================================================
-- Contexte : la détection de cycle (detectComponentCycle + CHECK mig 215) ne
-- protège que les INSERTIONS. Les cycles déjà en base sont tronqués en silence
-- à depth 12 par v_recipe_total_cost (mig 204/205) → coût sous-estimé.
-- Ce script est en lecture seule. À exécuter avec psql sur la base de prod.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CYCLES dans le graphe de composition
-- ----------------------------------------------------------------------------
-- Les arêtes reproduisent exactement celles de v_recipe_total_cost :
--   mode ratio_poids -> recipe_sub_recipes ; mode compose -> recipe_components.
-- Chaque cycle est rapporté une fois par recette membre (A→B→A et B→A→B) :
-- dédupliquer visuellement, c'est le chemin qui compte.
WITH RECURSIVE edges AS (
  SELECT rsr.recipe_id AS parent, rsr.sub_recipe_id AS child
  FROM recipe_sub_recipes rsr
  JOIN recipes r ON r.id = rsr.recipe_id
  WHERE r.mode_cout IS DISTINCT FROM 'compose'
  UNION
  SELECT c.recipe_id, c.source_recipe_id
  FROM recipe_components c
  JOIN recipes r ON r.id = c.recipe_id
  WHERE r.mode_cout = 'compose' AND c.source_recipe_id IS NOT NULL
),
walk AS (
  SELECT e.parent AS root, e.child AS node,
         ARRAY[e.parent] AS path,
         (e.child = e.parent) AS is_cycle,
         1 AS depth
  FROM edges e
  UNION ALL
  SELECT w.root, e.child,
         w.path || w.node,
         e.child = ANY (w.path || w.node),
         w.depth + 1
  FROM walk w
  JOIN edges e ON e.parent = w.node
  WHERE NOT w.is_cycle AND w.depth < 20
)
SELECT w.depth AS longueur,
       (SELECT string_agg(r.name, ' -> ' ORDER BY p.ord)
          FROM unnest(w.path || w.node) WITH ORDINALITY AS p(id, ord)
          JOIN recipes r ON r.id = p.id) AS chemin_cycle
FROM walk w
WHERE w.is_cycle AND w.node = w.root
ORDER BY w.depth, chemin_cycle;

-- ----------------------------------------------------------------------------
-- 2) RECETTES qui atteignent la limite de récursion (depth >= 12)
-- ----------------------------------------------------------------------------
-- Sans être des cycles, ces recettes sont tronquées par la vue de coût.
WITH RECURSIVE edges AS (
  SELECT rsr.recipe_id AS parent, rsr.sub_recipe_id AS child
  FROM recipe_sub_recipes rsr
  JOIN recipes r ON r.id = rsr.recipe_id
  WHERE r.mode_cout IS DISTINCT FROM 'compose'
  UNION
  SELECT c.recipe_id, c.source_recipe_id
  FROM recipe_components c
  JOIN recipes r ON r.id = c.recipe_id
  WHERE r.mode_cout = 'compose' AND c.source_recipe_id IS NOT NULL
),
walk AS (
  SELECT e.parent AS root, e.child AS node, ARRAY[e.parent] AS path, 1 AS depth
  FROM edges e
  UNION ALL
  SELECT w.root, e.child, w.path || w.node, w.depth + 1
  FROM walk w
  JOIN edges e ON e.parent = w.node
  WHERE NOT (e.child = ANY (w.path || w.node)) AND w.depth < 14
)
SELECT DISTINCT r.id, r.name, MAX(w.depth) AS profondeur_max
FROM walk w JOIN recipes r ON r.id = w.root
GROUP BY r.id, r.name
HAVING MAX(w.depth) >= 12
ORDER BY profondeur_max DESC, r.name;

-- ----------------------------------------------------------------------------
-- 3) INCOHÉRENCES DE MODE (résidus de la double nomenclature)
-- ----------------------------------------------------------------------------
-- 3a. Recettes en mode compose SANS composants : coût = direct_cost seulement,
--     et surtout AUCUN besoin ingrédient calculé à la confirmation d'un plan.
SELECT r.id, r.name, 'compose sans recipe_components' AS anomalie
FROM recipes r
WHERE r.mode_cout = 'compose'
  AND NOT EXISTS (SELECT 1 FROM recipe_components c WHERE c.recipe_id = r.id);

-- 3b. Recettes en mode ratio_poids qui ont pourtant des recipe_components
--     (résidus de miroir après bascule de mode) : ignorés par la vue de coût.
SELECT r.id, r.name, count(c.id) AS composants_fantomes
FROM recipes r
JOIN recipe_components c ON c.recipe_id = r.id
WHERE r.mode_cout IS DISTINCT FROM 'compose'
GROUP BY r.id, r.name
ORDER BY composants_fantomes DESC;

-- 3c. Recettes compose avec des restes legacy (recipe_ingredients/sub_recipes) :
--     comptés dans direct_cost par v_recipe_direct_cost -> risque de DOUBLE compte.
SELECT r.id, r.name,
       (SELECT count(*) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)  AS legacy_ingredients,
       (SELECT count(*) FROM recipe_sub_recipes rs WHERE rs.recipe_id = r.id) AS legacy_sous_recettes
FROM recipes r
WHERE r.mode_cout = 'compose'
  AND (EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)
    OR EXISTS (SELECT 1 FROM recipe_sub_recipes rs WHERE rs.recipe_id = r.id));

-- ----------------------------------------------------------------------------
-- 4) UNITÉS INCOMPATIBLES (fn_unit_conv retourne 1 en silence)
-- ----------------------------------------------------------------------------
-- 4a. Composant ingrédient : unité de saisie vs unité de base de l'ingrédient.
--     Ex : compo en 'g' pour un ingrédient stocké en 'l' -> coût faux sans erreur.
SELECT r.name AS recette, ing.name AS ingredient,
       c.quantite, c.unite AS unite_compo, ing.unit AS unite_ingredient
FROM recipe_components c
JOIN recipes r      ON r.id = c.recipe_id
JOIN ingredients ing ON ing.id = c.source_ingredient_id
WHERE c.unite IS DISTINCT FROM ing.unit
  AND NOT (c.unite IN ('g','kg','mg')       AND ing.unit IN ('g','kg','mg'))
  AND NOT (c.unite IN ('ml','cl','dl','l') AND ing.unit IN ('ml','cl','dl','l'))
UNION ALL
SELECT r.name, ing.name, c.quantite, c.unite, ing.unit
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
JOIN recipes r        ON r.id = f.recipe_id
JOIN ingredients ing  ON ing.id = c.source_ingredient_id
WHERE c.unite IS DISTINCT FROM ing.unit
  AND NOT (c.unite IN ('g','kg','mg')       AND ing.unit IN ('g','kg','mg'))
  AND NOT (c.unite IN ('ml','cl','dl','l') AND ing.unit IN ('ml','cl','dl','l'));

-- 4b. Composant sous-recette : unité de saisie vs yield_unit de la recette de base.
SELECT r.name AS recette, br.name AS sous_recette,
       c.quantite, c.unite AS unite_compo, br.yield_unit AS unite_rendement_base
FROM recipe_components c
JOIN recipes r  ON r.id = c.recipe_id
JOIN recipes br ON br.id = c.source_recipe_id
WHERE c.unite IS DISTINCT FROM br.yield_unit
  AND NOT (c.unite IN ('g','kg','mg')       AND br.yield_unit IN ('g','kg','mg'))
  AND NOT (c.unite IN ('ml','cl','dl','l') AND br.yield_unit IN ('ml','cl','dl','l'));

-- ----------------------------------------------------------------------------
-- 5) DIVISEURS À RISQUE (division par zéro dans vues et besoins)
-- ----------------------------------------------------------------------------
-- 5a. Rendement nul/NULL : diviseur de tous les calculs de coût et de besoins.
SELECT id, name, yield_quantity, yield_unit
FROM recipes
WHERE COALESCE(yield_quantity, 0) <= 0;

-- 5b. Perte >= 100 % : rend le diviseur (yield x (1 - perte/100)) nul ou négatif.
SELECT id, name, perte_standard_pct
FROM recipes
WHERE perte_standard_pct >= 100;

-- 5c. Formats actifs avec nb_par_defaut nul/NULL (diviseur du coût unitaire).
SELECT r.name AS recette, f.id AS format_id, f.nb_par_defaut
FROM recipe_formats f
JOIN recipes r ON r.id = f.recipe_id
WHERE f.is_active AND COALESCE(f.nb_par_defaut, 0) <= 0;
