-- G2-01 (plan d'action 2026-11) — complétude des données maîtres.
--
-- CONTEXTE
--   Les chiffres de l'audit (poids cuit sur 0 format, allergènes sur 0 ingrédient, étapes
--   sur 14 fiches…) viennent de la base locale. Ce script les mesure sur la base où il est
--   lancé, pour dimensionner le lot « données maîtres et étiquetage » (G2-03 à G2-09).
--
-- LECTURE SEULE. Ce script n'écrit rien : uniquement des SELECT.
--
-- DÉFINITIONS (les mêmes que l'écran Paramètres › Qualité des données, G2-02 —
-- server/src/services/master-data-quality.ts ; garder les deux alignés)
--   fiche active        : recette non archivée (recipes.archived_at IS NULL)
--   format actif        : recipe_formats.is_active d'une fiche active
--   allergènes à saisir : fiche sans allergène et jamais vérifiée. La colonne de
--                         vérification (allergens_reviewed_at, mig 541, G2-06) est lue par
--                         to_jsonb pour que ce script passe aussi sur une base d'avant la 541,
--                         où toute fiche sans allergène compte comme « à saisir »
--   homonymes           : même nom sans tenir compte de la casse ni des espaces
--   prix aberrant       : coût unitaire plus de 5 fois au-dessus ou au-dessous de la
--                         médiane des ingrédients de même catégorie et de même unité
--                         (catégories d'au moins 5 ingrédients valorisés)
--   jamais produite     : aucune ligne de plan de production pour la fiche ou son produit
--
-- USAGE : psql "$DATABASE_URL" -f scripts/diagnose-master-data.sql

\echo '═══ 1. Synthèse ═══'
WITH active_recipes AS (SELECT * FROM recipes WHERE archived_at IS NULL),
med AS (
  SELECT category_id, unit, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost) AS median, COUNT(*) AS n
    FROM ingredients WHERE unit_cost > 0 AND category_id IS NOT NULL GROUP BY category_id, unit
),
priced AS (
  SELECT i.id, i.category_id, i.unit, i.unit_cost, m.median, m.n
    FROM ingredients i JOIN med m ON m.category_id = i.category_id AND m.unit = i.unit
   WHERE i.unit_cost > 0
)
SELECT 'Formats actifs sans poids cuit' AS indicateur,
       (SELECT COUNT(*) FROM recipe_formats rf JOIN active_recipes r ON r.id = rf.recipe_id WHERE rf.is_active AND rf.poids_cuit_g IS NULL) AS a_corriger,
       (SELECT COUNT(*) FROM recipe_formats rf JOIN active_recipes r ON r.id = rf.recipe_id WHERE rf.is_active) AS total
UNION ALL SELECT 'Ingrédients sans allergènes renseignés',
       (SELECT COUNT(*) FROM ingredients i WHERE COALESCE(cardinality(i.allergens), 0) = 0 AND to_jsonb(i) ->> 'allergens_reviewed_at' IS NULL), (SELECT COUNT(*) FROM ingredients)
UNION ALL SELECT 'Fiches actives sans étapes',
       (SELECT COUNT(*) FROM active_recipes WHERE etapes IS NULL OR jsonb_typeof(etapes) <> 'array' OR jsonb_array_length(etapes) = 0),
       (SELECT COUNT(*) FROM active_recipes)
UNION ALL SELECT 'Ingrédients homonymes (fiches en trop)',
       (SELECT COALESCE(SUM(c - 1), 0) FROM (SELECT COUNT(*) AS c FROM ingredients GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1) d),
       (SELECT COUNT(*) FROM ingredients)
UNION ALL SELECT 'Ingrédients sans prix',
       (SELECT COUNT(*) FROM ingredients WHERE COALESCE(unit_cost, 0) = 0), (SELECT COUNT(*) FROM ingredients)
UNION ALL SELECT 'Prix unitaires aberrants',
       (SELECT COUNT(*) FROM priced WHERE n >= 5 AND median > 0 AND (unit_cost > median * 5 OR unit_cost < median / 5)),
       (SELECT COUNT(*) FROM priced WHERE n >= 5)
