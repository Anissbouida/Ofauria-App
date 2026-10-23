-- Migration 338 : colonne production_plans.warnings manquante du schema versionne.
--
-- POURQUOI
--   production.repository.ts ecrit `warnings = $2` au confirm (text[]), la lit
--   dans findById/list et la remet a NULL au revertToDraft, mais AUCUNE migration
--   ne cree la colonne (audit Production & Fiches techniques du 2026-10-23, §5.3).
--   Elle n'existe que sur les bases ou elle a ete ajoutee a la main : une base
--   fraichement migree echoue au premier confirm.
--
-- PORTEE
--   ALTER TABLE idempotent. Nullable, sans defaut : NULL = aucun avertissement,
--   comportement attendu par revertToDraft.
--
-- INVERSION
--   ALTER TABLE production_plans DROP COLUMN IF EXISTS warnings;

ALTER TABLE production_plans
  ADD COLUMN IF NOT EXISTS warnings TEXT[];

COMMENT ON COLUMN production_plans.warnings IS
  'Avertissements non bloquants poses au confirm (produit sans recette, aucun besoin calcule, stock insuffisant). NULL = aucun.';
