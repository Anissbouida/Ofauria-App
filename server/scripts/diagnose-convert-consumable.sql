-- Diagnostic « Convertir en consommable » : invalid input syntax for type integer: "35.2"
-- LECTURE SEULE. Lancer CONTRE LA PROD :
--
--   psql "$DATABASE_URL" -f server/scripts/diagnose-convert-consumable.sql
--
-- Contexte : le code de convertToConsumable (main) et les migrations actuelles
-- n'ecrivent QUE des colonnes numeric. La sequence complete a ete rejouee en
-- local avec qty=35.2 -> aucune erreur. Donc la prod porte un objet DB que le
-- schema courant ne produit pas (colonne integer heritee d'un ancien schema,
-- ou trigger/fonction obsolete qui caste la somme des lots en integer).
-- 35.2 = SUM(economat_quantity + pesage_quantity) des lots actifs.

\echo '=================================================================='
\echo ' 1) Colonnes integer/smallint dans les tables du chemin de conversion'
\echo '    (devraient TOUTES etre numeric ; toute ligne ici = la cause)'
\echo '=================================================================='
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('integer','smallint','bigint')
  AND table_name IN (
    'packaging_items','packaging_store_stock','packaging_stock_transactions',
    'inventory','inventory_transactions','ingredient_lots'
  )
ORDER BY table_name, column_name;

\echo ''
\echo '=================================================================='
\echo ' 2) Type exact des colonnes de quantite ecrites par la conversion'
\echo '=================================================================='
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('packaging_store_stock','stock_quantity'),
    ('packaging_stock_transactions','quantity_change'),
    ('packaging_stock_transactions','stock_after'),
    ('inventory','current_quantity'),
    ('ingredient_lots','economat_quantity'),
    ('ingredient_lots','pesage_quantity')
  )
ORDER BY table_name, column_name;

\echo ''
\echo '=================================================================='
\echo ' 3) Tous les triggers sur les tables touchees par la conversion'
\echo '    (cherche un trigger en trop / obsolete absent des migrations)'
\echo '=================================================================='
SELECT event_object_table AS tbl, trigger_name, action_timing, event_manipulation AS evt, action_statement
FROM information_schema.triggers
WHERE event_object_table IN (
    'ingredient_lots','inventory','packaging_items',
    'packaging_store_stock','packaging_stock_transactions'
  )
ORDER BY tbl, trigger_name, evt;

\echo ''
\echo '=================================================================='
\echo ' 4) Fonctions dont le corps caste une quantite/somme de lots en integer'
\echo '    (smoking gun : un ::int sur economat+pesage ou current_quantity)'
\echo '=================================================================='
SELECT p.oid::regprocedure AS fonction
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ILIKE '%economat_quantity%'
  AND pg_get_functiondef(p.oid) ~* '::int';

\echo ''
\echo '   -> Pour voir le corps d''une fonction suspecte :'
\echo '      SELECT pg_get_functiondef(''nom_fonction()''::regprocedure);'
