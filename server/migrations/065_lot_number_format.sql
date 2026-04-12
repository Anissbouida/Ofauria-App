-- Short lot number tracking for production items (LOT-AAMMJJ-NNN format)
CREATE TABLE IF NOT EXISTS production_lot_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id UUID NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  lot_number VARCHAR(20) NOT NULL,
  lot_date DATE NOT NULL,
  sequence_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_item_id),
  UNIQUE(lot_number)
);

CREATE INDEX idx_production_lot_numbers_date ON production_lot_numbers(lot_date);
CREATE INDEX idx_production_lot_numbers_plan ON production_lot_numbers(plan_id);
