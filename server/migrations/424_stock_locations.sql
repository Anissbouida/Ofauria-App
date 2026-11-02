-- 424 — Référentiel d'emplacements de stock (épic labo L1, partie 1 : socle)
--
-- POURQUOI
--   Kalum connaît deux ZONES LOGIQUES codées en dur (ECONOMAT / PESAGE, mig 113)
--   et les enceintes froides comme ÉQUIPEMENT coûté (production_equipements), mais
--   pas comme LIEU de stockage. Le chef veut déclarer ses emplacements réels
--   (chambre positive CF-01, négative CF-02, étagères, bacs, vitrine, pesage) et
--   savoir OÙ est chaque lot — socle du froid, du HACCP par enceinte et de
--   l'inventaire par zone.
--
-- QUOI
--   1. stock_locations : référentiel hiérarchique (parent → enfant), typé, relié
--      à une enceinte HACCP (sonde) dont il hérite la plage de température.
--   2. ingredient_lots.location_id : emplacement courant d'un lot matière.
--   3. stock_location_moves : historique des déplacements d'un lot entre
--      emplacements (distinct des transferts de ZONE logique éco↔pesage, mig 113,
--      qui restent la source du BSI — cf. partie 2).
--   La localisation des lots et le relâchement du couplage de zone arrivent en
--   partie 2 ; le lien relevé HACCP → lots présents en partie 3.
--
-- INVERSION :
--   ALTER TABLE ingredient_lots DROP COLUMN location_id;
--   DROP TABLE stock_location_moves; DROP TABLE stock_locations;

CREATE TABLE IF NOT EXISTS stock_locations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID REFERENCES stores(id) ON DELETE CASCADE,
  code           VARCHAR(30) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  type           VARCHAR(12) NOT NULL
    CHECK (type IN ('sec', 'positif', 'negatif', 'pesage', 'vitrine', 'labo')),
  parent_id      UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  equipement_id  UUID REFERENCES production_equipements(id) ON DELETE SET NULL,
  temp_min       NUMERIC(5,1),   -- NULL = hérite de l'équipement lié
  temp_max       NUMERIC(5,1),
  capacite_unite VARCHAR(10) CHECK (capacite_unite IS NULL OR capacite_unite IN ('bac', 'plaque', 'kg')),
  capacite_valeur NUMERIC(10,2) CHECK (capacite_valeur IS NULL OR capacite_valeur >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, code)
);
CREATE INDEX IF NOT EXISTS idx_stock_locations_store ON stock_locations(store_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_stock_locations_parent ON stock_locations(parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE ingredient_lots
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ingredient_lots_location ON ingredient_lots(location_id) WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_location_moves (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_lot_id UUID NOT NULL REFERENCES ingredient_lots(id) ON DELETE CASCADE,
  from_location_id  UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  to_location_id    UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  quantite          NUMERIC(12,4),
  contenants        INTEGER,
  motif             VARCHAR(30),   -- reception | transfert | retour | inventaire | requalification
  moved_by          UUID REFERENCES users(id),
  moved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_location_id IS DISTINCT FROM to_location_id)
);
CREATE INDEX IF NOT EXISTS idx_location_moves_lot ON stock_location_moves(ingredient_lot_id, moved_at DESC);

COMMENT ON TABLE stock_locations IS
  'Référentiel d''emplacements de stock (épic labo L1, mig 424) : hiérarchique, typé, relié à une enceinte HACCP dont il hérite la plage de température.';

-- ─── Seed : zones logiques + une enceinte par équipement froid ──────────────
-- Rejouable (ON CONFLICT sur (store_id, code)). Donne un référentiel utilisable
-- sans ressaisie : ECONOMAT (sec) et PESAGE par magasin, plus une chambre par
-- équipement frigo/surgelé actif (plage héritée de l'équipement).
DO $$
DECLARE s RECORD; e RECORD;
BEGIN
  FOR s IN SELECT id FROM stores LOOP
    INSERT INTO stock_locations (store_id, code, name, type)
    VALUES (s.id, 'ECONOMAT', 'Économat (sec)', 'sec'),
           (s.id, 'PESAGE',   'Zone de pesage', 'pesage')
    ON CONFLICT (store_id, code) DO NOTHING;
  END LOOP;

  FOR e IN
    SELECT id, nom, type, temp_min, temp_max, store_id
      FROM production_equipements
     WHERE is_active AND type IN ('frigo', 'surgele')
  LOOP
    INSERT INTO stock_locations (store_id, code, name, type, equipement_id, temp_min, temp_max)
    VALUES (
      COALESCE(e.store_id, (SELECT id FROM stores LIMIT 1)),
      'EQ-' || left(e.id::text, 8),
      e.nom,
      CASE WHEN e.type = 'surgele' THEN 'negatif' ELSE 'positif' END,
      e.id, e.temp_min, e.temp_max
    )
    ON CONFLICT (store_id, code) DO NOTHING;
  END LOOP;
END $$;
