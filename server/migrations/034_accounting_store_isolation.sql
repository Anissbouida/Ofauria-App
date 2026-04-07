-- Add store_id to invoices for multi-store isolation
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_invoices_store ON invoices(store_id);

-- Add store_id to payments for multi-store isolation
ALTER TABLE payments ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_payments_store ON payments(store_id);
