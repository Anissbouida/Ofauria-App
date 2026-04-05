-- ============================================
-- Cash register sessions (fermeture de caisse)
-- ============================================

CREATE TABLE cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  expected_cash DECIMAL(10,2),
  actual_amount DECIMAL(10,2),
  difference DECIMAL(10,2),
  total_sales INT DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  cash_revenue DECIMAL(10,2) DEFAULT 0,
  card_revenue DECIMAL(10,2) DEFAULT 0,
  mobile_revenue DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

CREATE INDEX idx_cash_sessions_user ON cash_register_sessions(user_id);
CREATE INDEX idx_cash_sessions_status ON cash_register_sessions(status);
CREATE INDEX idx_cash_sessions_opened ON cash_register_sessions(opened_at DESC);

-- Link sales to sessions
ALTER TABLE sales ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES cash_register_sessions(id);
CREATE INDEX idx_sales_session ON sales(session_id);
