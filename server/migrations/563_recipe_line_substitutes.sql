-- M4-05 — Substituts d'article.
-- Un composant de fiche peut être remplacé par un autre article, avec un ratio
-- (quantité de substitut pour 1 unité d'origine), une priorité et une validité.
-- recipe_id NULL = substitut valable pour toutes les fiches.
-- Au bon de sortie, une ligne non pesée peut basculer sur le substitut : la ligne
-- porte alors l'article réellement consommé (lots, coût, traçabilité) et garde
-- l'article d'origine pour la trace.

CREATE TABLE IF NOT EXISTS recipe_line_substitutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  substitute_ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  ratio NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (ratio > 0),
  priority INTEGER NOT NULL DEFAULT 1 CHECK (priority > 0),
  valid_from DATE,
  valid_to DATE,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_substitute_distinct CHECK (ingredient_id <> substitute_ingredient_id),
  CONSTRAINT chk_substitute_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_line_substitutes
  ON recipe_line_substitutes (COALESCE(recipe_id, '00000000-0000-0000-0000-000000000000'::uuid), ingredient_id, substitute_ingredient_id);
CREATE INDEX IF NOT EXISTS idx_recipe_line_substitutes_ing ON recipe_line_substitutes (ingredient_id);

ALTER TABLE production_bons_sortie_lignes
  ADD COLUMN IF NOT EXISTS original_ingredient_id UUID REFERENCES ingredients(id),
  ADD COLUMN IF NOT EXISTS original_needed_quantity NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS substitution_id UUID REFERENCES recipe_line_substitutes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS substituted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS substituted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS substitution_reason TEXT;

COMMENT ON COLUMN production_bons_sortie_lignes.original_ingredient_id IS
  'M4-05 : article prévu par la fiche quand la ligne a basculé sur un substitut ; ingredient_id porte alors l''article réellement consommé.';
