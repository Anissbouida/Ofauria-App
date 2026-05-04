-- Add margin_multiplier on recipes: sale_price = (total_cost / yield_quantity) * margin_multiplier
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS margin_multiplier NUMERIC(6,3) NOT NULL DEFAULT 3;

-- Backfill: derive multiplier from existing linked product price when both sides are populated
UPDATE recipes r
SET margin_multiplier = ROUND(
  (p.price::numeric / NULLIF((r.total_cost / NULLIF(r.yield_quantity, 0)), 0))::numeric,
  3
)
FROM products p
WHERE p.id = r.product_id
  AND r.total_cost > 0
  AND r.yield_quantity > 0
  AND p.price > 0;
