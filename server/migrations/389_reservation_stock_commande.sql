-- Migration 389 : réservation de stock pour les commandes clients
--
-- POURQUOI
--   À la prise d'une commande, le sourcing (sourcing.helper) calcule la part
--   servie depuis le stock magasin (qty_from_stock) mais ne la « bloquait »
--   pas : deux commandes prises coup sur coup voyaient le même stock libre et
--   le promettaient toutes les deux. Le stock disponible à la vente était donc
--   surestimé entre la prise et la livraison.
--
-- PORTEE
--   1. product_store_stock.reserved_quantity : quantité (backroom) promise à des
--      commandes non encore livrées. Le disponible à la vente devient
--      stock_quantity − reserved_quantity.
--   2. order_stock_reservations : journal des réservations (une ligne par
--      ligne de commande servie depuis le stock), statut reserved/consumed/released.
--   3. Trigger sur orders : quand une commande devient 'completed' (livrée : le
--      stock réel est décrémenté par la vente / le BL) ou 'cancelled', ses
--      réservations actives sont soldées et reserved_quantity est relâché.
--      Centralisé en base pour couvrir TOUS les chemins (remise en caisse, bon
--      de livraison pro, annulation) sans les modifier un par un.
--
-- INVERSION
--   DROP TRIGGER IF EXISTS trg_resolve_order_reservations ON orders;
--   DROP FUNCTION IF EXISTS fn_resolve_order_reservations();
--   DROP TABLE IF EXISTS order_stock_reservations;
--   ALTER TABLE product_store_stock DROP COLUMN IF EXISTS reserved_quantity;

ALTER TABLE product_store_stock
  ADD COLUMN IF NOT EXISTS reserved_quantity DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- La réservation survit à une édition de commande (les lignes sont recréées) :
  -- rattachée à la commande, le lien vers la ligne est purement indicatif.
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  quantity DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_osr_order ON order_stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_osr_active ON order_stock_reservations(product_id, store_id) WHERE status = 'reserved';

CREATE OR REPLACE FUNCTION fn_resolve_order_reservations() RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Transition vers un état terminal (une seule fois) : solde les réservations.
  IF NEW.status IN ('completed', 'cancelled')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('completed', 'cancelled') THEN
    v_status := CASE WHEN NEW.status = 'completed' THEN 'consumed' ELSE 'released' END;

    -- Relâche le réservé sur le stock magasin (jamais sous zéro).
    UPDATE product_store_stock pss
       SET reserved_quantity = GREATEST(pss.reserved_quantity - agg.qty, 0),
           updated_at = now()
      FROM (
        SELECT product_id, store_id, SUM(quantity) AS qty
          FROM order_stock_reservations
         WHERE order_id = NEW.id AND status = 'reserved'
         GROUP BY product_id, store_id
      ) agg
     WHERE pss.product_id = agg.product_id AND pss.store_id = agg.store_id;

    UPDATE order_stock_reservations
       SET status = v_status, resolved_at = now()
     WHERE order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolve_order_reservations ON orders;
CREATE TRIGGER trg_resolve_order_reservations
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_resolve_order_reservations();
