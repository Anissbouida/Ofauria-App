-- Contrôle post-migration (plan pilote, étape 4) — LECTURE SEULE, rejouable à volonté.
-- À lancer après l'application des migrations sur staging puis en production :
--   psql "$DATABASE_URL" -f server/scripts/post-migration-check.sql
-- Une ligne par contrôle : statut OK / ALERTE, et le détail des écarts. Aucune écriture.
-- Couvre les migrations 519 à 595 (plan d'action et plan pilote 2026-11).

WITH
expected AS (SELECT generate_series(519, 595) AS n),
applied AS (SELECT (regexp_match(name, '^(\d+)_'))[1]::int AS n FROM _migrations),
missing_mig AS (SELECT string_agg(e.n::text, ', ' ORDER BY e.n) AS d, count(*) AS c FROM expected e WHERE NOT EXISTS (SELECT 1 FROM applied a WHERE a.n = e.n)),
dup_mig AS (SELECT string_agg(name, ', ') AS d, count(*) AS c FROM (SELECT name FROM _migrations GROUP BY name HAVING count(*) > 1) x),
-- Exception connue : chk_ingredients_allergens est posée NOT VALID par la mig 344 (allergènes historiques
-- non reconnus conservés) ; à valider après le nettoyage des allergènes (G2-06). Signalée à part.
not_valid AS (SELECT string_agg(conrelid::regclass || '.' || conname, ', ') AS d, count(*) AS c FROM pg_constraint
               WHERE NOT convalidated AND conname <> 'chk_ingredients_allergens'),
known_not_valid AS (SELECT count(*) AS c FROM pg_constraint WHERE NOT convalidated AND conname = 'chk_ingredients_allergens'),
trg_off AS (SELECT string_agg(tgrelid::regclass || '.' || tgname, ', ') AS d, count(*) AS c FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'),
idx_bad AS (SELECT string_agg(indexrelid::regclass::text, ', ') AS d, count(*) AS c FROM pg_index WHERE NOT indisvalid OR NOT indisready),
fn_expected(f) AS (VALUES
  ('fn_base_currency'), ('fn_bom_snapshot_apply'), ('fn_recipe_bom_snapshot'), ('fn_recipe_routing'), ('fn_routing_snapshot'),
  ('fn_routing_content'), ('trg_fn_bom_version_frozen'), ('fn_stock_at'), ('fn_convert_qty'), ('fn_convert_factor'),
  ('fn_unit_conv_strict'), ('fn_work_center_capacity'), ('fn_routing_op_minutes')),
fn_missing AS (SELECT string_agg(f, ', ') AS d, count(*) AS c FROM fn_expected WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = f)),
tbl_expected(t) AS (VALUES
  ('policy_values'), ('production_order_types'), ('bom_versions'), ('recipe_line_substitutes'), ('routings'), ('work_center_calendar'),
  ('work_center_closures'), ('product_serials'), ('audit_trail'), ('production_screen_hidden'), ('stock_anomalies'),
  ('item_unit_conversions'), ('ingredient_lot_locations'), ('recipe_bulk_replace_log'), ('currencies')),
tbl_missing AS (SELECT string_agg(t, ', ') AS d, count(*) AS c FROM (
  SELECT t FROM tbl_expected WHERE to_regclass('public.' || t) IS NULL
  -- Référentiel des motifs de rebut : table logique de ref_entries (mig 571), pas une table physique.
  UNION ALL SELECT 'ref_tables.scrap_reasons' WHERE NOT EXISTS (SELECT 1 FROM ref_tables WHERE id = 'scrap_reasons')) m),
recipe_no_version AS (
  SELECT string_agg(left(r.name, 40), ', ') AS d, count(*) AS c FROM recipes r
   WHERE r.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM bom_versions b WHERE b.recipe_id = r.id AND b.status = 'active')),
plan_no_type AS (SELECT count(*) AS c, NULL::text AS d FROM production_plans WHERE order_type_id IS NULL),
unbalanced AS (
  SELECT count(*) AS c, string_agg(id::text, ', ') FILTER (WHERE rn <= 10) AS d FROM (
    SELECT e.id, row_number() OVER () AS rn FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id
     GROUP BY e.id HAVING round(sum(COALESCE(l.debit, 0)) - sum(COALESCE(l.credit, 0)), 2) <> 0) x),
neg_stock AS (SELECT count(*) AS c, NULL::text AS d FROM inventory WHERE current_quantity < 0),
base_currency AS (SELECT count(*) AS c, string_agg(code, ', ') AS d FROM currencies WHERE is_base)
SELECT controle, CASE WHEN ok THEN 'OK' ELSE 'ALERTE' END AS statut, detail FROM (
  SELECT 1 AS o, 'Migrations 519 à 595 appliquées' AS controle, (SELECT c = 0 FROM missing_mig) AS ok, (SELECT COALESCE('manquantes : ' || d, '77 / 77') FROM missing_mig) AS detail
  UNION ALL SELECT 2, 'Aucune migration enregistrée deux fois', (SELECT c = 0 FROM dup_mig), (SELECT d FROM dup_mig)
  UNION ALL SELECT 3, 'Contraintes toutes validées (pas de NOT VALID)', (SELECT c = 0 FROM not_valid), (SELECT d FROM not_valid)
  UNION ALL SELECT 3.5, 'Info : allergènes non contraints sur l''historique (mig 344, attendu jusqu''à G2-06)', true, (SELECT CASE WHEN c > 0 THEN 'chk_ingredients_allergens NOT VALID — à valider après nettoyage' ELSE 'validée' END FROM known_not_valid)
  UNION ALL SELECT 4, 'Aucun déclencheur métier désactivé', (SELECT c = 0 FROM trg_off), (SELECT d FROM trg_off)
  UNION ALL SELECT 5, 'Index tous valides', (SELECT c = 0 FROM idx_bad), (SELECT d FROM idx_bad)
  UNION ALL SELECT 6, 'Fonctions clés présentes', (SELECT c = 0 FROM fn_missing), (SELECT COALESCE('manquantes : ' || d, NULL) FROM fn_missing)
  UNION ALL SELECT 7, 'Tables clés présentes', (SELECT c = 0 FROM tbl_missing), (SELECT COALESCE('manquantes : ' || d, NULL) FROM tbl_missing)
  UNION ALL SELECT 8, 'Une seule devise de base', (SELECT c = 1 FROM base_currency), (SELECT d FROM base_currency)
  UNION ALL SELECT 9, 'Chaque fiche active a une version de nomenclature active (mig 559)', (SELECT c = 0 FROM recipe_no_version), (SELECT d FROM recipe_no_version)
  UNION ALL SELECT 10, 'Chaque ordre de fabrication a un type (mig 546)', (SELECT c = 0 FROM plan_no_type), (SELECT c::text || ' ordre(s) sans type' FROM plan_no_type)
  UNION ALL SELECT 11, 'Écritures comptables équilibrées', (SELECT c = 0 FROM unbalanced), (SELECT CASE WHEN c > 0 THEN c || ' écriture(s), dont : ' || d END FROM unbalanced)
  UNION ALL SELECT 12, 'Aucun stock matière négatif', (SELECT c = 0 FROM neg_stock), (SELECT c::text || ' ligne(s) négative(s)' FROM neg_stock)
) x ORDER BY o;
