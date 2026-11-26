-- 726 — Ordre de transport distinct de la commande (feuille de route, étape 6.2).
--
-- Un ordre de transport est la demande d'un client chargeur : enlever une marchandise à une
-- adresse et la livrer à une autre. Il n'est ni une commande de produits ni un bon de
-- livraison : il porte le trajet, la marchandise (poids, palettes, distance), le prix calculé
-- par la grille tarifaire (mig 714), la tournée et la preuve de livraison. Une fois livré, il
-- se facture.
--
-- Cycle : draft (saisi) → planned (affecté à une tournée) → in_transit (enlevé) → delivered
-- (preuve de livraison) ; cancelled avant l'enlèvement.
-- Capacité ordre_transport (module Ventes), éteinte par défaut, active dans le profil transport.
--
-- Rollback : DROP TABLE transport_orders ; DELETE FROM document_sequences WHERE doc_type = 'transport_order' ;
--   DELETE FROM app_features WHERE key = 'ordre_transport'.

CREATE TABLE IF NOT EXISTS transport_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            VARCHAR(40) NOT NULL UNIQUE,
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'planned', 'in_transit', 'delivered', 'cancelled')),
  pickup_address    TEXT NOT NULL,
  delivery_address  TEXT NOT NULL,
  origin_zone       VARCHAR(80),
  destination_zone  VARCHAR(80),
  pickup_date       DATE,
  delivery_date     DATE,
  goods_description TEXT,
  weight_kg         NUMERIC(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  pallets           NUMERIC(10,2) CHECK (pallets IS NULL OR pallets >= 0),
  distance_km       NUMERIC(10,2) CHECK (distance_km IS NULL OR distance_km >= 0),
  pricing_basis     VARCHAR(10) CHECK (pricing_basis IS NULL OR pricing_basis IN ('weight', 'pallet', 'distance')),
  grid_id           UUID REFERENCES freight_rate_grids(id) ON DELETE SET NULL,
  amount_ht         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_ht >= 0),
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_ttc         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
  route_id          UUID REFERENCES delivery_routes(id) ON DELETE SET NULL,
  picked_up_at      TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  pod_name          VARCHAR(120),
  pod_note          TEXT,
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La preuve de livraison est exigée à la livraison.
  CHECK (status <> 'delivered' OR (delivered_at IS NOT NULL AND pod_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_transport_orders_status ON transport_orders (status, pickup_date);
CREATE INDEX IF NOT EXISTS idx_transport_orders_route ON transport_orders (route_id) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transport_orders_customer ON transport_orders (customer_id);
COMMENT ON TABLE transport_orders IS 'Ordre de transport d''un client chargeur, distinct de la commande (mig 726).';

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('transport_order', 'Ordre de transport', 'sales', 'OT-{YYYY}-{SEQ}', 4, 'year', 'transport_orders', 'number', false, 98)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('ordre_transport', 'sales', 'Ordres de transport',
   'Demandes d''enlèvement et de livraison d''un client chargeur : trajet, marchandise, prix par la grille, tournée, preuve de livraison, facturation.', 396, 'fonction', '{}', false)
ON CONFLICT (key) DO NOTHING;
UPDATE sector_packs SET features = array_append(features, 'ordre_transport')
 WHERE code = 'transport' AND NOT ('ordre_transport' = ANY(features));
