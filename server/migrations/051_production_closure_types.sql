-- Point 8: Types de clôture et annulation d'items
-- completion_type: 'complete' (tous produits), 'partial' (clôture partielle)
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS completion_type TEXT;

-- Metadata pour items annulés
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
