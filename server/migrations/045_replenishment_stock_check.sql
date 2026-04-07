-- ═══ Stock availability check for replenishment items ═══

-- Source tracking per item
ALTER TABLE replenishment_request_items
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS qty_from_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_to_produce INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_replenishment_items_production_plan
  ON replenishment_request_items(production_plan_id)
  WHERE production_plan_id IS NOT NULL;

-- Backfill existing items: treat as fully from stock
UPDATE replenishment_request_items
SET source_type = 'stock',
    qty_from_stock = requested_quantity,
    qty_to_produce = 0
WHERE source_type IS NULL OR qty_from_stock = 0;
