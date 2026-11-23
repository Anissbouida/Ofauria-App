-- Mesures préalables du chantier « production multi-industries » (plan d'exécution, étape 0).
--
-- LECTURE SEULE : aucune écriture. À passer sur la PRODUCTION avant les étapes 2 bis (fiche
-- technique) et 1 (pesée et contrôle obligatoires), puis à reporter au § F du plan.
--
--   psql "$DATABASE_URL" -f server/scripts/diagnose-multi-industries.sql
--
-- 1. Tables de l'ancien modèle de fiche : si elles sont vides, le pas 2b-1 peut les retirer
--    des vues de coût et d'allergènes (après un cycle d'observation).
-- 2. Remplissage des champs propres à la boulangerie : ce qui deviendrait des facettes.
-- 3. Drapeaux des types d'ordre jamais appliqués jusqu'ici (pesée, contrôle obligatoires).
-- 4. Usage des rôles de chef et des ateliers.

\echo '== 1. Ancien modèle de fiche (lignes, fiches concernées)'
SELECT 'recipe_ingredients' AS table_name, COUNT(*) AS lignes, COUNT(DISTINCT recipe_id) AS fiches FROM recipe_ingredients
UNION ALL SELECT 'recipe_sub_recipes', COUNT(*), COUNT(DISTINCT recipe_id) FROM recipe_sub_recipes
UNION ALL SELECT 'recipe_packaging', COUNT(*), COUNT(DISTINCT recipe_id) FROM recipe_packaging
UNION ALL SELECT 'produit_profil_production', COUNT(*), COUNT(DISTINCT produit_id) FROM produit_profil_production
UNION ALL SELECT 'recipe_components', COUNT(*), COUNT(DISTINCT recipe_id) FROM recipe_components
UNION ALL SELECT 'recipe_format_components', COUNT(*), COUNT(DISTINCT format_id) FROM recipe_format_components
UNION ALL SELECT 'recipe_versions', COUNT(*), COUNT(DISTINCT recipe_id) FROM recipe_versions
UNION ALL SELECT 'bom_versions', COUNT(*), COUNT(DISTINCT recipe_id) FROM bom_versions;

\echo '== 2. Champs boulangerie renseignés (fiches actives)'
SELECT COUNT(*) AS fiches_actives,
       COUNT(*) FILTER (WHERE mode_cout = 'compose') AS mode_compose,
       COUNT(pieces_par_fournee) AS pieces_par_fournee,
       COUNT(hydratation_pct) AS hydratation,
       COUNT(temperature_pate_cible_c) AS temperature_pate,
       COUNT(*) FILTER (WHERE jsonb_typeof(etapes) = 'array' AND jsonb_array_length(etapes) > 0) AS avec_etapes,
       COUNT(contenant_id) AS avec_contenant
  FROM recipes WHERE archived_at IS NULL;

SELECT COUNT(*) AS formats, COUNT(contenant_id) AS avec_contenant,
       COUNT(poids_cru_g) AS poids_cru, COUNT(poids_cuit_g) AS poids_cuit,
       COUNT(NULLIF(cout_emballage_unitaire, 0)) AS cout_emballage_saisi
  FROM recipe_formats;

SELECT COALESCE(role, '(vide)') AS role_ligne, COUNT(*) FROM recipe_format_components GROUP BY 1 ORDER BY 2 DESC;

SELECT COUNT(*) AS articles, COUNT(shelf_life_days) AS avec_duree,
       MAX(shelf_life_days) AS duree_max_jours,
       COUNT(legal_name) AS denomination_legale, COUNT(storage_conditions) AS conservation
  FROM products;

\echo '== 3. Types d ordre : drapeaux déclarés'
SELECT code, label, is_default, requires_bon_sortie, requires_weighing, requires_quality_check,
       consumption_mode, is_subcontracting,
       (SELECT COUNT(*) FROM production_plans p WHERE p.order_type_id = t.id) AS ordres
  FROM production_order_types t ORDER BY code;

\echo '== 4. Rôles de chef et ateliers'
SELECT role, COUNT(*) AS utilisateurs FROM users WHERE is_active GROUP BY role ORDER BY 2 DESC;
SELECT code, label, is_active FROM production_workshops ORDER BY code;
SELECT sector_pack FROM company_settings;
