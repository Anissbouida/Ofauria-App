-- ═══════════════════════════════════════════════════════════════════════
-- 585 — Numéros de série en fabrication (M9)
--
--   products.tracking_mode : 'lot' (défaut, suivi par lot comme aujourd'hui) ou 'serial'
--   (chaque pièce porte un numéro unique, en plus de son lot). À la déclaration de production
--   d'un article suivi par série, un numéro est créé par pièce : ceux saisis par l'opérateur,
--   sinon « numéro de lot-0001… ». Quantité entière obligatoire pour un article suivi par série.
--   product_serials rattache chaque numéro à son lot (product_lots), à son ordre et à sa ligne.
--
-- INVERSION
--   DROP TABLE product_serials ; ALTER TABLE products DROP COLUMN tracking_mode.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS tracking_mode varchar(10) NOT NULL DEFAULT 'lot';
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT chk_products_tracking_mode CHECK (tracking_mode IN ('lot', 'serial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN products.tracking_mode IS 'Traçabilité : lot (défaut) ou serial = un numéro par pièce à la fabrication (mig 585).';

CREATE TABLE IF NOT EXISTS product_serials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  serial_number   varchar(80) NOT NULL CHECK (char_length(btrim(serial_number)) > 0),
  product_lot_id  uuid REFERENCES product_lots(id) ON DELETE SET NULL,
  plan_id         uuid REFERENCES production_plans(id) ON DELETE SET NULL,
  plan_item_id    uuid REFERENCES production_plan_items(id) ON DELETE SET NULL,
  status          varchar(12) NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'scrapped')),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, serial_number)
);
CREATE INDEX IF NOT EXISTS idx_product_serials_lot ON product_serials (product_lot_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_plan ON product_serials (plan_id);
COMMENT ON TABLE product_serials IS 'Numéros de série des pièces fabriquées, rattachés à leur lot et à leur ordre (mig 585).';
