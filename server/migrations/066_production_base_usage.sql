-- Track base/sub-recipe production and usage in final products
CREATE TABLE IF NOT EXISTS production_base_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  sub_recipe_id UUID NOT NULL REFERENCES recipes(id),
  sub_recipe_name VARCHAR(200) NOT NULL,
  consolidated_quantity DECIMAL(12,4) NOT NULL,
  actual_quantity_produced DECIMAL(12,4),
  already_produced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_base_usage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_usage_id UUID NOT NULL REFERENCES production_base_usage(id) ON DELETE CASCADE,
  plan_item_id UUID NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  quantity_used DECIMAL(12,4) NOT NULL
);

CREATE INDEX idx_production_base_usage_plan ON production_base_usage(production_plan_id);
CREATE INDEX idx_production_base_usage_items_base ON production_base_usage_items(base_usage_id);
