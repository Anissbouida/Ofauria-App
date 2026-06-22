-- Migration 211 : autoriser source_kind = 'shift_entry' sur les ecritures
--
-- POURQUOI
--   Les ventes journalieres saisies manuellement par shift (matin/soir) dans
--   manual_shift_entries representent un chiffre d'affaires reel qui doit etre
--   comptabilise, au meme titre que les ventes POS (table sales). On ajoute un
--   type de source dedie pour distinguer ces ecritures.
--
-- PORTEE : modifie uniquement la contrainte CHECK de journal_entries.source_kind.
-- INVERSION : remettre l'ancienne liste sans 'shift_entry'.

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check
  CHECK (source_kind IN ('manual','invoice','payment','sale','reversal','backfill','shift_entry'));
