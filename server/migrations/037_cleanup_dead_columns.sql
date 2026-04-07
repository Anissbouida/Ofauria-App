-- Remove unused linked_plan_id column from orders
-- The reverse relationship (production_plans.order_id) is the one actually used
ALTER TABLE orders DROP COLUMN IF EXISTS linked_plan_id;
