-- 717 — Chantiers, exploitation et flotte (feuille de route, phase 6).
--
-- Audit court : le module Projets porte déjà temps, tâches, factures (mig 390) et achats engagés
-- (mig 716) ; les tournées de livraison (bons de livraison, chauffeur) et la maintenance
-- (plans périodiques, interventions, immobilisations) existent. Manquaient :
--   1. le vocabulaire : Projets s'appelle « Chantiers » en BTP, Maintenance « Flotte et
--      entretien » en transport (clés projects/project/maintenance du vocabulaire) ;
--   2. l'entretien au compteur (véhicules, engins) : un plan peut se déclencher tous les N km
--      ou N heures, en plus ou à la place d'une périodicité en jours ; relevés de compteur.

INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES
  ('btp', 'projects', 'Chantiers'),
  ('btp', 'project', 'Chantier'),
  ('transport', 'maintenance', 'Flotte et entretien'),
  ('transport', 'projects', 'Contrats'),
  ('transport', 'project', 'Contrat')
ON CONFLICT (sector_pack, label_key) DO NOTHING;

ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS meter_unit VARCHAR(4) CHECK (meter_unit IN ('km', 'h'));
ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS meter_interval NUMERIC(12,1) CHECK (meter_interval IS NULL OR meter_interval > 0);
ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS last_service_meter NUMERIC(12,1);
ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS current_meter NUMERIC(12,1);
ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS current_meter_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_maintenance_plans_meter') THEN
    ALTER TABLE maintenance_plans ADD CONSTRAINT chk_maintenance_plans_meter CHECK ((meter_unit IS NULL) = (meter_interval IS NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS maintenance_meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
  reading NUMERIC(12,1) NOT NULL CHECK (reading >= 0),
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_meter_readings_plan ON maintenance_meter_readings(plan_id, read_at DESC);
