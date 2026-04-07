-- Add batch_id to group requests created from the same submission
ALTER TABLE replenishment_requests ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_replenishment_batch ON replenishment_requests(batch_id) WHERE batch_id IS NOT NULL;
