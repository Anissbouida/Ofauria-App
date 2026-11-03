-- ═══════════════════════════════════════════════════════════════════════
-- 440 — Cycle de vente (O2C), lot L1 : sortie de stock et lots à l'expédition
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 5.4 (G-GI-01/02/03/13)
--
--   Le bon de livraison professionnel ne sortait aucun stock et ne portait
--   aucun lot : stock fantôme en réserve (puis fausse perte à la DLC) et
--   clients professionnels invisibles au rappel de lot. Désormais la création
--   du BL vaut expédition : affectation FEFO des lots de la réserve (puis de la
--   vitrine), lots enregistrés par ligne, stock décrémenté, mouvements
--   'delivery'. Annuler le BL remet les quantités dans leurs lots.
--
--   Invariant porté par la base, vérifié au COMMIT (trigger différé, comme une
--   contrainte DEFERRABLE INITIALLY DEFERRED en Oracle) : une ligne de BL qui
--   exige des lots (requires_lots, produit suivi par lots) est couverte à 100 %.
--   Les BL antérieurs (lots_tracked = false) ne sont pas repris.
--
--   Retours de caisse : sale_item_lots.returned_qty inverse la traçabilité au
--   lieu de laisser le rappel compter un produit rendu comme vendu.
--
-- Rollback : DROP TABLE delivery_note_item_lots ; DROP des colonnes ajoutées ;
--   DROP TRIGGER trg_dn_assert_lots ON delivery_notes.
-- ═══════════════════════════════════════════════════════════════════════

-- 'delivery_reversal' (17 caractères) dépasse l'ancienne largeur du type de mouvement de lot.
ALTER TABLE product_lot_movements ALTER COLUMN kind TYPE VARCHAR(20);

ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS lots_tracked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS shipped_by UUID REFERENCES users(id);
-- Les nouveaux BL sont suivis par lots ; l'historique garde false (pas de reprise).
ALTER TABLE delivery_notes ALTER COLUMN lots_tracked SET DEFAULT true;

ALTER TABLE delivery_note_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id);
ALTER TABLE delivery_note_items ADD COLUMN IF NOT EXISTS requires_lots BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_dni_order_item ON delivery_note_items (order_item_id);

CREATE TABLE IF NOT EXISTS delivery_note_item_lots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_item_id UUID NOT NULL REFERENCES delivery_note_items(id) ON DELETE CASCADE,
  product_lot_id        UUID NOT NULL REFERENCES product_lots(id) ON DELETE RESTRICT,
  quantity              NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  source                VARCHAR(8) NOT NULL CHECK (source IN ('backroom', 'vitrine')),
  dlc_snapshot          TIMESTAMPTZ,            -- DLC effective du lot au moment de l'expédition
  returned_qty          NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0 AND returned_qty <= quantity),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_note_item_id, product_lot_id, source)
);
CREATE INDEX IF NOT EXISTS idx_dnil_lot ON delivery_note_item_lots (product_lot_id);

-- Ligne exigeant des lots : couverte à 100 % au COMMIT d'un BL suivi par lots et non annulé.
CREATE OR REPLACE FUNCTION fn_dn_assert_lots() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_bad RECORD;
BEGIN
  IF NEW.lots_tracked AND NEW.status <> 'cancelled' THEN
    SELECT dni.description, dni.quantity, COALESCE(SUM(l.quantity), 0) AS covered INTO v_bad
      FROM delivery_note_items dni
      LEFT JOIN delivery_note_item_lots l ON l.delivery_note_item_id = dni.id
     WHERE dni.delivery_note_id = NEW.id AND dni.requires_lots
     GROUP BY dni.id, dni.description, dni.quantity
    HAVING ABS(COALESCE(SUM(l.quantity), 0) - dni.quantity) > 0.0005
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'BL % : « % » non couvert par des lots (% sur %)', NEW.number, v_bad.description, v_bad.covered, v_bad.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_dn_assert_lots ON delivery_notes;
CREATE CONSTRAINT TRIGGER trg_dn_assert_lots AFTER INSERT OR UPDATE ON delivery_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_dn_assert_lots();

ALTER TABLE sale_item_lots ADD COLUMN IF NOT EXISTS returned_qty NUMERIC(12,3) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE sale_item_lots ADD CONSTRAINT sale_item_lots_returned_qty_check CHECK (returned_qty >= 0 AND returned_qty <= quantity);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lot épuisé qui récupère des quantités (annulation d'expédition, retour en caisse) :
-- il redevient actif s'il n'est pas périmé. Avant, il restait « épuisé », invisible du
-- FEFO, et un article rendu partait en perte.
CREATE OR REPLACE FUNCTION check_product_lot_invariant() RETURNS trigger
LANGUAGE plpgsql AS $$
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

  -- Retour en stock d'un lot épuisé non périmé : de nouveau actif (O2C L1, mig 440).
  IF OLD.status = 'depleted' AND NEW.status = 'depleted' AND NEW.backroom_qty + NEW.vitrine_qty > 0
     AND (CASE WHEN NEW.dlc_effective IS NOT NULL THEN NEW.dlc_effective > now()
               ELSE NEW.expires_at IS NULL OR NEW.expires_at > CURRENT_DATE END) THEN
    NEW.status := 'active';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
