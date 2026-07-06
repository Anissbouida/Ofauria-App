-- Migration 230 : statut 'double' au pointage (deux shifts le meme jour)
--
-- CONTEXTE
--   La boulangerie tourne 7j/7 en plusieurs services. Quand un employe
--   enchaine deux shifts le meme jour (remplacement, rush), ce jour doit
--   compter DOUBLE dans la paie :
--     - paie hebdo : 2 jours au taux journalier (salaire/7) ;
--     - paie mensuelle : +1 jour supplementaire au taux journalier (base/26)
--       ajoute au brut (colonnes extra_shift_days / extra_shift_amount).
--
-- INVERSION : repasser la contrainte sans 'double' + DROP des 2 colonnes.

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'half_day', 'repos', 'double'));

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS extra_shift_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS extra_shift_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll.extra_shift_days IS
  'Jours pointes en double shift : chaque jour ajoute 1 jour supplementaire paye au taux journalier.';
