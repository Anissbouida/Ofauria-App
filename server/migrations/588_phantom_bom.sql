-- ═══════════════════════════════════════════════════════════════════════
-- 588 — Nomenclature fantôme (M9)
--
--   Un sous-ensemble (recette de base, is_base) marqué « fantôme » n'est jamais stocké ni
--   fabriqué à part : à la confirmation d'un ordre, il ne crée ni ordre de semi-fini ni
--   réservation de stock semi-fini ; ses composants sont tirés directement dans les besoins
--   de l'ordre parent et déduits à la déclaration (comportement déjà en place pour toute
--   base sans dépendance). Le calcul des besoins (MRP) ne le compte pas non plus comme semi-fini.
--   Défaut : false — rien ne change pour les fiches existantes.
--
-- INVERSION
--   ALTER TABLE recipes DROP COLUMN is_phantom.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_phantom boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE recipes ADD CONSTRAINT chk_recipes_phantom_base CHECK (NOT is_phantom OR is_base);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN recipes.is_phantom IS 'Sous-ensemble fantôme : jamais stocké, composants tirés dans l''ordre parent (mig 588).';
