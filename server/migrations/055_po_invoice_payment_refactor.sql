-- ═══════════════════════════════════════════════════════════════
-- 055: Refonte bons de commande, factures et paiements
-- ═══════════════════════════════════════════════════════════════

-- ───── Axe 1: BC sans prix (unit_price nullable) ─────
ALTER TABLE purchase_order_items ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE purchase_order_items ALTER COLUMN unit_price SET DEFAULT NULL;

-- ───── Axe 1 & 3: Nouveaux statuts BC ─────
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('en_attente', 'envoye', 'livre_complet', 'livre_partiel', 'non_livre', 'annule', 'en_attente_facturation'));

-- ───── Axe 3: Bons de réception (livraisons partielles) ─────
CREATE TABLE IF NOT EXISTS reception_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(50) NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  reception_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  store_id UUID REFERENCES stores(id),
  received_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reception_voucher_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_voucher_id UUID NOT NULL REFERENCES reception_vouchers(id) ON DELETE CASCADE,
  purchase_order_item_id UUID NOT NULL REFERENCES purchase_order_items(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_received DECIMAL(12,4) NOT NULL CHECK (quantity_received > 0),
  unit_price DECIMAL(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rv_po ON reception_vouchers(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_rv_date ON reception_vouchers(reception_date);
CREATE INDEX IF NOT EXISTS idx_rv_store ON reception_vouchers(store_id);
CREATE INDEX IF NOT EXISTS idx_rvi_rv ON reception_voucher_items(reception_voucher_id);
CREATE INDEX IF NOT EXISTS idx_rvi_poi ON reception_voucher_items(purchase_order_item_id);

-- ───── Axe 2: Factures émises (clients) vs reçues (fournisseurs) ─────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(20) NOT NULL DEFAULT 'received'
  CHECK (invoice_type IN ('received', 'emitted'));
ALTER TABLE invoices ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reception_voucher_id UUID REFERENCES reception_vouchers(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);

CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_po ON invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);

-- Table d'articles pour factures (émises et reçues)
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  ingredient_id UUID REFERENCES ingredients(id),
  description TEXT,
  quantity DECIMAL(12,4) NOT NULL,
  unit_price DECIMAL(12,4) NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ii_invoice ON invoice_items(invoice_id);

-- ───── Axe 4: Détails chèque sur paiements ─────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_number VARCHAR(50);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_date DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_attachment_url TEXT;

-- Lien réception → transactions inventaire pour traçabilité
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reception_voucher_id UUID REFERENCES reception_vouchers(id);

-- ───── Numérotation automatique (séquences) ─────
CREATE SEQUENCE IF NOT EXISTS seq_reception_voucher START 1;
CREATE SEQUENCE IF NOT EXISTS seq_invoice_received START 1;
CREATE SEQUENCE IF NOT EXISTS seq_invoice_emitted START 1;
