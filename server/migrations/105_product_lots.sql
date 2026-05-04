-- Phase 1 — Table product_lots : matérialise les fournées de production
-- avec dual-clock DLV (vitrine) + DLC (consommation).
-- Tous les flux (production, transfert, vente, retour stock, recyclage)
-- s'appuient sur cette table pour la traçabilité par fournée et le FEFO.

CREATE TABLE IF NOT EXISTS product_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  production_plan_id uuid REFERENCES production_plans(id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_number varchar(50) NOT NULL,
  produced_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at date,                       -- DLC = produced_at + shelf_life_days
  first_displayed_at timestamptz,        -- moment de la 1re mise en vitrine (NULL si jamais expose)
  display_expires_at timestamptz,        -- DLV cumulee = first_displayed_at + display_life_hours
  quantity_total numeric(12,3) NOT NULL CHECK (quantity_total >= 0),
  backroom_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (backroom_qty >= 0),
  vitrine_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (vitrine_qty >= 0),
  sold_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  wasted_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (wasted_qty >= 0),
  recycled_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (recycled_qty >= 0),
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','depleted','expired','disposed')),
  notes text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  CONSTRAINT product_lots_unique_number UNIQUE (lot_number, store_id)
);

CREATE INDEX IF NOT EXISTS idx_product_lots_active
  ON product_lots (product_id, store_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_product_lots_fefo
  ON product_lots (product_id, store_id, expires_at) WHERE status = 'active' AND backroom_qty > 0;
CREATE INDEX IF NOT EXISTS idx_product_lots_vitrine
  ON product_lots (product_id, store_id) WHERE status = 'active' AND vitrine_qty > 0;
CREATE INDEX IF NOT EXISTS idx_product_lots_plan
  ON product_lots (production_plan_id) WHERE production_plan_id IS NOT NULL;

-- Sequence pour numerotation lot incrementale serveur-side (pas de doublon)
CREATE SEQUENCE IF NOT EXISTS product_lot_number_seq START 1;

-- ─── Tracabilite recyclage ─────────────────────────────────────────────────
-- Lien arriere : un ingredient_lot recycle peut pointer vers son product_lot source.
-- Permet l'audit chaine "ce sachet de croissant recycle vient de quel lot d'origine".
ALTER TABLE ingredient_lots
  ADD COLUMN IF NOT EXISTS source_product_lot_id uuid REFERENCES product_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredient_lots_source_product_lot
  ON ingredient_lots (source_product_lot_id) WHERE source_product_lot_id IS NOT NULL;

-- Liens chaine sur product_losses : retrouver le lot source detruit ET
-- le lot d'ingredient cree (pour les pertes type 'recyclage').
ALTER TABLE product_losses
  ADD COLUMN IF NOT EXISTS source_product_lot_id uuid REFERENCES product_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recycled_ingredient_lot_id uuid REFERENCES ingredient_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_losses_source_lot
  ON product_losses (source_product_lot_id) WHERE source_product_lot_id IS NOT NULL;

-- ─── Tracabilite sur unsold_decisions ──────────────────────────────────────
-- Quand une decision concerne un lot precis, on le memorise pour audit.
ALTER TABLE unsold_decisions
  ADD COLUMN IF NOT EXISTS product_lot_id uuid REFERENCES product_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unsold_decisions_lot
  ON unsold_decisions (product_lot_id) WHERE product_lot_id IS NOT NULL;
