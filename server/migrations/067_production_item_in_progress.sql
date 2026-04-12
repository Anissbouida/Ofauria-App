-- Add in_progress lifecycle for production plan items
-- Items can now be: pending → in_progress → produced → transferred → received
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS started_by UUID REFERENCES users(id);
