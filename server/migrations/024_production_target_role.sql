-- Add target_role to production_plans so each chef has their own production queue
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS target_role VARCHAR(30);

-- Create index for filtering by target_role
CREATE INDEX IF NOT EXISTS idx_production_plans_target_role ON production_plans(target_role);
