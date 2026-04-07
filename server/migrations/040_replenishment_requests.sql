-- Replenishment requests (demandes de réapprovisionnement)
CREATE TABLE IF NOT EXISTS replenishment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(30) NOT NULL UNIQUE,
  store_id UUID NOT NULL REFERENCES stores(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'in_progress', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  needed_by TIMESTAMPTZ,
  notes TEXT,
  dispatched_by UUID REFERENCES users(id),
  dispatched_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replenishment_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES replenishment_requests(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  fulfilled_quantity INTEGER DEFAULT 0,
  fulfilled_from_stock INTEGER DEFAULT 0,
  fulfilled_from_production INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'from_stock', 'to_produce', 'in_production', 'fulfilled', 'partially_fulfilled')),
  assigned_to_role VARCHAR(30),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track deliveries from production/stock to store
CREATE TABLE IF NOT EXISTS stock_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES replenishment_requests(id) ON DELETE SET NULL,
  request_item_id UUID REFERENCES replenishment_request_items(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('stock', 'production')),
  delivered_by UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),
  production_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link production plans back to replenishment requests
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS replenishment_request_id UUID REFERENCES replenishment_requests(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_replenishment_requests_store ON replenishment_requests(store_id);
CREATE INDEX IF NOT EXISTS idx_replenishment_requests_status ON replenishment_requests(status);
CREATE INDEX IF NOT EXISTS idx_replenishment_items_request ON replenishment_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_replenishment_items_product ON replenishment_request_items(product_id);
CREATE INDEX IF NOT EXISTS idx_replenishment_items_role ON replenishment_request_items(assigned_to_role);
CREATE INDEX IF NOT EXISTS idx_stock_deliveries_request ON stock_deliveries(request_id);
CREATE INDEX IF NOT EXISTS idx_production_plans_replenishment ON production_plans(replenishment_request_id);
