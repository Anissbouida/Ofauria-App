-- Chaîne de rappel (recall) — maillon aval manquant : lien vente ↔ lot produit.
--
-- La traçabilité amont est déjà complète (lot matière → production_lot_usage →
-- plans → product_lots). En aval, la vente ne gardait que product_lots.sold_qty
-- (agrégé) : on ne savait pas QUEL lot produit avait servi QUELLE ligne de vente,
-- donc impossible de remonter d'un lot de matière première jusqu'aux clients.
--
-- Cette table matérialise l'allocation FEFO déjà calculée par createSale : pour
-- chaque sale_item, un ou plusieurs product_lots consommés, avec la quantité
-- prélevée sur chacun. C'est le dernier maillon de la traçabilité descendante
-- (exigence HACCP / ONSSA pour un rappel de lot).
CREATE TABLE IF NOT EXISTS sale_item_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_item_id uuid NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_lot_id uuid NOT NULL REFERENCES product_lots(id) ON DELETE CASCADE,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_item_lots_sale_item ON sale_item_lots(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_lots_product_lot ON sale_item_lots(product_lot_id);
