-- Purchase requests: waiting list for ingredient needs before grouping into purchase orders
CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  quantity DECIMAL(12,4) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(20) NOT NULL,
  reason VARCHAR(50) NOT NULL DEFAULT 'manual'
    CHECK (reason IN ('stock_bas', 'production', 'manual', 'replenishment')),
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'ordered', 'cancelled')),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  requested_by UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_supplier ON purchase_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pr_ingredient ON purchase_requests(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_pr_store ON purchase_requests(store_id) WHERE store_id IS NOT NULL;
