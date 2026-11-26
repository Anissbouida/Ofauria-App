-- 714 — Grilles tarifaires du transport (feuille de route, étape 3.4).
--
-- Une grille donne le prix d'une prestation selon une base (poids en kg, nombre de palettes,
-- distance en km) et des tranches : la tranche qui contient la quantité donne le prix
-- unitaire, plus un forfait éventuel ; le minimum de facturation s'applique en dernier.
-- Une grille peut être propre à un client (sinon générale) et à un trajet (zone de départ et
-- d'arrivée, libres). La facturation sur preuve de livraison existe déjà (bons de livraison,
-- pod_signature). Capacité grille_transport (module Ventes), éteinte par défaut, active dans
-- le profil transport.

CREATE TABLE IF NOT EXISTS freight_rate_grids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  basis VARCHAR(10) NOT NULL CHECK (basis IN ('weight', 'pallet', 'distance')),
  origin_zone VARCHAR(80),
  destination_zone VARCHAR(80),
  minimum_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_charge >= 0),
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tva_rate >= 0 AND tva_rate <= 100),
  valid_from DATE,
  valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS freight_rate_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id UUID NOT NULL REFERENCES freight_rate_grids(id) ON DELETE CASCADE,
  up_to NUMERIC(12,3),               -- borne haute incluse ; NULL = au-delà de la tranche précédente
  unit_price NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  flat_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (flat_price >= 0),
  CHECK (up_to IS NULL OR up_to > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_bracket_open ON freight_rate_brackets(grid_id) WHERE up_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_bracket_bound ON freight_rate_brackets(grid_id, up_to) WHERE up_to IS NOT NULL;

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('grille_transport', 'sales', 'Grilles tarifaires du transport',
   'Prix d''une prestation calculé par tranches de poids, de palettes ou de distance, avec minimum de facturation.', 395, 'fonction', '{}', false)
ON CONFLICT (key) DO NOTHING;
UPDATE sector_packs SET features = array_append(features, 'grille_transport')
 WHERE code = 'transport' AND NOT ('grille_transport' = ANY(features));
