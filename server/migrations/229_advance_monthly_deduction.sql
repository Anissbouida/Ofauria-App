-- Migration 229 : plan d'etalement des avances sur salaire
--
-- POURQUOI
--   Permettre de definir a l'octroi une retenue mensuelle fixe (ex : avance
--   de 2 500 DH recuperee 500 DH/mois sur 5 mois). Le systeme propose alors
--   ce montant a chaque paie au lieu du solde total.
--
--   NULL = comportement actuel : tout le solde est propose a la prochaine
--   paie (retenue modifiable au moment du paiement dans les deux cas).
--
-- PORTEE : colonne ajoutee sur salary_advances uniquement.
-- INVERSION : ALTER TABLE salary_advances DROP COLUMN monthly_deduction;

ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS monthly_deduction NUMERIC(12,2) NULL
  CHECK (monthly_deduction IS NULL OR monthly_deduction > 0);

COMMENT ON COLUMN salary_advances.monthly_deduction IS
  'Retenue proposee par paie (plan d''etalement). NULL = solde total propose a la prochaine paie.';
