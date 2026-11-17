-- M2-08 (plan d'action 2026-11) — lien ligne de commande client ↔ ligne d'ordre.
--
-- Jusqu'ici le lien n'existait qu'au niveau de l'en-tête (production_plans.order_id,
-- order_items.production_plan_id) : impossible de dire quelle ligne d'ordre sert quelle
-- ligne de commande quand un ordre porte plusieurs produits ou plusieurs commandes.
--
--   production_plan_items.order_item_id : la ligne de commande servie (NULL = production
--   pour le stock). Posée par le sourcing d'une commande (sourcing.helper.ts).
--   Rattrapage : une ligne de commande déjà liée à un ordre est rattachée à la ligne de
--   cet ordre qui porte le même produit, seulement si elle est unique (aucun rattachement
--   ambigu).
--
-- Base de la date promise (G5).
--
-- INVERSION : ALTER TABLE production_plan_items DROP COLUMN order_item_id;
ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_production_plan_items_order_item ON production_plan_items (order_item_id) WHERE order_item_id IS NOT NULL;

WITH m AS (
  SELECT oi.id AS order_item_id, MIN(ppi.id::text)::uuid AS plan_item_id
    FROM order_items oi
    JOIN production_plan_items ppi ON ppi.plan_id = oi.production_plan_id AND ppi.product_id = oi.product_id
   WHERE oi.production_plan_id IS NOT NULL
   GROUP BY oi.id
  HAVING COUNT(*) = 1
), uniq AS (
  SELECT * FROM m WHERE plan_item_id IN (SELECT plan_item_id FROM m GROUP BY plan_item_id HAVING COUNT(*) = 1)
)
UPDATE production_plan_items ppi SET order_item_id = uniq.order_item_id
  FROM uniq WHERE uniq.plan_item_id = ppi.id AND ppi.order_item_id IS NULL;
