-- M4-05 (étape 4) — le remplacement en masse (mig 401) devient l'outil de mise à jour du
-- modèle des substituts :
--   mode 'replace'    : A → B sur les fiches choisies, quantités × ratio (B pour 1 A) ;
--                       annulation = A restauré et quantités ÷ ratio, sur les mêmes lignes ;
--   mode 'substitute' : B déclaré substitut de A (recipe_line_substitutes, mig 563) pour les
--                       fiches choisies, ou pour toutes (une ligne générale) ; annulation =
--                       suppression des substituts créés.
-- Les versions de nomenclature activées après un remplacement sont comptées (activated_versions).
--
-- INVERSION : ALTER TABLE recipe_bulk_replace_log DROP COLUMN mode, DROP COLUMN ratio,
--   DROP COLUMN recipe_ids, DROP COLUMN substitute_ids, DROP COLUMN activated_versions;
ALTER TABLE recipe_bulk_replace_log
  ADD COLUMN IF NOT EXISTS mode varchar(12) NOT NULL DEFAULT 'replace' CHECK (mode IN ('replace', 'substitute')),
  ADD COLUMN IF NOT EXISTS ratio numeric(12,4) NOT NULL DEFAULT 1 CHECK (ratio > 0),
  ADD COLUMN IF NOT EXISTS recipe_ids uuid[],
  ADD COLUMN IF NOT EXISTS substitute_ids uuid[],
  ADD COLUMN IF NOT EXISTS activated_versions integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN recipe_bulk_replace_log.recipe_ids IS 'M4-05 : fiches visées (NULL = toutes les fiches qui utilisent la source).';
