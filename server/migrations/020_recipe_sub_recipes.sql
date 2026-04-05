-- Support for sub-recipes (base preparations used in multiple recipes)
-- e.g. "Pâte à croissant" used in Croissant, Pain au chocolat, etc.

-- Allow recipes without a product (base preparations)
ALTER TABLE recipes ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_product_id_key;
ALTER TABLE recipes ADD CONSTRAINT recipes_product_id_unique UNIQUE (product_id);

-- Add is_base flag to distinguish base preparations from final product recipes
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_base BOOLEAN DEFAULT false;

-- Sub-recipe junction table
CREATE TABLE IF NOT EXISTS recipe_sub_recipes (
  id SERIAL PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sub_recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  quantity DECIMAL(10,4) NOT NULL DEFAULT 1,
  UNIQUE(recipe_id, sub_recipe_id),
  CHECK (recipe_id != sub_recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_sub_recipes_recipe ON recipe_sub_recipes(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_sub_recipes_sub ON recipe_sub_recipes(sub_recipe_id);
