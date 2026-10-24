-- Migration 301 : pertes de production rattachées à l'article du plan
--
-- POURQUOI
--   Une perte « production » était un simple compteur par produit : pas de lien
--   avec l'article du plan ni avec le lot produit, aucun plafond (on pouvait
--   déclarer 40 pertes sur 25 pièces produites), et le stock produit n'était
--   jamais retiré alors que la production avait déjà alimenté la réserve.
--
-- QUOI
--   product_losses.plan_item_id : l'article du plan concerné. Le serveur en
--   déduit le lot produit (product_lots.plan_item_id, mig 300), plafonne la
--   quantité à « produit − déjà déclaré » et retire la perte de la réserve et
--   du lot quand la production a déjà été enregistrée.

ALTER TABLE product_losses
  ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_losses_plan ON product_losses (production_plan_id) WHERE production_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_losses_plan_item ON product_losses (plan_item_id) WHERE plan_item_id IS NOT NULL;
