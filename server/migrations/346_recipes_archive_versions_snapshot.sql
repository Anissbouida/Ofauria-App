-- Migration 346 : archivage des recettes + versions completes
--
-- POURQUOI (audit Production & Fiches techniques 2026-10-23, §2.3 — P2)
--   1. Supprimer une recette etait un DELETE physique en cascade : la fiche,
--      ses versions, sa nomenclature et ses formats disparaissaient, alors que
--      l'historique de production (production_plan_items, dependances,
--      semi-finis) la reference encore. Une fiche retiree du catalogue doit
--      etre ARCHIVEE : hors des listes et des selecteurs, restaurable, et
--      toujours lisible depuis les plans passes.
--   2. recipe_versions (mig 041) ne capturait que le modele legacy
--      (ingredients + sous-recettes) : pour une recette en mode compose, la
--      version etait vide ; les etapes, les frais indirects, les formats et
--      leur nomenclature n'etaient jamais versionnes.
--
-- CE QUE CETTE MIGRATION AJOUTE
--   recipes.archived_at / archived_by : NULL = active. (La branche wip porte une
--   mig 275 qui ajoute archived_at avec IF NOT EXISTS : compatible.)
--   recipe_versions.snapshot : capture JSONB complete au moment de la
--   modification (recette, ingredients, sous-recettes, composants, formats et
--   leur nomenclature, emballages, etapes, frais indirects, parametres de pate,
--   cout total). Les colonnes historiques restent alimentees pour l'UI existante.
--
-- INVERSION
--   ALTER TABLE recipes DROP COLUMN archived_at, DROP COLUMN archived_by;
--   ALTER TABLE recipe_versions DROP COLUMN snapshot;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);

COMMENT ON COLUMN recipes.archived_at IS
  'NULL = fiche active. Renseigne = archivee : hors listes et selecteurs, restaurable, toujours referencee par l''historique de production (mig 346).';

CREATE INDEX IF NOT EXISTS idx_recipes_archived_at ON recipes (archived_at) WHERE archived_at IS NOT NULL;

ALTER TABLE recipe_versions
  ADD COLUMN IF NOT EXISTS snapshot JSONB;

COMMENT ON COLUMN recipe_versions.snapshot IS
  'Capture complete de la fiche AVANT la modification (mig 346) : recipe, ingredients, sub_recipes, components, formats[{...,components}], packaging, etapes, total_cost. Les colonnes historiques (ingredients, sub_recipes...) restent remplies.';
