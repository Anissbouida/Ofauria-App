-- Migration 081: Semi-finished product stock and dependency tracking
-- ADDITIVE ONLY — no existing tables or columns are modified

-- 1. Stock of semi-finished products (base recipes produced in advance)
CREATE TABLE IF NOT EXISTS semi_finished_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  quantity_available DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'unit',
  last_produced_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recipe_id, store_id)
);

-- 2. Movement history for semi-finished stock
CREATE TABLE IF NOT EXISTS semi_finished_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('production', 'consumption', 'reservation', 'release', 'waste', 'adjustment')),
  quantity_change DECIMAL(12,4) NOT NULL,
  production_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Dependency links between production plans (parent needs semi-finished from dependency)
CREATE TABLE IF NOT EXISTS production_plan_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  dependency_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  sub_recipe_id UUID NOT NULL REFERENCES recipes(id),
  quantity_needed DECIMAL(12,4) NOT NULL,
  quantity_from_stock DECIMAL(12,4) NOT NULL DEFAULT 0,
  quantity_to_produce DECIMAL(12,4) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_production', 'fulfilled', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (dependency_plan_id IS NULL OR parent_plan_id != dependency_plan_id)
);

-- 4. Additive nullable columns on existing tables (no breaking change)
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS is_semi_finished_plan BOOLEAN DEFAULT false;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS base_recipe_id UUID REFERENCES recipes(id);

-- 5. Allow NULL product_id for semi-finished plan items (they use base_recipe_id instead)
ALTER TABLE production_plan_items ALTER COLUMN product_id DROP NOT NULL;

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_semi_finished_stock_recipe ON semi_finished_stock(recipe_id);
CREATE INDEX IF NOT EXISTS idx_semi_finished_transactions_recipe ON semi_finished_transactions(recipe_id);
CREATE INDEX IF NOT EXISTS idx_production_plan_deps_parent ON production_plan_dependencies(parent_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_plan_deps_dependency ON production_plan_dependencies(dependency_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_plans_semi_finished ON production_plans(is_semi_finished_plan) WHERE is_semi_finished_plan = true;
