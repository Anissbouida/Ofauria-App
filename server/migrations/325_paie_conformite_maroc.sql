-- ═══════════════════════════════════════════════════════════════════════
-- 325 — Paie : conformité marocaine (suite de la refonte RH)
--   1. Virement groupé des salaires : RIB (24 chiffres) et banque par
--      salarié, compte de l'employeur (donneur d'ordre) dans les réglages.
--   2. Régularisation annuelle de l'IR (art. 59, 73, 74 CGI) au bulletin de
--      décembre ou du mois de sortie : part de ir_net qui régularise l'année
--      (positive = complément retenu, négative = trop-perçu restitué).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Virement ────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS rib       VARCHAR(24),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(80);
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_rib_format;
ALTER TABLE employees ADD CONSTRAINT employees_rib_format CHECK (rib IS NULL OR rib ~ '^[0-9]{24}$');

ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS employer_rib       VARCHAR(24),
  ADD COLUMN IF NOT EXISTS employer_bank_name VARCHAR(80);
ALTER TABLE payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_employer_rib_format;
ALTER TABLE payroll_settings ADD CONSTRAINT payroll_settings_employer_rib_format
  CHECK (employer_rib IS NULL OR employer_rib ~ '^[0-9]{24}$');

-- ─── 2. Régularisation annuelle de l'IR ────────────────────────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS ir_regularisation DECIMAL(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN payroll.ir_regularisation IS
  'Part de ir_net qui régularise l''IR de l''année (décembre ou sortie) ; ir_net peut être négatif (trop-perçu restitué).';
