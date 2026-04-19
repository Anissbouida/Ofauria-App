-- ─────────────────────────────────────────────────────────────
-- Separate vitrine (display/sellable) stock from backroom stock
-- ─────────────────────────────────────────────────────────────
-- Until now, `product_store_stock.stock_quantity` held a single per-store qty
-- written by production (completing a plan) and read by the POS. This made
-- production over- or under-fulfillment directly sellable, bypassing the
-- replenishment request → transfer → reception workflow.
--
-- After this migration:
--   * stock_quantity      → backroom (magasin) reserve, fed by production
--   * vitrine_quantity    → display, fed only by replenishment reception,
--                           decremented by POS sales / returns / vitrine losses
--
-- Existing stock_quantity is considered "backroom" (it was produced but never
-- went through a real replenishment reception). vitrine_quantity starts at 0:
-- the cashier must trigger a replenishment request + reception to get anything
-- sellable. This enforces the workflow from day one.

ALTER TABLE product_store_stock
  ADD COLUMN IF NOT EXISTS vitrine_quantity DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN product_store_stock.stock_quantity IS
  'Backroom reserve qty per store — fed by production, not directly sellable';
COMMENT ON COLUMN product_store_stock.vitrine_quantity IS
  'Display qty per store — fed by replenishment reception, decremented by POS';

CREATE INDEX IF NOT EXISTS idx_product_store_stock_vitrine
  ON product_store_stock(vitrine_quantity);
