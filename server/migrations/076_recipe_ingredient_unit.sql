-- Allow each recipe ingredient to specify its own unit (different from ingredient default)
-- e.g. ingredient "Farine T65" is stored in kg, but recipe can use g
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS unit VARCHAR(20);
