-- ═══════════════════════════════════════════════════════════════════════
-- 673 — Durée de conservation des préparations de base (audit pâtisserie C-10)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Aucun lot de préparation (crème, pâte, ganache…) ne portait de date limite : 0 sur 1 436
--   en dev. Le filtre de péremption à la réservation était donc sans effet, et une crème
--   pâtissière de la veille pouvait servir un plan du lendemain.
--
-- QUOI
--   recipes.conservation_heures : durée de conservation d'une préparation après fabrication,
--   en heures (24 = un jour ; une crème pâtissière se garde souvent 48 h au froid).
--   Saisie sur la fiche ; à la fabrication, le lot reçoit expires_at = date de production
--   + durée. NULL = non renseigné (lot sans date, comme avant).
--
-- INVERSION
--   ALTER TABLE recipes DROP COLUMN conservation_heures.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS conservation_heures integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipes_conservation_heures') THEN
    ALTER TABLE recipes ADD CONSTRAINT chk_recipes_conservation_heures
      CHECK (conservation_heures IS NULL OR (conservation_heures > 0 AND conservation_heures <= 8760));
  END IF;
END $$;

COMMENT ON COLUMN recipes.conservation_heures IS
  'Durée de conservation d''une préparation après fabrication, en heures : date limite de ses lots (mig 673)';
