-- G2-06 (plan d'action 2026-11) — allergènes des ingrédients : contient, traces, vérifié.
--
-- ingredients.allergens (mig 004, référentiel fermé mig 344) ne porte que « contient ».
-- Une liste vide ne dit pas si l'ingrédient n'a AUCUN allergène ou s'il n'a JAMAIS été
-- renseigné : impossible d'imprimer une étiquette sur cette base. Trois ajouts :
--
--   allergen_traces       : allergènes présents à l'état de traces (« peut contenir »),
--                           même référentiel de 14 codes ; jamais en double avec allergens
--   allergens_reviewed_at : date de la vérification ; NULL = non renseigné
--   allergens_reviewed_by : qui a vérifié
--
-- États d'un ingrédient pour un allergène : contient (dans allergens), traces (dans
-- allergen_traces), absent (dans aucun des deux ET fiche vérifiée), non renseigné (fiche
-- jamais vérifiée et sans allergène).
--
-- Rien n'est rempli ici : une fiche qui a déjà des allergènes compte comme renseignée,
-- les autres restent « non renseigné » jusqu'à leur vérification dans la grille
-- (Paramètres › Qualité des données › Allergènes).
--
-- INVERSION : ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_allergen_traces,
--               DROP CONSTRAINT IF EXISTS chk_ingredients_allergen_overlap,
--               DROP COLUMN IF EXISTS allergen_traces, DROP COLUMN IF EXISTS allergens_reviewed_at,
--               DROP COLUMN IF EXISTS allergens_reviewed_by;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS allergen_traces       text[] NOT NULL DEFAULT '{}';
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS allergens_reviewed_at timestamptz;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS allergens_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ingredients_allergen_traces') THEN
    ALTER TABLE ingredients ADD CONSTRAINT chk_ingredients_allergen_traces
      CHECK (allergen_traces <@ ARRAY['gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait',
                                      'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ingredients_allergen_overlap') THEN
    -- Un allergène est « contient » OU « traces », pas les deux.
    ALTER TABLE ingredients ADD CONSTRAINT chk_ingredients_allergen_overlap
      CHECK (allergens IS NULL OR NOT (allergens && allergen_traces));
  END IF;
END $$;
