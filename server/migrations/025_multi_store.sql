-- ═══════════════════════════════════════════════
-- Multi-store support: points de vente multiples
-- ═══════════════════════════════════════════════

-- 1. Stores table
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  city VARCHAR(100),
  address TEXT,
  phone VARCHAR(30),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add store_id to users (each user belongs to one store)
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 3. Add store_id to transactional tables
ALTER TABLE sales ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE cash_register_sessions ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 4. Add store_id to inventory (per-store stock)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 5. Add store_id to HR tables
ALTER TABLE employees ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_sessions_store ON cash_register_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_production_store ON production_plans(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_employees_store ON employees(store_id);
CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_returns_store ON sale_returns(store_id);

-- 7. Drop the old unique constraint on inventory (ingredient_id alone)
-- and create new one with store_id
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_ingredient_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_store_ingredient_unique ON inventory(store_id, ingredient_id);
