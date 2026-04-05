-- Link orders to cash register sessions (for advance payments tracking)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES cash_register_sessions(id);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);

-- Add advance tracking columns to cash register sessions
ALTER TABLE cash_register_sessions ADD COLUMN IF NOT EXISTS total_advances DECIMAL(10,2) DEFAULT 0;
ALTER TABLE cash_register_sessions ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0;
