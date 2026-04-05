-- Add new order statuses: confirmed, in_production
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'in_production', 'ready', 'completed', 'cancelled'));

-- Migrate existing 'preparing' orders to 'in_production'
UPDATE orders SET status = 'in_production' WHERE status = 'preparing';
