-- Add staff discount setting to company_settings
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS staff_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 10;

-- Add 'staff' to order type check constraint if exists
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
