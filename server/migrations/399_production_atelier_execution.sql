-- 399 — Exécution d'atelier : poste, opérateur et pause sur les étapes (roadmap lot 4)
--
-- Les étapes (mig 089/342) savaient déjà QUI a démarré/terminé (started_by/
-- completed_by) et COMBIEN de temps (duree_reelle_min), mais pas SUR QUEL POSTE
-- ni suivre une pause. On ajoute :
--   - work_center_id       : le poste où l'étape est exécutée (mig 388) → permet un
--     tableau de bord atelier « qui fait quoi, sur quel poste, maintenant » et, à
--     terme, un écart standard/réel par poste.
--   - assigned_employee_id : l'opérateur affecté (mig employees) — distinct de
--     started_by/completed_by (comptes utilisateurs) qui alimentent le coût réel.
--   - paused_at / pause_accumulee_min : pause/reprise d'une étape en cours. Le temps
--     de pause est RETIRÉ de la durée réelle à la clôture, pour que le coût de
--     main-d'œuvre (mig 090 / écart lot 1) ne compte pas les interruptions.
--
-- Le coût réel MO (production-cout.repository) lit déjà les étapes complétées :
-- aucune ressaisie n'est nécessaire, la pause le rend seulement plus juste.
--
-- INVERSION :
--   ALTER TABLE production_item_etapes
--     DROP COLUMN IF EXISTS pause_accumulee_min,
--     DROP COLUMN IF EXISTS paused_at,
--     DROP COLUMN IF EXISTS assigned_employee_id,
--     DROP COLUMN IF EXISTS work_center_id;

ALTER TABLE production_item_etapes
  ADD COLUMN IF NOT EXISTS work_center_id       UUID REFERENCES work_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paused_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_accumulee_min  INTEGER NOT NULL DEFAULT 0 CHECK (pause_accumulee_min >= 0);

COMMENT ON COLUMN production_item_etapes.work_center_id IS
  'Poste de travail (mig 388) où l''étape est exécutée (tableau de bord atelier, mig 399).';
COMMENT ON COLUMN production_item_etapes.assigned_employee_id IS
  'Opérateur affecté à l''étape (mig 399) ; distinct de started_by/completed_by (comptes).';
COMMENT ON COLUMN production_item_etapes.paused_at IS
  'Début de la pause en cours (NULL si l''étape n''est pas en pause) (mig 399).';
COMMENT ON COLUMN production_item_etapes.pause_accumulee_min IS
  'Minutes de pause cumulées, retirées de la durée réelle à la clôture (mig 399).';

CREATE INDEX IF NOT EXISTS idx_pie_work_center ON production_item_etapes (work_center_id)
  WHERE work_center_id IS NOT NULL;
