-- 387 — Tournées de livraison
--
-- Regroupe des bons de livraison (mig 352) en une tournée datée, avec un ordre de
-- passage et un suivi livré/non livré par arrêt. (ERPNext « Delivery Trip ».)
--
-- Rollback : DROP TABLE delivery_route_stops, delivery_routes ;

CREATE TABLE IF NOT EXISTS delivery_routes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       VARCHAR(120) NOT NULL,
  route_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  driver_name VARCHAR(120),
  status      VARCHAR(12) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done')),
  notes       TEXT,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_date ON delivery_routes (route_date DESC);

CREATE TABLE IF NOT EXISTS delivery_route_stops (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id         UUID NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
  delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  sequence         INTEGER NOT NULL DEFAULT 0,
  delivered_at     TIMESTAMPTZ,
  note             TEXT,
  UNIQUE (route_id, delivery_note_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_route ON delivery_route_stops (route_id, sequence);
