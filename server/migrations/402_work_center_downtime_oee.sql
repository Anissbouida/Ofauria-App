-- 402 — Statut des postes & arrêts machine (TRS/OEE) (Production, roadmap lot 7)
--
-- Ajoute le STATUT d'un poste (en production, à l'arrêt, maintenance…) et un
-- journal des ARRÊTS avec motif, pour suivre la disponibilité et un indicateur
-- type TRS/OEE.
--
-- TRS (calculé à la volée, cf. routing.repository.getOee) :
--   - Disponibilité = (temps planifié − arrêts) / temps planifié
--       temps planifié = capacity_minutes_per_day (mig 398) × jours d'activité du poste.
--   - Performance   = Σ durée estimée / Σ durée réelle des étapes terminées du poste
--       (étapes rattachées au poste depuis mig 399).
--   - TRS ≈ Disponibilité × Performance. (La qualité n'est pas rattachable au poste
--     aujourd'hui — elle reste au niveau du plan via le rendement ; non incluse.)
--
-- INVERSION :
--   DROP TABLE IF EXISTS work_center_downtime;
--   ALTER TABLE work_centers DROP COLUMN IF EXISTS status;

ALTER TABLE work_centers
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'idle'
    CHECK (status IN ('production', 'off', 'idle', 'probleme', 'maintenance', 'reglage'));

CREATE TABLE IF NOT EXISTS work_center_downtime (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
  from_time      TIMESTAMPTZ NOT NULL,
  to_time        TIMESTAMPTZ,
  reason         VARCHAR(40) NOT NULL
                 CHECK (reason IN ('panne', 'maintenance', 'reglage', 'electricite', 'operateur', 'rupture', 'autre')),
  operator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_wcd_order CHECK (to_time IS NULL OR to_time >= from_time)
);
CREATE INDEX IF NOT EXISTS idx_wcd_center_time ON work_center_downtime (work_center_id, from_time DESC);

COMMENT ON COLUMN work_centers.status IS
  'Statut courant du poste : production/off/idle/probleme/maintenance/reglage (mig 402).';
COMMENT ON TABLE work_center_downtime IS
  'Arrêts machine (motif, période) par poste, base de la disponibilité / TRS (mig 402).';
