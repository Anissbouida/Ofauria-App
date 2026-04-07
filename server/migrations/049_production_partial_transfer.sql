-- Production partielle : statut par article
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Table des transferts partiels de production
CREATE TABLE IF NOT EXISTS production_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  transferred_by UUID NOT NULL REFERENCES users(id),
  transferred_at TIMESTAMPTZ DEFAULT NOW(),
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'transferred' CHECK (status IN ('transferred', 'received', 'received_with_discrepancy')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES production_transfers(id) ON DELETE CASCADE,
  plan_item_id UUID NOT NULL REFERENCES production_plan_items(id),
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT,
  transferred_quantity INTEGER NOT NULL CHECK (transferred_quantity > 0),
  received_quantity INTEGER
);

CREATE INDEX IF NOT EXISTS idx_prod_transfers_plan ON production_transfers(plan_id);
CREATE INDEX IF NOT EXISTS idx_prod_transfers_store_status ON production_transfers(store_id, status);
CREATE INDEX IF NOT EXISTS idx_prod_transfer_items_transfer ON production_transfer_items(transfer_id);
