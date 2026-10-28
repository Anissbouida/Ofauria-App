-- 373 — Tickets en attente à la caisse.
--
-- Un client s'écarte (cherche sa carte, hésite) : la caissière met le panier de côté et
-- sert le suivant, puis le reprend. Le panier est stocké tel quel (lignes JSON), par
-- magasin ; il survit à un rechargement et se reprend depuis n'importe quel poste du
-- magasin. Rien n'est vendu ni décrémenté tant que le ticket n'est pas encaissé.
--
-- Rollback : DROP TABLE pos_parked_tickets ;

CREATE TABLE IF NOT EXISTS pos_parked_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_label VARCHAR(160),
  label          VARCHAR(80),
  channel_id     UUID,
  coupon_code    VARCHAR(40),
  sachets_given  SMALLINT,
  -- Lignes du panier au format de la caisse : [{productId, name, price, quantity, unit, displayUnit}]
  items          JSONB NOT NULL,
  item_count     INTEGER NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_parked_store ON pos_parked_tickets (store_id, created_at);
COMMENT ON TABLE pos_parked_tickets IS 'Paniers mis de côté à la caisse (mig 373) : repris ou supprimés, jamais comptés comme ventes.';
