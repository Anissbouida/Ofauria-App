CREATE TABLE production_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date DATE NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('daily', 'weekly')),
  week_number INT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_progress', 'completed')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_production_plans_date ON production_plans(plan_date DESC);
CREATE INDEX idx_production_plans_status ON production_plans(status);

CREATE TABLE production_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  planned_quantity INT NOT NULL CHECK (planned_quantity > 0),
  actual_quantity INT,
  notes TEXT,
  UNIQUE(plan_id, product_id)
);

CREATE INDEX idx_plan_items_plan ON production_plan_items(plan_id);

CREATE TABLE production_ingredient_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  needed_quantity DECIMAL(12,4) NOT NULL,
  available_quantity DECIMAL(12,4) NOT NULL,
  is_sufficient BOOLEAN GENERATED ALWAYS AS (available_quantity >= needed_quantity) STORED
);

CREATE INDEX idx_prod_needs_plan ON production_ingredient_needs(plan_id);

-- Extend inventory_transactions to support production type
ALTER TABLE inventory_transactions
  DROP CONSTRAINT inventory_transactions_type_check,
  ADD CONSTRAINT inventory_transactions_type_check
    CHECK (type IN ('restock', 'usage', 'adjustment', 'waste', 'production'));

ALTER TABLE inventory_transactions
  ADD COLUMN production_plan_id UUID REFERENCES production_plans(id);
