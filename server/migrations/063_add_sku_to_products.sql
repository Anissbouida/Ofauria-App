-- Add SKU (UGS) field to products for POS system matching
ALTER TABLE products ADD COLUMN sku VARCHAR(20);
CREATE UNIQUE INDEX idx_products_sku ON products(sku) WHERE sku IS NOT NULL;
