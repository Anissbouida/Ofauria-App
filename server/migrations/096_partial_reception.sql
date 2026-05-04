-- Add partial_deadline column and allow 'partially_received' status
ALTER TABLE replenishment_requests
  ADD COLUMN IF NOT EXISTS partial_deadline TIMESTAMPTZ;

-- Update status CHECK constraint to include 'partially_received'
ALTER TABLE replenishment_requests DROP CONSTRAINT IF EXISTS replenishment_requests_status_check;
ALTER TABLE replenishment_requests
  ADD CONSTRAINT replenishment_requests_status_check
  CHECK (status IN ('submitted', 'acknowledged', 'preparing', 'transferred', 'partially_received', 'closed', 'closed_with_discrepancy', 'cancelled'));
