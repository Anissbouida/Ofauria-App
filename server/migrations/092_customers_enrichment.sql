-- Enrichir la fiche client
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT 'particulier',
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS preferred_contact VARCHAR(20) DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(customer_type);
