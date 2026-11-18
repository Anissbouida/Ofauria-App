-- M7-01 — Inspections rattachées.
-- quality_inspections (mig 384) n'avait qu'une référence en texte libre. Une inspection
-- se rattache désormais à l'ordre, à la ligne d'ordre, à l'opération d'ordre
-- (production_item_etapes), au lot de matière, au lot de produit fini, à la réception.
-- Historique : laissé vide. Une inspection peut être « à faire » (générée par le plan de
-- contrôle, M7-02) puis réalisée.

ALTER TABLE quality_inspections
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_item_id UUID REFERENCES production_plan_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS etape_id UUID REFERENCES production_item_etapes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ingredient_lot_id UUID REFERENCES ingredient_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_lot_id UUID REFERENCES product_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reception_voucher_id UUID REFERENCES reception_vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'faite';
DO $$ BEGIN
  ALTER TABLE quality_inspections ADD CONSTRAINT chk_quality_inspection_status CHECK (status IN ('a_faire', 'faite'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_qi_plan ON quality_inspections (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qi_product_lot ON quality_inspections (product_lot_id) WHERE product_lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qi_ingredient_lot ON quality_inspections (ingredient_lot_id) WHERE ingredient_lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qi_reception ON quality_inspections (reception_voucher_id) WHERE reception_voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qi_pending ON quality_inspections (status) WHERE status = 'a_faire';
