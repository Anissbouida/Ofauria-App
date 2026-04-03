-- ============================================
-- Separate Sales (daily POS) from Orders (pre-orders for production)
-- ============================================

-- 1. Create sales table for daily POS transactions
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number VARCHAR(20) UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'mobile')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_sales_created ON sales(created_at DESC);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

-- 2. Refactor orders table for customer pre-orders linked to production
-- Add pickup_date as required concept, link to production
ALTER TABLE orders ADD COLUMN IF NOT EXISTS linked_plan_id UUID REFERENCES production_plans(id);

-- Update existing in_store orders to custom (data migration) before changing constraint
UPDATE orders SET type = 'custom' WHERE type NOT IN ('custom', 'online', 'event');

-- Update order types: remove 'in_store', keep 'custom' and 'online' and 'event'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_type_check CHECK (type IN ('custom', 'online', 'event'));
