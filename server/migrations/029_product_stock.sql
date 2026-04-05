-- Product stock tracking for finished goods
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity DECIMAL(10,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_min_threshold DECIMAL(10,2) DEFAULT 0;

-- Product stock transaction log (audit trail)
CREATE TABLE IF NOT EXISTS product_stock_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('production', 'sale', 'return', 'adjustment', 'waste', 'exchange')),
  quantity_change DECIMAL(10,2) NOT NULL,
  stock_after DECIMAL(10,2) NOT NULL,
  note TEXT,
  reference_id UUID,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_stock_tx_product ON product_stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_tx_type ON product_stock_transactions(type);
CREATE INDEX IF NOT EXISTS idx_product_stock_tx_date ON product_stock_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_stock_quantity ON products(stock_quantity);
