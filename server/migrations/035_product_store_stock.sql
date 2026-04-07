-- Per-store product stock isolation
-- Products (catalogue) remain global, but stock is tracked per store
CREATE TABLE IF NOT EXISTS product_store_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stock_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_min_threshold DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_product_store_stock_product ON product_store_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_product_store_stock_store ON product_store_stock(store_id);
CREATE INDEX IF NOT EXISTS idx_product_store_stock_qty ON product_store_stock(stock_quantity);

-- Seed: create one row per (product, store) from existing data
INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold)
SELECT p.id, s.id, p.stock_quantity, p.stock_min_threshold
FROM products p
CROSS JOIN stores s
ON CONFLICT (product_id, store_id) DO NOTHING;
