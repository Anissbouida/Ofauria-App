-- M5-05 — Référentiel équipement unique.
-- production_equipements est la fiche de l'équipement physique (four, pétrin, chambre
-- froide : puissance, suivi HACCP). Elle se rattache :
--   - à un poste de travail (work_center_id) : le poste regroupe ses équipements ;
--   - à une immobilisation (fixed_asset_id) : la comptabilité ;
-- et la maintenance pointe l'équipement (maintenance_interventions.equipment_id).
-- Arrêt de poste ↔ intervention : un arrêt peut ouvrir une demande d'intervention, une
-- intervention terminée sur l'équipement d'un poste crée l'arrêt correspondant.
-- Le rapprochement des fiches existantes (noms) est PROPOSÉ, jamais appliqué seul.

ALTER TABLE production_equipements
  ADD COLUMN IF NOT EXISTS work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fixed_asset_id UUID REFERENCES fixed_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipements_work_center ON production_equipements (work_center_id) WHERE work_center_id IS NOT NULL;

ALTER TABLE maintenance_interventions
  ADD COLUMN IF NOT EXISTS equipment_id UUID REFERENCES production_equipements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_center_downtime_id UUID REFERENCES work_center_downtime(id) ON DELETE SET NULL;
ALTER TABLE work_center_downtime
  ADD COLUMN IF NOT EXISTS intervention_id UUID REFERENCES maintenance_interventions(id) ON DELETE SET NULL;
