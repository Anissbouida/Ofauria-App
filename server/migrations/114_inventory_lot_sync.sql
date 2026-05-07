-- Sync automatique inventory.current_quantity <- SUM(ingredient_lots) actifs
-- Probleme initial : markAsWaste / sendToLosses / markDepleted / consumeFEFO mettent
-- a jour les lots mais pas inventory.current_quantity, creant un desync silencieux.
-- (Cas vu : LOT-2026-00048 wasted, mais inventory.current_quantity = 0.79 kg).
--
-- Strategie : un seul point de verite (les lots actifs). inventory.current_quantity
-- devient un cache derivable maintenu par trigger DB. Tout code applicatif qui
-- modifie les lots (present ou futur) reste correct sans sync manuel.

-- ─── Fonction de sync : recalcule inventory pour (ingredient_id, store_id) ─
CREATE OR REPLACE FUNCTION sync_inventory_from_lots(p_ingredient_id uuid, p_store_id uuid)
RETURNS void AS $$
BEGIN
  -- Total = SUM(economat + pesage) sur lots actifs uniquement (meme semantique
  -- que v_ingredient_stock et que la file FEFO du BSI).
  UPDATE inventory inv
     SET current_quantity = COALESCE((
           SELECT SUM(l.economat_quantity + l.pesage_quantity)
           FROM ingredient_lots l
           WHERE l.ingredient_id = p_ingredient_id
             AND l.store_id = p_store_id
             AND l.status = 'active'
         ), 0),
         updated_at = NOW()
   WHERE inv.ingredient_id = p_ingredient_id
     AND inv.store_id = p_store_id;

  -- Si aucune ligne inventory n'existe pour ce couple, on en cree une seulement
  -- s'il y a effectivement du stock dans des lots. Evite de polluer inventory
  -- avec des entrees a 0 pour des ingredients jamais inventories.
  IF NOT FOUND THEN
    INSERT INTO inventory (ingredient_id, store_id, current_quantity, minimum_threshold)
    SELECT p_ingredient_id, p_store_id,
           COALESCE(SUM(l.economat_quantity + l.pesage_quantity), 0), 0
      FROM ingredient_lots l
     WHERE l.ingredient_id = p_ingredient_id
       AND l.store_id = p_store_id
       AND l.status = 'active'
    HAVING COALESCE(SUM(l.economat_quantity + l.pesage_quantity), 0) > 0;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Trigger : sync apres toute modif de quantites ou statut sur ingredient_lots
CREATE OR REPLACE FUNCTION trg_sync_inventory_from_lots()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT ou UPDATE qui change qty/statut → resync.
  -- DELETE → resync sur l'ancien (ingredient, store) au cas ou ce lot etait actif.
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_inventory_from_lots(OLD.ingredient_id, OLD.store_id);
    RETURN OLD;
  END IF;

  PERFORM sync_inventory_from_lots(NEW.ingredient_id, NEW.store_id);

  -- Si l'UPDATE change l'ingredient ou le store (rare mais possible), re-sync l'ancien aussi.
  IF TG_OP = 'UPDATE' AND (OLD.ingredient_id <> NEW.ingredient_id OR OLD.store_id <> NEW.store_id) THEN
    PERFORM sync_inventory_from_lots(OLD.ingredient_id, OLD.store_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_sync_lots ON ingredient_lots;
CREATE TRIGGER trg_inventory_sync_lots
  AFTER INSERT OR UPDATE OF economat_quantity, pesage_quantity, status, ingredient_id, store_id
                  OR DELETE
                ON ingredient_lots
  FOR EACH ROW EXECUTE FUNCTION trg_sync_inventory_from_lots();

-- ─── Backfill : corrige le desync existant pour tous les couples (ingredient, store)
-- On parcourt tous les inventaires existants ET tous les couples qui ont des lots,
-- pour couvrir les deux cas (inventory existe sans lots / lots sans inventory).
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT ingredient_id, store_id FROM inventory WHERE store_id IS NOT NULL
    UNION
    SELECT DISTINCT ingredient_id, store_id FROM ingredient_lots WHERE store_id IS NOT NULL
  LOOP
    PERFORM sync_inventory_from_lots(rec.ingredient_id, rec.store_id);
  END LOOP;
END $$;

COMMENT ON FUNCTION sync_inventory_from_lots(uuid, uuid) IS
  'Recalcule inventory.current_quantity = SUM(economat+pesage) des lots status=active pour (ingredient, store). Source de verite = lots.';
COMMENT ON TRIGGER trg_inventory_sync_lots ON ingredient_lots IS
  'Sync automatique inventory.current_quantity quand un lot change (qty, statut, ingredient/store). Empeche le desync vu sur LOT-2026-00048 (waste sans sync).';
