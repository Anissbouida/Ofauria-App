-- Phase 2 — Nouvelle destination 'retour_stock' pour les invendus revendables.
INSERT INTO ref_entries (table_id, code, label, color, display_order, is_active)
VALUES ('unsold_destinations', 'retour_stock', 'Retour reserve', '#22c55e', 4, true)
ON CONFLICT (table_id, code) DO NOTHING;

-- Multi-destinations recyclage : un produit peut etre recyclable vers
-- plusieurs ingredients destinataires (ex: croissant -> croissant aux amandes
-- OU pain perdu OU chapelure). La caissiere choisit au moment du recyclage.
CREATE TABLE IF NOT EXISTS product_recycle_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  label varchar(120),                        -- libelle UI (ex: "Vers croissant aux amandes")
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT NOW(),
  CONSTRAINT product_recycle_destinations_unique UNIQUE (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recycle_destinations_product
  ON product_recycle_destinations (product_id) WHERE is_active = true;

-- Backfill : les produits qui ont deja un recycle_ingredient_id beneficient
-- d'une 1re destination dans la nouvelle table (compat ascendante).
INSERT INTO product_recycle_destinations (product_id, ingredient_id, label, display_order)
SELECT p.id, p.recycle_ingredient_id, 'Recyclage par defaut', 0
FROM products p
WHERE p.recycle_ingredient_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_recycle_destinations prd
    WHERE prd.product_id = p.id AND prd.ingredient_id = p.recycle_ingredient_id
  );

-- ─── Trigger d'invariant comptable sur product_lots ────────────────────────
-- Garantit que: backroom_qty + vitrine_qty + sold_qty + wasted_qty + recycled_qty
-- ne depasse JAMAIS quantity_total. Premier verrou anti-fuite.
CREATE OR REPLACE FUNCTION check_product_lot_invariant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.backroom_qty + NEW.vitrine_qty + NEW.sold_qty + NEW.wasted_qty + NEW.recycled_qty
       > NEW.quantity_total + 0.001 THEN
    RAISE EXCEPTION 'product_lot invariant violated: somme(%, %, %, %, %) > total(%) pour lot %',
      NEW.backroom_qty, NEW.vitrine_qty, NEW.sold_qty, NEW.wasted_qty, NEW.recycled_qty,
      NEW.quantity_total, NEW.id;
  END IF;

  -- Auto-bascule en 'depleted' quand tout est consomme
  IF NEW.backroom_qty = 0 AND NEW.vitrine_qty = 0 AND OLD.status = 'active'
     AND (NEW.sold_qty + NEW.wasted_qty + NEW.recycled_qty) > 0 THEN
    NEW.status := 'depleted';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_lot_invariant ON product_lots;
CREATE TRIGGER trg_product_lot_invariant
  BEFORE UPDATE ON product_lots
  FOR EACH ROW
  EXECUTE FUNCTION check_product_lot_invariant();
