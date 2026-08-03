-- Migration 256 : paie mensuelle basee sur le pointage
--
-- POURQUOI
--   La paie mensuelle payait le salaire de base complet et ne retenait que
--   les jours explicitement pointes 'absent' : un mois SANS pointage donnait
--   le salaire plein. Regle metier 07/2026 (alignee sur la quinzaine, mig
--   254) : toute journee non pointee sur la base des 26 jours est retenue au
--   taux journalier base/26. Une demi-journee pointee compte 0.5 jour ->
--   worked_days / absent_days doivent accepter les fractions (meme
--   conversion que la mig 231 pour weekly_payroll).
--
-- INVERSION : ALTER TABLE payroll ALTER COLUMN worked_days TYPE INT,
--             puis idem pour absent_days.

ALTER TABLE payroll
  ALTER COLUMN worked_days TYPE NUMERIC(5,2);

ALTER TABLE payroll
  ALTER COLUMN absent_days TYPE NUMERIC(5,2);

COMMENT ON COLUMN payroll.worked_days IS
  'Jours pointes du mois (fractionnaire : demi-journee = 0.5, double shift = 2). Pointage reel uniquement (is_expected = false).';

COMMENT ON COLUMN payroll.absent_days IS
  'Jours retenus = max(0, 26 - jours couverts par un pointage). Inclut les absences explicites ET les jours non pointes.';
