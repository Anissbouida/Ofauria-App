-- Allow production plans to have 'cancelled' status
-- Adds columns for tracking cancellation metadata
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
