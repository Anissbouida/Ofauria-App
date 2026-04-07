-- ═══════════════════════════════════════════════════════════════
-- Migration 043: Replenishment V2 — Nouveau flux complet
-- Statuts: submitted → acknowledged → preparing → transferred → closed / closed_with_discrepancy
-- ═══════════════════════════════════════════════════════════════

-- 1. Add new tracking columns to replenishment_requests
ALTER TABLE replenishment_requests
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

-- 2. Add new columns to replenishment_request_items
ALTER TABLE replenishment_request_items
  ADD COLUMN IF NOT EXISTS qty_to_store INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_to_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_received INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS reception_notes TEXT;

-- 3. Extend status column sizes
ALTER TABLE replenishment_request_items ALTER COLUMN status TYPE VARCHAR(30);

-- 4. Drop old CHECK constraints FIRST (before migrating data)
ALTER TABLE replenishment_requests DROP CONSTRAINT IF EXISTS replenishment_requests_status_check;
ALTER TABLE replenishment_request_items DROP CONSTRAINT IF EXISTS replenishment_request_items_status_check;

-- 4. Migrate existing request statuses to new values
UPDATE replenishment_requests SET status = 'closed' WHERE status IN ('fulfilled', 'partially_fulfilled');
UPDATE replenishment_requests
  SET status = 'preparing',
      acknowledged_at = dispatched_at,
      acknowledged_by = dispatched_by,
      preparing_at = dispatched_at
  WHERE status IN ('dispatched', 'in_progress');
UPDATE replenishment_requests SET status = 'submitted' WHERE status = 'pending';

-- 5. Migrate item statuses
UPDATE replenishment_request_items
  SET status = 'received',
      qty_to_store = COALESCE(fulfilled_from_stock, 0) + COALESCE(fulfilled_from_production, 0),
      qty_received = COALESCE(fulfilled_from_stock, 0) + COALESCE(fulfilled_from_production, 0)
  WHERE status IN ('fulfilled', 'partially_fulfilled', 'from_stock');

UPDATE replenishment_request_items
  SET status = 'pending'
  WHERE status IN ('dispatched', 'to_produce', 'in_production');

-- 6. Add new CHECK constraints
ALTER TABLE replenishment_requests
  ADD CONSTRAINT replenishment_requests_status_check
  CHECK (status IN ('submitted', 'acknowledged', 'preparing', 'transferred', 'closed', 'closed_with_discrepancy', 'cancelled'));

ALTER TABLE replenishment_request_items
  ADD CONSTRAINT replenishment_request_items_status_check
  CHECK (status IN ('pending', 'preparing', 'ready', 'received', 'received_with_discrepancy'));

-- 7. Set default status for new requests
ALTER TABLE replenishment_requests ALTER COLUMN status SET DEFAULT 'submitted';
