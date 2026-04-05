-- Add category to ingredients
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'autre';
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category);
