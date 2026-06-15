-- Migration 156 : backfill invoices.category_id pour les factures auto-creees
-- depuis un bon de commande qui sont restees sans categorie.
--
-- Avant : reception-voucher.repository.ts:auto-create d'invoice n'incluait
--         pas category_id → toutes les factures auto-generees depuis BC ont
--         category_id = NULL, ce qui les fait tomber dans la categorie
--         "__none__" cote Charges & Depenses (cascade filtre vide).
--
-- Apres : on derive la categorie depuis les ingredients du BC. Meme logique
--         que resolveInvoiceCategoryFromPo() cote code (cf. fichier
--         reception-voucher.repository.ts) :
--           - 1 seul leaf code partage    -> ce leaf (ex: "Farines")
--           - 1 seul parent niveau 2     -> ce parent (ex: "Ingredients")
--           - mixte / aucun match        -> racine "Matieres premieres"

WITH cats_per_po AS (
  SELECT
    poi.purchase_order_id,
    ec.id::text         AS leaf_id,
    ec.parent_id::text  AS parent_id
  FROM purchase_order_items poi
  JOIN ingredients ing ON ing.id = poi.ingredient_id
  JOIN expense_categories ec
    ON ec.code = ing.category
   AND ec.parent_id IN (
     '20000000-0000-0000-0000-000000000004',  -- Matieres premieres > Ingredients
     '20000000-0000-0000-0000-000000000005'   -- Matieres premieres > Emballages
   )
  GROUP BY poi.purchase_order_id, ec.id, ec.parent_id
),
resolved AS (
  SELECT
    purchase_order_id,
    CASE
      WHEN COUNT(DISTINCT leaf_id) = 1 THEN MAX(leaf_id)
      WHEN COUNT(DISTINCT parent_id) = 1 THEN MAX(parent_id)
      ELSE '10000000-0000-0000-0000-000000000003'  -- racine Matieres premieres
    END AS category_id
  FROM cats_per_po
  GROUP BY purchase_order_id
)
UPDATE invoices inv
SET    category_id = r.category_id::uuid
FROM   resolved r
WHERE  inv.purchase_order_id = r.purchase_order_id
  AND  inv.category_id IS NULL
  AND  inv.invoice_type = 'received';

-- Pour les factures auto-creees depuis BC ou aucun ingredient ne matche
-- (categorie vide ou code non mappe), forcer au moins la racine.
UPDATE invoices
SET    category_id = '10000000-0000-0000-0000-000000000003'
WHERE  category_id IS NULL
  AND  invoice_type = 'received'
  AND  purchase_order_id IS NOT NULL;