UNION ALL SELECT 'Fiches actives jamais produites',
       (SELECT COUNT(*) FROM active_recipes r
         WHERE NOT EXISTS (SELECT 1 FROM production_plan_items ppi
                            WHERE ppi.base_recipe_id = r.id OR (r.product_id IS NOT NULL AND ppi.product_id = r.product_id))),
       (SELECT COUNT(*) FROM active_recipes);

\echo ''
\echo '═══ 2. Formats actifs sans poids cuit ═══'
SELECT r.name AS fiche, COALESCE(pc.nom, '(sans contenant)') AS format, rf.poids_cru_g, rf.is_default AS par_defaut
  FROM recipe_formats rf
  JOIN recipes r ON r.id = rf.recipe_id AND r.archived_at IS NULL
  LEFT JOIN production_contenants pc ON pc.id = rf.contenant_id
 WHERE rf.is_active AND rf.poids_cuit_g IS NULL
 ORDER BY r.name, rf.ordre;

\echo ''
\echo '═══ 3. Ingrédients sans allergènes renseignés, par catégorie ═══'
SELECT COALESCE(ec.name, i.category, '(sans catégorie)') AS categorie, COUNT(*) AS ingredients
  FROM ingredients i LEFT JOIN expense_categories ec ON ec.id = i.category_id
 WHERE COALESCE(cardinality(i.allergens), 0) = 0 AND to_jsonb(i) ->> 'allergens_reviewed_at' IS NULL
 GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '═══ 4. Fiches actives sans étapes, les plus produites d''abord ═══'
SELECT r.name AS fiche, r.is_base AS base,
       (SELECT COUNT(*) FROM production_plan_items ppi
         WHERE ppi.base_recipe_id = r.id OR (r.product_id IS NOT NULL AND ppi.product_id = r.product_id)) AS lignes_de_plan
  FROM recipes r
 WHERE r.archived_at IS NULL AND (r.etapes IS NULL OR jsonb_typeof(r.etapes) <> 'array' OR jsonb_array_length(r.etapes) = 0)
 ORDER BY lignes_de_plan DESC, r.name;

\echo ''
\echo '═══ 5. Ingrédients homonymes ═══'
SELECT lower(btrim(i.name)) AS nom, COUNT(*) AS fiches,
       string_agg(i.unit_cost::text || ' / ' || i.unit, '  |  ' ORDER BY i.created_at) AS prix,
       string_agg(i.id::text, ', ' ORDER BY i.created_at) AS identifiants
  FROM ingredients i
 GROUP BY lower(btrim(i.name)) HAVING COUNT(*) > 1
 ORDER BY fiches DESC, nom;

\echo ''
\echo '═══ 6. Prix unitaires aberrants (plus de 5 fois la médiane de la catégorie, ou moins du cinquième) ═══'
WITH med AS (
  SELECT category_id, unit, percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost) AS median, COUNT(*) AS n
    FROM ingredients WHERE unit_cost > 0 AND category_id IS NOT NULL GROUP BY category_id, unit
),
priced AS (
  SELECT i.id, i.name, i.category_id, i.unit, i.unit_cost, m.median, m.n
    FROM ingredients i JOIN med m ON m.category_id = i.category_id AND m.unit = i.unit
   WHERE i.unit_cost > 0
)
SELECT p.name AS ingredient, ec.name AS categorie, p.unit AS unite, p.unit_cost AS prix,
       ROUND(p.median::numeric, 4) AS mediane_categorie, ROUND((p.unit_cost / p.median)::numeric, 2) AS rapport
  FROM priced p LEFT JOIN expense_categories ec ON ec.id = p.category_id
 WHERE p.n >= 5 AND p.median > 0 AND (p.unit_cost > p.median * 5 OR p.unit_cost < p.median / 5)
 ORDER BY GREATEST(p.unit_cost / p.median, p.median / p.unit_cost) DESC;

\echo ''
\echo '═══ 7. Fiches actives jamais produites ═══'
SELECT r.name AS fiche, r.is_base AS base, p.name AS produit, r.created_at::date AS creee_le
  FROM recipes r LEFT JOIN products p ON p.id = r.product_id
 WHERE r.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM production_plan_items ppi
                    WHERE ppi.base_recipe_id = r.id OR (r.product_id IS NOT NULL AND ppi.product_id = r.product_id))
 ORDER BY r.created_at;
