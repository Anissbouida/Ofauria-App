-- Add responsible user (chef) to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_responsible ON products(responsible_user_id);
