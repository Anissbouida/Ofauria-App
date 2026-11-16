-- G0-10 (plan d'action 2026-11) — paie générée sur une période non terminée.
--
-- La génération de la paie d'une période encore en cours est refusée. Un
-- administrateur peut y déroger : le bulletin est alors PROVISOIRE (pointage
-- incomplet) et ne peut pas être payé. Il redevient définitif à la première
-- génération faite après la fin de la période.
ALTER TABLE payroll          ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false;
ALTER TABLE weekly_payroll   ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false;
ALTER TABLE biweekly_payroll ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false;
