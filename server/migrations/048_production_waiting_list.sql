-- Add waiting_status to production_plan_items for items blocked by missing ingredients
-- Values: NULL (normal), 'waiting' (blocked - ingredients unavailable), 'restored' (unblocked after restock)
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS waiting_status TEXT;

-- Index for quick lookup of waiting items
CREATE INDEX IF NOT EXISTS idx_plan_items_waiting ON production_plan_items(plan_id, waiting_status) WHERE waiting_status IS NOT NULL;
