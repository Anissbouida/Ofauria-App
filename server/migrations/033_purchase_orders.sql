-- Purchase Orders (Bons de commande fournisseur)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'envoye', 'livre_complet', 'livre_partiel', 'non_livre', 'annule')),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  delivery_date DATE,
  notes TEXT,
  store_id UUID REFERENCES stores(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_ordered DECIMAL(12,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_delivered DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit_price DECIMAL(10,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link inventory transactions to purchase order items for full traceability
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES purchase_order_items(id);

-- Extend type CHECK to include purchase_order
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check
  CHECK (type IN ('restock', 'usage', 'adjustment', 'waste', 'production', 'purchase_order'));

-- Indexes
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_date ON purchase_orders(order_date DESC);
CREATE INDEX idx_po_store ON purchase_orders(store_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_po_items_ingredient ON purchase_order_items(ingredient_id);
