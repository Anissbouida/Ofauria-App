-- G0-24 (plan d'action 2026-11) — saisies de la fenêtre de lancement.
--
-- Les observations du chef et les quantités de bases partagées qu'il déclarait au
-- lancement n'étaient envoyées nulle part : elles étaient perdues à la fermeture de la
-- fenêtre. Elles sont désormais enregistrées avec la déclaration de production, dans
-- la même transaction.
--   note  : observation libre du chef.
--   bases : [{ subRecipeId, actualQuantity, alreadyProduced }] — bases partagées entre
--           plusieurs produits, telles que saisies (constat, sans effet de stock).
CREATE TABLE IF NOT EXISTS production_plan_observations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  note       text,
  bases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_production_plan_observations_content CHECK (note IS NOT NULL OR jsonb_array_length(bases) > 0)
);
CREATE INDEX IF NOT EXISTS idx_production_plan_observations_plan ON production_plan_observations (plan_id, created_at);
