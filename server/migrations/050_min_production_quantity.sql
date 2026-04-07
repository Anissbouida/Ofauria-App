-- Point 4: Lot minimum de production
-- Default 0 = pas de minimum (comportement actuel preservé)
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_production_quantity INTEGER DEFAULT 0;
