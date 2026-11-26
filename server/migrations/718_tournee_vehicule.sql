-- 718 — Véhicule et kilométrage des tournées (feuille de route, étape 6.2).
--
-- Une tournée porte le véhicule utilisé (même libellé que l'équipement des plans d'entretien)
-- et ses kilomètres au départ et au retour. À la clôture, le kilométrage de retour devient un
-- relevé de compteur pour les plans d'entretien au kilomètre de ce véhicule (mig 717).
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS vehicle_label VARCHAR(120);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS km_start NUMERIC(12,1) CHECK (km_start IS NULL OR km_start >= 0);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS km_end NUMERIC(12,1) CHECK (km_end IS NULL OR km_end >= 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_routes_km') THEN
    ALTER TABLE delivery_routes ADD CONSTRAINT chk_delivery_routes_km CHECK (km_end IS NULL OR km_start IS NULL OR km_end >= km_start);
  END IF;
END $$;
