-- Link production plans to orders
ALTER TABLE production_plans ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX idx_production_plans_order ON production_plans(order_id);
