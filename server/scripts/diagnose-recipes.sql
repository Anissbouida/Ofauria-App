-- Diagnostic recettes / production composée — LECTURE SEULE (aucun INSERT/UPDATE/DELETE)
-- Prépare la migration "produit composé à nomenclature par format".
-- Lancer : psql "$DATABASE_URL" -f server/scripts/diagnose-recipes.sql
\pset pager off
\pset footer off

\echo '============================================================'
\echo ' 0. VUE D ENSEMBLE'
\echo '============================================================'
SELECT
  (SELECT count(*) FROM recipes)                                   AS recettes_total,
  (SELECT count(*) FROM recipes WHERE is_base)                     AS recettes_base,
  (SELECT count(*) FROM recipes WHERE product_id IS NOT NULL)      AS liees_produit,
  (SELECT count(*) FROM recipe_sub_recipes)                        AS liens_composants,
  (SELECT count(*) FROM recipe_formats WHERE is_active)            AS formats_actifs,
  (SELECT count(*) FROM recipes WHERE contenant_id IS NOT NULL)    AS legacy_contenant;

\echo ''
\echo '============================================================'
\echo ' 1. RENDEMENTS SUSPECTS (placeholder a corriger avant migration)'
\echo '    Une recette de base ne devrait pas rendre en "unit".'
\echo '============================================================'
SELECT r.name,
       r.yield_quantity AS qte,
       r.yield_unit     AS unite,
       r.is_base,
       (SELECT count(*) FROM recipe_ingredients i WHERE i.recipe_id = r.id) AS nb_ingr,
       (SELECT count(*) FROM recipe_sub_recipes s WHERE s.sub_recipe_id = r.id) AS utilisee_dans
FROM recipes r
WHERE (r.is_base AND r.yield_unit = 'unit')
   OR (r.yield_quantity = 22 AND r.yield_unit = 'unit')
ORDER BY utilisee_dans DESC, r.name;

\echo ''
\echo '============================================================'
\echo ' 2. RECETTES DE BASE SANS INGREDIENT (cout = 0, donc cout produit faux)'
\echo '============================================================'
SELECT r.name, r.yield_quantity, r.yield_unit
FROM recipes r
WHERE r.is_base
  AND NOT EXISTS (SELECT 1 FROM recipe_ingredients i WHERE i.recipe_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM recipe_sub_recipes s WHERE s.recipe_id = r.id)
ORDER BY r.name;

\echo ''
\echo '============================================================'
\echo ' 3. DOUBLONS PROBABLES — familles de bases (pate / creme / ganache / nappage)'
\echo '    A fusionner : memes composants nommes differemment.'
\echo '============================================================'
SELECT r.name,
       r.yield_quantity AS qte,
       r.yield_unit     AS unite,
       (SELECT count(*) FROM recipe_sub_recipes s WHERE s.sub_recipe_id = r.id) AS usages
FROM recipes r
WHERE r.is_base
  AND r.name ~* '(p[âa]te sucr|p[âa]te sabl|p[âa]te bris|cr[èe]me p[âa]tiss|cr[èe]me amand|ganache|nappage|streusel)'
ORDER BY lower(regexp_replace(r.name, '[^a-zA-Z]', '', 'g')), r.name;

\echo ''
\echo '============================================================'
\echo ' 4. RECETTES BASE INUTILISEES (candidates archivage)'
\echo '============================================================'
SELECT r.name, r.yield_quantity, r.yield_unit
FROM recipes r
WHERE r.is_base
  AND NOT EXISTS (SELECT 1 FROM recipe_sub_recipes s WHERE s.sub_recipe_id = r.id)
ORDER BY r.name;

\echo ''
\echo '============================================================'
\echo ' 5. PRODUITS ASSEMBLES — PRETS A REPRENDRE EN COMPOSANTS (migration 191)'
\echo '    Chaque ligne = un futur recipe_format_components du format par defaut.'
\echo '    Drapeau "unite_a_verifier" = la qte du composant est en "unit" (ambigue).'
\echo '============================================================'
SELECT parent.name                          AS produit,
       child.name                           AS composant,
       s.quantity                           AS qte_liee,
       child.yield_unit                     AS unite_composant,
       CASE WHEN child.yield_unit = 'unit' THEN '⚠ a verifier' ELSE 'ok' END AS unite_a_verifier
FROM recipes parent
JOIN recipe_sub_recipes s ON s.recipe_id = parent.id
JOIN recipes child        ON child.id = s.sub_recipe_id
WHERE parent.product_id IS NOT NULL
ORDER BY parent.name, s.quantity DESC;

\echo ''
\echo '============================================================'
\echo ' 6. SYNTHESE REPRISE — nb composants par produit assemble'
\echo '============================================================'
SELECT parent.name AS produit,
       count(*)    AS nb_composants
FROM recipes parent
JOIN recipe_sub_recipes s ON s.recipe_id = parent.id
WHERE parent.product_id IS NOT NULL
GROUP BY parent.name
ORDER BY nb_composants DESC, parent.name;

\echo ''
\echo '============================================================'
\echo ' 7. LEGACY contenant_id (a migrer vers recipe_formats.is_default)'
\echo '============================================================'
SELECT r.name, r.is_base, pc.nom AS contenant_legacy,
       (SELECT count(*) FROM recipe_formats f WHERE f.recipe_id = r.id AND f.is_active) AS nb_formats_actifs
FROM recipes r
LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
WHERE r.contenant_id IS NOT NULL
ORDER BY r.name;
