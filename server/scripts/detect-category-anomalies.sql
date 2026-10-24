-- Diagnostic : anomalies de categorisation des articles et des lignes de charges
--
-- A executer en lecture seule (aucun UPDATE ici) apres la migration 255, pour
-- identifier les donnees a corriger manuellement dans le referentiel
-- (Economat / Consommables). Chaque section est independante.
--
-- Usage : psql "$DATABASE_URL" -f server/scripts/detect-category-anomalies.sql

-- Chemin complet "Racine > Sous-categorie > Feuille" pour chaque categorie.
WITH RECURSIVE cat_path AS (
  SELECT id, name, parent_id, name::text AS path, ref_table_id
  FROM expense_categories
  WHERE parent_id IS NULL
  UNION ALL
  SELECT ec.id, ec.name, ec.parent_id, cp.path || ' > ' || ec.name, ec.ref_table_id
  FROM expense_categories ec
  JOIN cat_path cp ON cp.id = ec.parent_id
)
SELECT * INTO TEMP tmp_cat_path FROM cat_path;

-- ─── 1. Ingredients sans categorie resolue ──────────────────────────────────
-- category_id NULL = la ligne de charge retombera sur la categorie facture.
SELECT 'ingredient_sans_categorie' AS anomalie, ing.id, ing.name,
       ing.category AS code_legacy
FROM ingredients ing
WHERE ing.category_id IS NULL
ORDER BY ing.name;

-- ─── 2. Consommables sans categorie resolue ─────────────────────────────────
-- (caissettes / supports / petit_materiel / autre laisses NULL par la mig 196)
SELECT 'consommable_sans_categorie' AS anomalie, pkg.id, pkg.name,
       pkg.category AS enum_legacy
FROM packaging_items pkg
WHERE pkg.is_active = true
  AND pkg.category_id IS NULL
ORDER BY pkg.name;

-- ─── 3. Incoherences de branche ─────────────────────────────────────────────
-- Un INGREDIENT pointant vers une feuille "emballage" (ou l'inverse) est
-- suspect : c'est le cas "Seau de plastique -> Cremes" vu dans les charges.
SELECT 'ingredient_sur_feuille_emballage' AS anomalie, ing.id, ing.name,
       cp.path AS categorie
FROM ingredients ing
JOIN tmp_cat_path cp ON cp.id = ing.category_id
WHERE cp.ref_table_id = 'packaging_categories'
ORDER BY ing.name;

SELECT 'consommable_sur_feuille_ingredient' AS anomalie, pkg.id, pkg.name,
       cp.path AS categorie
FROM packaging_items pkg
JOIN tmp_cat_path cp ON cp.id = pkg.category_id
WHERE pkg.is_active = true
  AND cp.ref_table_id = 'ingredient_categories'
ORDER BY pkg.name;

-- ─── 4. Lignes de charges toujours sans categorie effective ─────────────────
-- Apres backfill 255 : lignes dont ni la ligne, ni l'article, ni la facture
-- n'ont de categorie -> s'afficheront "Sans categorie" dans Charges & Depenses.
SELECT 'ligne_facture_sans_categorie' AS anomalie,
       inv.invoice_number, ii.description, ii.subtotal
FROM invoice_items ii
JOIN invoices inv ON inv.id = ii.invoice_id
LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
WHERE inv.invoice_type = 'received' AND inv.status != 'cancelled'
  AND COALESCE(ii.category_id, ing.category_id, pkg.category_id, inv.category_id) IS NULL
ORDER BY inv.invoice_number;

-- ─── 5. Revue manuelle : articles achetes recemment et leur chemin complet ──
-- Liste les articles apparus dans des factures BC des 90 derniers jours avec
-- le chemin de categorie qui sera affiche : reperer visuellement les
-- aberrations ("Lumiere vitrines" en Matieres premieres, etc.).
SELECT DISTINCT
       COALESCE(ing.name, pkg.name, ii.description) AS article,
       CASE WHEN ing.id IS NOT NULL THEN 'ingredient' ELSE 'consommable' END AS type_article,
       cp.path AS categorie_affichee
FROM invoice_items ii
JOIN invoices inv ON inv.id = ii.invoice_id
LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
LEFT JOIN tmp_cat_path cp
       ON cp.id = COALESCE(ii.category_id, ing.category_id, pkg.category_id, inv.category_id)
WHERE inv.invoice_type = 'received' AND inv.status != 'cancelled'
  AND inv.purchase_order_id IS NOT NULL
  AND inv.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY categorie_affichee NULLS FIRST, article;

DROP TABLE IF EXISTS tmp_cat_path;
