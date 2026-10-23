-- Migration 298 : annulation d'un bon de sortie tracée (lot 1 fiabilisation stock)
--
-- POURQUOI
--   L'annulation et la régénération d'un BSI ne laissaient aucune trace (ni auteur,
--   ni date, ni motif) et étaient permises après prélèvement, alors que les lots
--   étaient déjà décrémentés : une régénération suivie d'un nouveau prélèvement
--   déduisait les mêmes ingrédients deux fois.
--
-- QUOI
--   Colonnes d'audit sur production_bons_sortie. Le refus d'annuler un bon dont le
--   prélèvement est engagé (prelevement / verifie / cloture) est appliqué dans le
--   dépôt (bon-sortie.repository.ts cancel / regenerate).

ALTER TABLE production_bons_sortie
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
