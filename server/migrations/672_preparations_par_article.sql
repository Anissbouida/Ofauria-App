-- ═══════════════════════════════════════════════════════════════════════
-- 672 — Préparations de base consommées : rattachées à l'article de l'ordre
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Suite de la mig 663 : les matières sont rattachées à l'article, pas encore les
--   préparations de base (crème pâtissière, pâte feuilletée…). Un lot de crème réservé ou
--   produit pour un plan était porté par le plan entier : son coût était réparti par clé et
--   un rappel du lot touchait tous les articles du plan.
--
-- QUOI
--   semi_finished_lot_usage.parent_plan_item_id : article du plan parent servi par ce lot.
--   production_plan_dependencies.item_shares    : besoin de chaque article en cette
--     préparation ({ "<ligne>": quantité }), posé à la détection ; il partage la réservation
--     sur stock et la part du plan fils imputée au parent.
--
-- REPRISE
--   Plans parents à un seul article actif : leurs consommations lui sont rattachées (exact).
--
-- INVERSION
--   ALTER TABLE semi_finished_lot_usage DROP COLUMN parent_plan_item_id ;
--   ALTER TABLE production_plan_dependencies DROP COLUMN item_shares.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE semi_finished_lot_usage
  ADD COLUMN IF NOT EXISTS parent_plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL;
ALTER TABLE production_plan_dependencies
  ADD COLUMN IF NOT EXISTS item_shares jsonb;

CREATE INDEX IF NOT EXISTS idx_sflu_parent_item ON semi_finished_lot_usage(parent_plan_item_id) WHERE parent_plan_item_id IS NOT NULL;

COMMENT ON COLUMN semi_finished_lot_usage.parent_plan_item_id IS 'Article du plan parent servi par ce lot de préparation (mig 672)';
COMMENT ON COLUMN production_plan_dependencies.item_shares IS 'Besoin de chaque article du plan parent en cette préparation : {ligne: quantité} (mig 672)';

WITH single AS (
  SELECT plan_id, (array_agg(id))[1] AS item_id
    FROM production_plan_items WHERE status <> 'cancelled'
   GROUP BY plan_id HAVING count(*) = 1
)
UPDATE semi_finished_lot_usage u SET parent_plan_item_id = s.item_id
  FROM single s WHERE s.plan_id = u.parent_plan_id AND u.parent_plan_item_id IS NULL;
