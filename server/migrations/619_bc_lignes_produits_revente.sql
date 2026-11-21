-- 619 — Lignes de BC « produit de revente » (scénario 1, constat 102).
--
-- POURQUOI
--   Un produit de revente (item_kind = 'resale' : eau, sodas, marchandises) se vend
--   mais n'avait aucun chemin d'entrée en stock par achat : une ligne de BC ne portait
--   qu'un ingrédient, un consommable, un service ou une immobilisation.
--
-- CE QUI CHANGE
--   - purchase_order_items.product_id + line_type 'product' (contrainte po_item_kind_check) ;
--     la ligne garde la désignation du produit (description) et une catégorie de dépense,
--     comme une ligne service : la facture, l'écriture de réception (GR/IR) et le
--     rapprochement reprennent tels quels COALESCE(..., poi.description) et poi.category_id.
--   - reception_voucher_items.product_id ; la réception d'une ligne produit crée un lot
--     produit en réserve (product_lots.backroom_qty) et augmente le stock réserve du
--     magasin (product_store_stock.stock_quantity) ; la vitrine se garnit ensuite par
--     l'approvisionnement vitrine, comme pour un produit fabriqué.
--   - product_lots.reception_voucher_item_id : traçabilité du lot acheté.
--   - Plan comptable : 3111 Marchandises, 6111 Achats de marchandises ; catégorie de
--     dépense racine « Achats de marchandises » (6111), proposée par défaut sur ces lignes.
--
-- INVERSION
--   Supprimer les lignes line_type = 'product' (et leurs réceptions), restaurer
--   po_item_kind_check et rvi_kind_check de la mig 349, DROP COLUMN
--   purchase_order_items.product_id, reception_voucher_items.product_id,
--   product_lots.reception_voucher_item_id ; désactiver la catégorie et les comptes.

-- ─── 1. Plan comptable : marchandises ──────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active)
SELECT '3111', 'Marchandises', 3, '31', '311', 'asset', 'D', false, true
 WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '3111');
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active)
SELECT '6111', 'Achats de marchandises', 6, '61', '611', 'expense', 'D', false, true
 WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '6111');

-- ─── 2. Catégorie de dépense « Achats de marchandises » ────────────────────
INSERT INTO expense_categories (id, name, type, description, requires_po, parent_id, level, display_order, is_active, account_id)
SELECT '10000000-0000-0000-0000-000000000011', 'Achats de marchandises', 'expense',
       'Produits achetés pour être revendus en l''état (boissons, articles de négoce).',
       true, NULL, 1, 9, true, (SELECT id FROM accounts WHERE code = '6111')
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE id = '10000000-0000-0000-0000-000000000011');

-- ─── 3. Ligne de BC « produit » ────────────────────────────────────────────
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
CREATE INDEX IF NOT EXISTS ix_poi_product ON purchase_order_items (product_id) WHERE product_id IS NOT NULL;

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS po_item_kind_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT po_item_kind_check CHECK (
  (line_type = 'ingredient' AND ingredient_id IS NOT NULL AND packaging_id IS NULL AND product_id IS NULL)
  OR (line_type = 'consumable' AND packaging_id IS NOT NULL AND ingredient_id IS NULL AND product_id IS NULL)
  OR (line_type = 'product' AND product_id IS NOT NULL AND ingredient_id IS NULL AND packaging_id IS NULL)
  OR (line_type IN ('service', 'asset') AND ingredient_id IS NULL AND packaging_id IS NULL AND product_id IS NULL
      AND COALESCE(btrim(description), '') <> '' AND category_id IS NOT NULL)
);

COMMENT ON COLUMN purchase_order_items.line_type IS
  'ingredient | consumable | product | service | asset. product : produit de revente (mig 619). service/asset : description + category_id obligatoires (mig 349).';

-- ─── 4. Ligne de réception « produit » ─────────────────────────────────────
ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);

ALTER TABLE reception_voucher_items DROP CONSTRAINT IF EXISTS rvi_kind_check;
ALTER TABLE reception_voucher_items ADD CONSTRAINT rvi_kind_check CHECK (
  (CASE WHEN ingredient_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN packaging_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  AND (ingredient_id IS NOT NULL OR packaging_id IS NOT NULL OR product_id IS NOT NULL OR purchase_order_item_id IS NOT NULL)
);

-- ─── 5. Lot produit acheté : lien vers sa réception ────────────────────────
ALTER TABLE product_lots
  ADD COLUMN IF NOT EXISTS reception_voucher_item_id uuid REFERENCES reception_voucher_items(id);
CREATE INDEX IF NOT EXISTS ix_product_lots_rvi ON product_lots (reception_voucher_item_id) WHERE reception_voucher_item_id IS NOT NULL;
