-- 207: Routage achat consommable vs ingredient
--
-- Jusqu'ici toute matiere achetee (creation a la volee, reception de BC,
-- achat direct) atterrissait dans `ingredients`, meme un consommable
-- (emballage, produit de nettoyage, petit materiel). On cable le routage
-- vers le bon modele de stock selon la CATEGORIE choisie (referentiel
-- expense_categories) :
--   - categorie sous Ingredients (20000000-...-004)            -> ingredients
--   - categorie sous Emballages (20000000-...-005),
--     Entretien (10000000-...-005) ou Equipements (10000000-...-008) -> packaging_items (consommables)
--
-- purchase_order_items.packaging_id existe deja (migration 110). Ici on
-- etend reception_voucher_items et invoice_items pour porter une ligne
-- consommable, et on ajoute une fonction de classification reutilisable.

-- ─── reception_voucher_items : supporter une ligne consommable ──────────
ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS packaging_id uuid REFERENCES packaging_items(id) ON DELETE SET NULL;

ALTER TABLE reception_voucher_items ALTER COLUMN ingredient_id DROP NOT NULL;

ALTER TABLE reception_voucher_items DROP CONSTRAINT IF EXISTS rvi_kind_check;
ALTER TABLE reception_voucher_items ADD CONSTRAINT rvi_kind_check
  CHECK (
    (ingredient_id IS NOT NULL AND packaging_id IS NULL)
    OR (ingredient_id IS NULL AND packaging_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_rvi_packaging
  ON reception_voucher_items (packaging_id) WHERE packaging_id IS NOT NULL;

-- ─── invoice_items : porter une ligne consommable ──────────────────────
-- Pas de check exclusif ici : une ligne de facture peut etre un produit
-- (vente), un ingredient, un consommable, ou du texte libre (charge).
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS packaging_id uuid REFERENCES packaging_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_packaging
  ON invoice_items (packaging_id) WHERE packaging_id IS NOT NULL;

-- ─── Fonction de classification categorie -> 'ingredient' | 'consumable' ─
-- Remonte la chaine des parents et regarde si elle traverse une des branches
-- consommables. Defaut = 'ingredient' (comportement historique sur).
CREATE OR REPLACE FUNCTION fn_purchasable_kind(p_category_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id
      FROM expense_categories
     WHERE id = p_category_id
    UNION ALL
    SELECT ec.id, ec.parent_id
      FROM expense_categories ec
      JOIN chain c ON ec.id = c.parent_id
  )
  SELECT CASE
    WHEN p_category_id IS NULL THEN 'ingredient'
    WHEN EXISTS (
      SELECT 1 FROM chain
       WHERE id IN (
         '20000000-0000-0000-0000-000000000005'::uuid,  -- Emballages
         '10000000-0000-0000-0000-000000000005'::uuid,  -- Entretien & Maintenance
         '10000000-0000-0000-0000-000000000008'::uuid   -- Equipements & Materiel
       )
    ) THEN 'consumable'
    ELSE 'ingredient'
  END;
$$;
