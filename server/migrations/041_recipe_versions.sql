-- Recipe versioning: store history of recipe changes
CREATE TABLE IF NOT EXISTS recipe_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  instructions TEXT,
  yield_quantity DECIMAL(12,2) DEFAULT 1,
  total_cost DECIMAL(12,2) DEFAULT 0,
  is_base BOOLEAN DEFAULT false,
  ingredients JSONB NOT NULL DEFAULT '[]',
  sub_recipes JSONB NOT NULL DEFAULT '[]',
  changed_by UUID REFERENCES users(id),
  change_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recipe_id, version_number)
);

CREATE INDEX idx_recipe_versions_recipe ON recipe_versions(recipe_id, version_number DESC);

-- Add constraint to prevent yield_quantity = 0
ALTER TABLE recipes ADD CONSTRAINT chk_yield_positive CHECK (yield_quantity > 0);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_recipe_sub_recipes_sub ON recipe_sub_recipes(sub_recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes(product_id) WHERE product_id IS NOT NULL;
