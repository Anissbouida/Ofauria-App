-- Returns and exchanges table
CREATE TABLE sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number VARCHAR(20) UNIQUE NOT NULL,
  original_sale_id UUID NOT NULL REFERENCES sales(id),
  user_id UUID NOT NULL REFERENCES users(id),
  session_id UUID REFERENCES cash_register_sessions(id),
  type VARCHAR(10) NOT NULL CHECK (type IN ('return', 'exchange')),
  reason TEXT,
  refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- For exchanges: the new sale created
  exchange_sale_id UUID REFERENCES sales(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_returns_sale ON sale_returns(original_sale_id);
CREATE INDEX idx_returns_created ON sale_returns(created_at DESC);
CREATE INDEX idx_return_items_return ON sale_return_items(return_id);
