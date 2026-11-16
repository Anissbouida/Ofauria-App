-- G0-11 (plan d'action 2026-11) — contrôle du salaire minimum (SMIG).
--
-- Les montants du SMIG sont portés par le barème de paie DATÉ (effective_from) :
-- un changement de SMIG passe par une nouvelle version du barème, les bulletins
-- passés restent contrôlés avec le SMIG de leur date.
-- Aucune valeur n'est posée ici : elles sont saisies par le client et validées
-- par son comptable. Tant qu'elles sont vides, aucun contrôle n'est fait.
ALTER TABLE payroll_tax_scales
  ADD COLUMN IF NOT EXISTS smig_hourly  numeric(10,4),
  ADD COLUMN IF NOT EXISTS smig_monthly numeric(12,2);

-- Politique : avertir (défaut) ou bloquer la génération d'un bulletin sous le SMIG.
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS smig_policy varchar(10) NOT NULL DEFAULT 'warn';
DO $$ BEGIN
  ALTER TABLE payroll_settings ADD CONSTRAINT chk_payroll_settings_smig_policy CHECK (smig_policy IN ('warn', 'block'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Alerte portée par le bulletin (NULL = conforme ou non contrôlé).
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS smig_alert text;
