-- Épic labo L6 — Rétro-planning par temps de procédé (E4 / F4.5).
-- À partir de l'heure de mise en vitrine, on remonte étape par étape (apprêt,
-- tourage, pointage, surgélation…) via duree_estimee_min pour dater chaque étape.
-- Additif : planned_start / planned_end sur l'étape instanciée + heure de vitrine
-- cible par article (défaut 07:00 appliqué par l'ordonnanceur quand NULL).

ALTER TABLE production_item_etapes
  ADD COLUMN IF NOT EXISTS planned_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_end   TIMESTAMPTZ;

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS heure_vitrine_cible TIME;

-- Lecture du planning d'un plan (étapes datées, tri chronologique).
CREATE INDEX IF NOT EXISTS idx_pie_planned_start
  ON production_item_etapes (planned_start)
  WHERE planned_start IS NOT NULL;
