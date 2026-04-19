-- Production activity feed: timestamped comments and system events
CREATE TABLE IF NOT EXISTS production_plan_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plan_activity_plan_id ON production_plan_activity(plan_id);
CREATE INDEX idx_plan_activity_created_at ON production_plan_activity(plan_id, created_at DESC);
