-- Paies hebdo / quinzaine des salaries DECLARES (CNSS, AMO, IR).
--
-- La CNSS (BDS) et l'IR se declarent au mois. Pour un salarie declare paye a
-- la semaine ou a la quinzaine :
--   * chaque paie periodique est un ACOMPTE : brut de la periode moins une
--     retenue provisoire (cotisations + IR estimes sur le salaire mensualise) ;
--   * un bulletin MENSUEL (table payroll) cumule le brut des periodes du mois,
--     calcule cotisations et IR exacts, et deduit les acomptes verses. Il
--     alimente e-BDS, IR, ecriture de paie et regularisation comme un mensuel.
-- Les salaries non declares gardent la paie periodique simple (sans retenue).

ALTER TABLE weekly_payroll
  ADD COLUMN IF NOT EXISTS gross_amount       DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS withholding_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
UPDATE weekly_payroll SET gross_amount = net_amount WHERE gross_amount IS NULL;

ALTER TABLE biweekly_payroll
  ADD COLUMN IF NOT EXISTS gross_amount       DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS withholding_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
UPDATE biweekly_payroll SET gross_amount = net_amount WHERE gross_amount IS NULL;

-- Bulletin mensuel : frequence d'origine et acomptes deduits du net.
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS pay_frequency   VARCHAR(10)   NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS acomptes_amount DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE payroll DROP CONSTRAINT IF EXISTS payroll_pay_frequency_check;
ALTER TABLE payroll ADD CONSTRAINT payroll_pay_frequency_check
  CHECK (pay_frequency IN ('monthly', 'weekly', 'biweekly'));
