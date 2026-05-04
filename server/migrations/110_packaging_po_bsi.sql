-- Phase Emballages : extension purchase_order_items et BSI lignes
-- pour supporter les emballages en plus des ingrédients.
-- Strictement additif : ingredient_id reste obligatoire pour les anciennes
-- lignes ; on ajoute packaging_id qui est exclusif (l'un OU l'autre).

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS packaging_id uuid REFERENCES packaging_items(id) ON DELETE SET NULL;

-- ingredient_id devient NULLable seulement si packaging_id est rempli (ou inverse).
-- Check pour garantir qu'EXACTEMENT UN des deux est non-null.
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS po_item_kind_check;
ALTER TABLE purchase_order_items ALTER COLUMN ingredient_id DROP NOT NULL;
ALTER TABLE purchase_order_items ADD CONSTRAINT po_item_kind_check
  CHECK (
    (ingredient_id IS NOT NULL AND packaging_id IS NULL)
    OR (ingredient_id IS NULL AND packaging_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_po_items_packaging
  ON purchase_order_items (packaging_id) WHERE packaging_id IS NOT NULL;

-- ─── BSI : extension pour les emballages ───────────────────────────────
ALTER TABLE production_bons_sortie_lignes
  ADD COLUMN IF NOT EXISTS packaging_id uuid REFERENCES packaging_items(id) ON DELETE SET NULL;

ALTER TABLE production_bons_sortie_lignes ALTER COLUMN ingredient_id DROP NOT NULL;
ALTER TABLE production_bons_sortie_lignes DROP CONSTRAINT IF EXISTS bsi_line_kind_check;
ALTER TABLE production_bons_sortie_lignes ADD CONSTRAINT bsi_line_kind_check
  CHECK (
    (ingredient_id IS NOT NULL AND packaging_id IS NULL)
    OR (ingredient_id IS NULL AND packaging_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_bsi_lines_packaging
  ON production_bons_sortie_lignes (packaging_id) WHERE packaging_id IS NOT NULL;
