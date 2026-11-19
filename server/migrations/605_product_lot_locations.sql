-- M6-02 (suite) — Produits finis : stock par lot ET par emplacement.
--
-- Côté matières, ingredient_lot_locations (mig 570) porte la quantité de chaque lot dans
-- chaque emplacement et stock_location_moves trace les transferts. Les produits finis
-- n'avaient que deux nombres de compte rendu sur le rendement (vers_magasin, vers_frigo).
-- Désormais :
--   1. product_lot_locations : quantité d'un lot produit fini dans un emplacement
--      (Magasin, Frigo ou tout autre emplacement de l'établissement) ;
--   2. stock_location_moves accepte un lot produit fini (product_lot_id) à la place d'un lot
--      matière — exactement un des deux ; l'envoi d'un lot vers le magasin ou le frigo est
--      un mouvement entre emplacements (origine NULL = sortie de production) ;
--   3. fn_trim_product_lot_locations : quand le reste du lot (réserve + vitrine) baisse sous
--      la quantité rangée (vente, perte, recyclage), les parts rangées sont réduites
--      (vitrine d'abord) sans mouvement — la sortie est déjà tracée dans product_lot_movements.
--      Invariant : Σ emplacements ≤ réserve + vitrine, pour tout lot.
-- Aucun emplacement n'est créé ici : sans « Magasin » / « Frigo » définis pour
-- l'établissement, le serveur répond par un message clair (Stock › Emplacements).
--
-- INVERSION :
--   DROP TRIGGER IF EXISTS trg_trim_product_lot_locations ON product_lots;
--   DROP FUNCTION IF EXISTS fn_trim_product_lot_locations();
--   DROP VIEW IF EXISTS v_product_lot_location_balance;
--   DELETE FROM stock_location_moves WHERE product_lot_id IS NOT NULL;
--   ALTER TABLE stock_location_moves DROP CONSTRAINT IF EXISTS stock_location_moves_one_lot;
--   ALTER TABLE stock_location_moves ALTER COLUMN ingredient_lot_id SET NOT NULL;
--   DROP INDEX IF EXISTS idx_location_moves_product_lot;
--   ALTER TABLE stock_location_moves DROP COLUMN IF EXISTS product_lot_id;
--   DROP TABLE IF EXISTS product_lot_locations;

CREATE TABLE IF NOT EXISTS product_lot_locations (
  product_lot_id UUID NOT NULL REFERENCES product_lots(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity       NUMERIC(12,3) NOT NULL CHECK (quantity >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_lot_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_product_lot_locations_location ON product_lot_locations (location_id) WHERE quantity > 0;
COMMENT ON TABLE product_lot_locations IS
  'M6-02 (mig 605) : quantité d''un lot produit fini par emplacement. Σ ≤ réserve + vitrine du lot (fn_trim_product_lot_locations).';

ALTER TABLE stock_location_moves
  ADD COLUMN IF NOT EXISTS product_lot_id UUID REFERENCES product_lots(id) ON DELETE CASCADE;
ALTER TABLE stock_location_moves ALTER COLUMN ingredient_lot_id DROP NOT NULL;
ALTER TABLE stock_location_moves DROP CONSTRAINT IF EXISTS stock_location_moves_one_lot;
ALTER TABLE stock_location_moves ADD CONSTRAINT stock_location_moves_one_lot
  CHECK (num_nonnulls(ingredient_lot_id, product_lot_id) = 1);
CREATE INDEX IF NOT EXISTS idx_location_moves_product_lot
  ON stock_location_moves (product_lot_id, moved_at DESC) WHERE product_lot_id IS NOT NULL;

CREATE FUNCTION fn_trim_product_lot_locations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_rest NUMERIC := GREATEST(COALESCE(NEW.backroom_qty, 0) + COALESCE(NEW.vitrine_qty, 0), 0);
  v_excess NUMERIC;
  v_take NUMERIC;
  r RECORD;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) - v_rest INTO v_excess FROM product_lot_locations WHERE product_lot_id = NEW.id;
  IF v_excess <= 0 THEN RETURN NEW; END IF;
  FOR r IN SELECT pll.location_id, pll.quantity
             FROM product_lot_locations pll JOIN stock_locations sl ON sl.id = pll.location_id
            WHERE pll.product_lot_id = NEW.id AND pll.quantity > 0
            ORDER BY (sl.type = 'vitrine') DESC, pll.quantity DESC
  LOOP
    EXIT WHEN v_excess <= 0;
    v_take := LEAST(r.quantity, v_excess);
    UPDATE product_lot_locations SET quantity = quantity - v_take, updated_at = NOW()
     WHERE product_lot_id = NEW.id AND location_id = r.location_id;
    v_excess := v_excess - v_take;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_trim_product_lot_locations
  AFTER UPDATE OF backroom_qty, vitrine_qty ON product_lots
  FOR EACH ROW EXECUTE FUNCTION fn_trim_product_lot_locations();

CREATE VIEW v_product_lot_location_balance AS
SELECT pl.id AS product_lot_id, pl.store_id,
       (pl.backroom_qty + pl.vitrine_qty) AS lot_remaining,
       COALESCE(SUM(pll.quantity), 0) AS locations_total
  FROM product_lots pl LEFT JOIN product_lot_locations pll ON pll.product_lot_id = pl.id
 GROUP BY pl.id;
COMMENT ON VIEW v_product_lot_location_balance IS 'M6-02 : contrôle Σ emplacements ≤ réserve + vitrine, lot produit fini par lot.';
