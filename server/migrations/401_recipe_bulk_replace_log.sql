-- 401 — Journal annulable du remplacement de composant en masse (roadmap lot 6)
--
-- Outil « BOM Update Tool » : remplacer un ingrédient A par un ingrédient B sur
-- toutes les recettes qui l'utilisent, en une action. Un ingrédient apparaît dans
-- trois tables : recipe_ingredients (direct), recipe_components (mode compose) et
-- recipe_format_components (par format). Le remplacement bascule A→B dans les trois.
--
-- Ce journal garde, pour CHAQUE opération, les ids de lignes réellement modifiées
-- (par table) afin de pouvoir ANNULER proprement (restaurer A sur exactement ces
-- lignes, et seulement si elles pointent encore sur B). Même esprit que le journal
-- annulable de l'import générique (mig 369/370).
--
-- INVERSION : DROP TABLE IF EXISTS recipe_bulk_replace_log;

CREATE TABLE IF NOT EXISTS recipe_bulk_replace_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  target_ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  -- { "recipe_ingredients": [uuid...], "recipe_components": [uuid...], "recipe_format_components": [uuid...] }
  affected             JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipes_count        INTEGER NOT NULL DEFAULT 0,
  rows_count           INTEGER NOT NULL DEFAULT 0,
  performed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at          TIMESTAMPTZ,
  reverted_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_rbr_distinct CHECK (source_ingredient_id <> target_ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_rbr_performed_at ON recipe_bulk_replace_log (performed_at DESC);

COMMENT ON TABLE recipe_bulk_replace_log IS
  'Journal annulable des remplacements de composant en masse A→B (roadmap production lot 6).';
