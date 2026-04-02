CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID UNIQUE NOT NULL REFERENCES ingredients(id),
  current_quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
  minimum_threshold DECIMAL(12,4) NOT NULL DEFAULT 0,
  last_restocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_low_stock ON inventory(current_quantity)
  WHERE current_quantity <= minimum_threshold;

CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('restock', 'usage', 'adjustment', 'waste')),
  quantity_change DECIMAL(12,4) NOT NULL,
  note TEXT,
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_tx_ingredient ON inventory_transactions(ingredient_id, created_at DESC);
