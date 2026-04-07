-- Sub-requests: split replenishment requests per production chef
-- Parent request = what the cashier sees (consolidated view)
-- Sub-requests = one per chef role, each with independent status lifecycle

ALTER TABLE replenishment_requests ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES replenishment_requests(id) ON DELETE CASCADE;
ALTER TABLE replenishment_requests ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(30);
ALTER TABLE replenishment_requests ADD COLUMN IF NOT EXISTS is_parent BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_replenishment_parent_id ON replenishment_requests(parent_id);
CREATE INDEX IF NOT EXISTS idx_replenishment_assigned_role ON replenishment_requests(assigned_role);
