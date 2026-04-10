-- ============================================================
-- 056: ONSSA Lot Traceability
-- Adds ingredient batch/lot tracking, reception quality checks,
-- and forward traceability (lot → production) for ONSSA compliance.
-- ============================================================

-- 1. Add lot/DLC fields to reception_voucher_items
ALTER TABLE reception_voucher_items ADD COLUMN IF NOT EXISTS supplier_lot_number VARCHAR(100);
ALTER TABLE reception_voucher_items ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE reception_voucher_items ADD COLUMN IF NOT EXISTS manufactured_date DATE;

-- 2. Create ingredient_lots table (core traceability entity)
CREATE TABLE IF NOT EXISTS ingredient_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  reception_voucher_item_id UUID REFERENCES reception_voucher_items(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  lot_number VARCHAR(50) NOT NULL UNIQUE,
  supplier_lot_number VARCHAR(100),
  quantity_received DECIMAL(12,4) NOT NULL,
  quantity_remaining DECIMAL(12,4) NOT NULL,
  unit_cost DECIMAL(10,4),
  manufactured_date DATE,
  expiration_date DATE,
  received_at DATE NOT NULL DEFAULT CURRENT_DATE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'depleted', 'expired', 'quarantine', 'waste')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_lots_ingredient_status ON ingredient_lots(ingredient_id, status);
CREATE INDEX IF NOT EXISTS idx_ingredient_lots_expiration ON ingredient_lots(expiration_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ingredient_lots_store ON ingredient_lots(store_id) WHERE store_id IS NOT NULL;

-- Lot number sequence
CREATE SEQUENCE IF NOT EXISTS lot_number_seq START 1;

-- 3. Reception quality checks
CREATE TABLE IF NOT EXISTS reception_quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_voucher_id UUID NOT NULL REFERENCES reception_vouchers(id) ON DELETE CASCADE UNIQUE,
  temperature_ok BOOLEAN,
  temperature_value DECIMAL(5,1),
  visual_ok BOOLEAN,
  packaging_ok BOOLEAN,
  labels_ok BOOLEAN,
  overall_conformity BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  checked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Production lot usage (forward traceability: lot → production)
CREATE TABLE IF NOT EXISTS production_lot_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  ingredient_lot_id UUID NOT NULL REFERENCES ingredient_lots(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity_used DECIMAL(12,4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_lot_usage_plan ON production_lot_usage(production_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_lot_usage_lot ON production_lot_usage(ingredient_lot_id);

-- 5. Add ingredient_lot_id to inventory_transactions for traceability
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS ingredient_lot_id UUID REFERENCES ingredient_lots(id) ON DELETE SET NULL;
