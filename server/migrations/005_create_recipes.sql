CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID UNIQUE REFERENCES products(id),
  name VARCHAR(200) NOT NULL,
  instructions TEXT,
  yield_quantity INT DEFAULT 1,
  total_cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity DECIMAL(10,4) NOT NULL
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
