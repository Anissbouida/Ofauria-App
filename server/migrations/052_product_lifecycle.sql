-- Point retours : Cycle de vie produit
-- shelf_life_days : durée de vie depuis la production (stockable congelé)
-- display_life_hours : durée max d'exposition en vitrine depuis le transfert
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS display_life_hours INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_reexposable BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_recyclable BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS recycle_ingredient_id UUID REFERENCES ingredients(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_reexpositions INTEGER DEFAULT 0;
