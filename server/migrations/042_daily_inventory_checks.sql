-- Daily inventory checks (Rule 3: closing inventory for replenished items)
CREATE TABLE IF NOT EXISTS daily_inventory_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  session_id UUID REFERENCES cash_register_sessions(id),
  checked_by UUID NOT NULL REFERENCES users(id),
  total_replenished INTEGER NOT NULL DEFAULT 0,
  total_sold INTEGER NOT NULL DEFAULT 0,
  total_remaining INTEGER NOT NULL DEFAULT 0,
  total_discrepancy INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_inventory_check_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES daily_inventory_checks(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  replenished_qty INTEGER NOT NULL DEFAULT 0,
  sold_qty INTEGER NOT NULL DEFAULT 0,
  remaining_qty INTEGER NOT NULL DEFAULT 0,
  discrepancy INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_inventory_checks_store ON daily_inventory_checks(store_id);
CREATE INDEX IF NOT EXISTS idx_daily_inventory_checks_date ON daily_inventory_checks(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_inventory_check_items_check ON daily_inventory_check_items(check_id);
