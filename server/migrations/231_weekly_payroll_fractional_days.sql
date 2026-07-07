-- Migration 231 : worked_days fractionnaire sur la paie hebdo
--
-- POURQUOI
--   Le repos hebdomadaire est desormais paye PROPORTIONNELLEMENT aux jours
--   travailles (repos = jours/6, plafonne a 1), et une demi-journee compte
--   0.5. worked_days peut donc valoir 3.5 -> le type INT l'arrondissait.
--
-- INVERSION : ALTER TABLE weekly_payroll ALTER COLUMN worked_days TYPE INT.

ALTER TABLE weekly_payroll
  ALTER COLUMN worked_days TYPE NUMERIC(5,2);

COMMENT ON COLUMN weekly_payroll.worked_days IS
  'Jours travailles (fractionnaire : demi-journee = 0.5, double shift = 2). Le repos paye = worked_days/6 plafonne a 1, calcule au moment de la generation.';
