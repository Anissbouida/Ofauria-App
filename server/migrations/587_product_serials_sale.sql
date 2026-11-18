-- ═══════════════════════════════════════════════════════════════════════
-- 587 — Numéros de série : statut « vendu » à la vente (M9)
--
--   Une vente trace ses lots dans sale_item_lots (mig 337). Pour un lot d'article suivi
--   par série (mig 585), autant de numéros que de pièces vendues passent « vendu » et sont
--   rattachés à la ligne de vente (les plus anciens numéros d'abord). Un retour (returned_qty
--   augmente) les remet en stock ; une ligne supprimée aussi.
--   Tous les chemins de vente (caisse, échange, vente pro) passent par sale_item_lots :
--   aucun code appelant ne change.
--
-- INVERSION
--   DROP TRIGGER trg_product_serials_sale_ins, trg_product_serials_sale_ret, trg_product_serials_sale_del ON sale_item_lots ;
--   DROP FUNCTION fn_product_serials_follow_sale() ;
--   ALTER TABLE product_serials DROP COLUMN sale_item_id.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE product_serials ADD COLUMN IF NOT EXISTS sale_item_id uuid REFERENCES sale_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_serials_sale_item ON product_serials (sale_item_id) WHERE sale_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_product_serials_follow_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    n := floor(NEW.quantity)::int;
    IF n > 0 THEN
      UPDATE product_serials SET status = 'sold', sale_item_id = NEW.sale_item_id
       WHERE id IN (SELECT id FROM product_serials
                     WHERE product_lot_id = NEW.product_lot_id AND status = 'in_stock'
                     ORDER BY serial_number LIMIT n);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    n := floor(COALESCE(NEW.returned_qty, 0))::int - floor(COALESCE(OLD.returned_qty, 0))::int;
    IF n > 0 THEN
      UPDATE product_serials SET status = 'in_stock', sale_item_id = NULL
       WHERE id IN (SELECT id FROM product_serials
                     WHERE product_lot_id = NEW.product_lot_id AND sale_item_id = NEW.sale_item_id AND status = 'sold'
                     ORDER BY serial_number DESC LIMIT n);
    END IF;
    RETURN NEW;
  ELSE
    UPDATE product_serials SET status = 'in_stock', sale_item_id = NULL
     WHERE product_lot_id = OLD.product_lot_id AND sale_item_id = OLD.sale_item_id AND status = 'sold';
    RETURN OLD;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_product_serials_sale_ins ON sale_item_lots;
CREATE TRIGGER trg_product_serials_sale_ins AFTER INSERT ON sale_item_lots
  FOR EACH ROW EXECUTE FUNCTION fn_product_serials_follow_sale();
DROP TRIGGER IF EXISTS trg_product_serials_sale_ret ON sale_item_lots;
CREATE TRIGGER trg_product_serials_sale_ret AFTER UPDATE OF returned_qty ON sale_item_lots
  FOR EACH ROW EXECUTE FUNCTION fn_product_serials_follow_sale();
DROP TRIGGER IF EXISTS trg_product_serials_sale_del ON sale_item_lots;
CREATE TRIGGER trg_product_serials_sale_del AFTER DELETE ON sale_item_lots
  FOR EACH ROW EXECUTE FUNCTION fn_product_serials_follow_sale();
