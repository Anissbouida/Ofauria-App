-- G2-04 (plan d'action 2026-11) — corrections tracées du coût unitaire d'un ingrédient.
--
-- Un prix catalogue aberrant (« Chocolat bâton » à 6,60 DH, « Noisette » à 2 DH/kg) fausse
-- le coût de toutes les fiches qui utilisent l'ingrédient. Le corriger par un UPDATE direct
-- ne laisse ni motif ni justificatif. Chaque correction passe désormais par
-- repositories/ingredient-cost-correction.repository.ts, qui écrit ici :
--
--   old_cost / new_cost : coût avant et après
--   reason              : motif saisi (obligatoire)
--   basis               : pièces à l'appui au moment de la correction — les dernières
--                         réceptions (date, quantité, prix) et la médiane de la catégorie
--
-- Le coût catalogue sert au coût des fiches techniques. La valeur du stock, elle, vient du
-- coût des lots : cette correction ne passe AUCUNE écriture comptable et ne touche aucun lot.
--
-- INVERSION : DROP TABLE ingredient_cost_corrections;
CREATE TABLE IF NOT EXISTS ingredient_cost_corrections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  old_cost      numeric(12,4) NOT NULL,
  new_cost      numeric(12,4) NOT NULL,
  reason        text NOT NULL,
  basis         jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  corrected_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cost_correction_positive CHECK (new_cost > 0),
  CONSTRAINT chk_cost_correction_reason CHECK (length(btrim(reason)) >= 5)
);
CREATE INDEX IF NOT EXISTS idx_cost_corrections_ingredient ON ingredient_cost_corrections (ingredient_id, corrected_at DESC);
