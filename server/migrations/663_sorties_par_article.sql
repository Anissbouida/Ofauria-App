-- ═══════════════════════════════════════════════════════════════════════
-- 663 — Sorties de matière rattachées à l'article de l'ordre
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Un plan de production regroupe plusieurs articles. Besoins, sorties de matière, lots
--   consommés et manques de stock étaient rattachés au PLAN : le coût réel de chaque article
--   était une répartition par clé, et un rappel de lot touchait tous les articles du plan,
--   même ceux qui n'avaient pas utilisé la matière. Les grands ERP font un ordre par article ;
--   ici le plan reste la vue de regroupement de la journée, chaque ligne porte ses mouvements.
--
-- QUOI (colonnes nullables : rien n'est obligatoire, l'existant reste lisible)
--   production_ingredient_needs.plan_item_id : besoin calculé par ligne (plus par produit).
--   production_lot_usage.plan_item_id        : lot de matière consommé par cette ligne.
--   inventory_transactions.plan_item_id      : sortie de stock faite pour cette ligne.
--   stock_anomalies.origin_line_id           : ligne du document d'origine (ici la ligne de
--                                              plan) quand le manque lui est propre.
--
-- REPRISE (sans création de ligne, sans modification de quantité)
--   Plans à un seul article actif : leurs besoins, lots, sorties et manques lui sont
--   rattachés — c'est exact. Plans à plusieurs articles : laissés sans rattachement (le coût
--   continue de les répartir par les besoins théoriques, comme avant).
--
-- INVERSION
--   ALTER TABLE ... DROP COLUMN plan_item_id (×3) ; ALTER TABLE stock_anomalies DROP COLUMN origin_line_id.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE production_ingredient_needs
  ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE CASCADE;
ALTER TABLE production_lot_usage
  ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL;
ALTER TABLE stock_anomalies
  ADD COLUMN IF NOT EXISTS origin_line_id uuid;

CREATE INDEX IF NOT EXISTS idx_pin_plan_item ON production_ingredient_needs(plan_item_id) WHERE plan_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plu_plan_item ON production_lot_usage(plan_item_id) WHERE plan_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invtx_plan_item ON inventory_transactions(plan_item_id) WHERE plan_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_anomalies_line ON stock_anomalies(origin_line_id) WHERE origin_line_id IS NOT NULL;

COMMENT ON COLUMN production_ingredient_needs.plan_item_id IS 'Ligne de plan qui porte ce besoin (mig 663)';
COMMENT ON COLUMN production_lot_usage.plan_item_id IS 'Ligne de plan pour laquelle le lot a été consommé (mig 663)';
COMMENT ON COLUMN inventory_transactions.plan_item_id IS 'Ligne de plan pour laquelle la sortie a été faite (mig 663)';
COMMENT ON COLUMN stock_anomalies.origin_line_id IS 'Ligne du document d''origine (ligne de plan pour une production) (mig 663)';

-- Reprise : plans à un seul article actif.
WITH single AS (
  SELECT plan_id, (array_agg(id))[1] AS item_id
    FROM production_plan_items
   WHERE status <> 'cancelled'
   GROUP BY plan_id
  HAVING count(*) = 1
)
UPDATE production_ingredient_needs n SET plan_item_id = s.item_id
  FROM single s WHERE s.plan_id = n.plan_id AND n.plan_item_id IS NULL;

WITH single AS (
  SELECT plan_id, (array_agg(id))[1] AS item_id
    FROM production_plan_items WHERE status <> 'cancelled'
   GROUP BY plan_id HAVING count(*) = 1
)
UPDATE production_lot_usage u SET plan_item_id = s.item_id
  FROM single s WHERE s.plan_id = u.production_plan_id AND u.plan_item_id IS NULL;

WITH single AS (
  SELECT plan_id, (array_agg(id))[1] AS item_id
    FROM production_plan_items WHERE status <> 'cancelled'
   GROUP BY plan_id HAVING count(*) = 1
)
UPDATE inventory_transactions t SET plan_item_id = s.item_id
  FROM single s WHERE s.plan_id = t.production_plan_id AND t.plan_item_id IS NULL;

WITH single AS (
  SELECT plan_id, (array_agg(id))[1] AS item_id
    FROM production_plan_items WHERE status <> 'cancelled'
   GROUP BY plan_id HAVING count(*) = 1
)
UPDATE stock_anomalies a SET origin_line_id = s.item_id
  FROM single s WHERE a.origin_type = 'production_plan' AND s.plan_id = a.origin_id AND a.origin_line_id IS NULL;
