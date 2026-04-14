-- Add 'loss' to product_stock_transactions type constraint
ALTER TABLE product_stock_transactions DROP CONSTRAINT IF EXISTS product_stock_transactions_type_check;
ALTER TABLE product_stock_transactions ADD CONSTRAINT product_stock_transactions_type_check CHECK (
  type IN ('production', 'sale', 'return', 'adjustment', 'waste', 'exchange', 'loss')
);
