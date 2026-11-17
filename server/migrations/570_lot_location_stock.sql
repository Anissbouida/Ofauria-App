-- M6-02 — Stock par lot ET par emplacement.
-- Jusqu'ici un lot = un emplacement (mig 424-425) et deux zones codées à part sur le lot
-- (economat_quantity, pesage_quantity). La table ingredient_lot_locations porte la
-- quantité de chaque lot dans chaque emplacement.
-- Transition : les zones du lot restent la source écrite par le code existant ; un
-- déclencheur les reflète dans la table (part économat → emplacement de stockage du lot,
-- sinon « Économat » de l'établissement ; part pesage → « Zone de pesage »). Invariant :
-- Σ quantités par emplacement = economat_quantity + pesage_quantity = quantity_remaining.
-- Emplacements « Magasin » et « Frigo » créés par établissement (destinations de
-- production) ; aucune stratégie de rangement automatique.
-- Rollback : DROP TRIGGER trg_sync_lot_locations ON ingredient_lots ; DROP VIEW
--   v_lot_location_balance ; DROP TABLE ingredient_lot_locations ; DROP FUNCTION
--   fn_sync_lot_locations ; retirer les emplacements MAGASIN / FRIGO créés ici.

CREATE TABLE IF NOT EXISTS ingredient_lot_locations (
  ingredient_lot_id UUID NOT NULL REFERENCES ingredient_lots(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ingredient_lot_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_lot_locations_location ON ingredient_lot_locations (location_id) WHERE quantity > 0;

-- Emplacements par établissement.
INSERT INTO stock_locations (store_id, code, name, type)
SELECT s.id, v.code, v.name, v.type FROM stores s
 CROSS JOIN (VALUES ('ECONOMAT', 'Économat (sec)', 'sec'), ('PESAGE', 'Zone de pesage', 'pesage'),
                    ('MAGASIN', 'Magasin', 'vitrine'), ('FRIGO', 'Frigo', 'positif')) AS v(code, name, type)
ON CONFLICT (store_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_sync_lot_locations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_store UUID := NEW.store_id; v_pes UUID; v_eco UUID;
BEGIN
  IF v_store IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_pes FROM stock_locations WHERE store_id = v_store AND code = 'PESAGE';
  SELECT COALESCE(
           (SELECT l.id FROM stock_locations l WHERE l.id = NEW.location_id AND l.code <> 'PESAGE'),
           (SELECT id FROM stock_locations WHERE store_id = v_store AND code = 'ECONOMAT')) INTO v_eco;
  IF v_eco IS NULL OR v_pes IS NULL THEN RETURN NEW; END IF;
  -- Un seul emplacement de stockage (hors pesage) porte la part économat du lot.
  DELETE FROM ingredient_lot_locations WHERE ingredient_lot_id = NEW.id AND location_id NOT IN (v_eco, v_pes);
  INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at)
  VALUES (NEW.id, v_eco, GREATEST(COALESCE(NEW.economat_quantity, 0), 0), NOW()),
         (NEW.id, v_pes, GREATEST(COALESCE(NEW.pesage_quantity, 0), 0), NOW())
  ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
  -- Transfert économat → pesage (ou retour) : la même quantité quitte une zone et entre
  -- dans l'autre → mouvement entre emplacements, quel que soit le chemin de code.
  IF TG_OP = 'UPDATE'
     AND abs((NEW.economat_quantity - OLD.economat_quantity) + (NEW.pesage_quantity - OLD.pesage_quantity)) < 0.0001
     AND abs(NEW.pesage_quantity - OLD.pesage_quantity) > 0.0001 THEN
    INSERT INTO stock_location_moves (ingredient_lot_id, from_location_id, to_location_id, quantite, motif)
    VALUES (NEW.id,
            CASE WHEN NEW.pesage_quantity > OLD.pesage_quantity THEN v_eco ELSE v_pes END,
            CASE WHEN NEW.pesage_quantity > OLD.pesage_quantity THEN v_pes ELSE v_eco END,
            abs(NEW.pesage_quantity - OLD.pesage_quantity),
            CASE WHEN NEW.pesage_quantity > OLD.pesage_quantity THEN 'transfert' ELSE 'retour' END);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_lot_locations ON ingredient_lots;
CREATE TRIGGER trg_sync_lot_locations
  AFTER INSERT OR UPDATE OF economat_quantity, pesage_quantity, location_id, store_id ON ingredient_lots
  FOR EACH ROW EXECUTE FUNCTION fn_sync_lot_locations();

-- Reprise : chaque lot existant reflété une fois, par insertion directe. Surtout pas
-- d'UPDATE sur ingredient_lots : il déclencherait trg_inventory_sync_lots, qui recalcule
-- inventory.current_quantity à partir des lots et modifierait le stock là où il diverge.
WITH loc AS (
  SELECT il.id, il.economat_quantity, il.pesage_quantity,
         (SELECT p.id FROM stock_locations p WHERE p.store_id = il.store_id AND p.code = 'PESAGE') AS pes,
         COALESCE((SELECT l.id FROM stock_locations l WHERE l.id = il.location_id AND l.code <> 'PESAGE'),
                  (SELECT e.id FROM stock_locations e WHERE e.store_id = il.store_id AND e.code = 'ECONOMAT')) AS eco
    FROM ingredient_lots il WHERE il.store_id IS NOT NULL
)
INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity)
SELECT id, eco, GREATEST(COALESCE(economat_quantity, 0), 0) FROM loc WHERE eco IS NOT NULL AND pes IS NOT NULL
UNION ALL
SELECT id, pes, GREATEST(COALESCE(pesage_quantity, 0), 0) FROM loc WHERE eco IS NOT NULL AND pes IS NOT NULL
ON CONFLICT (ingredient_lot_id, location_id) DO NOTHING;

CREATE OR REPLACE VIEW v_lot_location_balance AS
SELECT il.id AS ingredient_lot_id, il.quantity_remaining, il.economat_quantity + il.pesage_quantity AS zones_total,
       COALESCE(SUM(ll.quantity), 0) AS locations_total
  FROM ingredient_lots il LEFT JOIN ingredient_lot_locations ll ON ll.ingredient_lot_id = il.id
 GROUP BY il.id;
COMMENT ON VIEW v_lot_location_balance IS 'M6-02 : contrôle Σ emplacements = zones = quantité restante, lot par lot.';
