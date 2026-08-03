-- Paie par quinzaine (biweekly) : certains employes sont payes deux fois
-- par mois, sur les quinzaines CALENDAIRES 1-15 et 16-fin de mois.
--
-- Regles metier (validees 07/2026) :
--   - La base reste le salaire MENSUEL de l'employe (pas de champ dedie) :
--     taux journalier = monthly_salary / 26 (convention marocaine), paye au
--     prorata des jours pointes sur la quinzaine.
--   - PAS de repos hebdomadaire paye automatiquement (contrairement a la
--     paie hebdo) : on paie uniquement les jours pointes.
--
-- Structure calquee sur weekly_payroll (mig 153 + 228 advance_deduction +
-- 231 worked_days fractionnaire + 239 audit trail), table parallele car le
-- CHECK weekly_payroll_week_start_monday (mig 238) impose un lundi.

-- 1. Nouvelle frequence de paie
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pay_frequency_check;
ALTER TABLE employees ADD CONSTRAINT employees_pay_frequency_check
  CHECK (pay_frequency IN ('monthly', 'weekly', 'biweekly'));

-- 2. Table de paie par quinzaine — 1 ligne par employe x quinzaine.
CREATE TABLE IF NOT EXISTS biweekly_payroll (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id),
  period_start    DATE NOT NULL,  -- toujours le 1er ou le 16 du mois
  period_end      DATE NOT NULL,  -- le 15 ou le dernier jour du mois
  base_amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  worked_days     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- fractionnaire (half_day = 0.5)
  absent_days     INT NOT NULL DEFAULT 0,
  overtime_hours  DECIMAL(6,2) DEFAULT 0,
  overtime_amount DECIMAL(10,2) DEFAULT 0,
  net_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  advance_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid            BOOLEAN DEFAULT false,
  paid_at         TIMESTAMPTZ,
  payment_method  VARCHAR(20) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'check')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  paid_by         UUID REFERENCES users(id),
  UNIQUE(employee_id, period_start),
  CONSTRAINT biweekly_payroll_period_start_valid
    CHECK (EXTRACT(DAY FROM period_start) IN (1, 16))
);

CREATE INDEX IF NOT EXISTS idx_biweekly_payroll_period ON biweekly_payroll(period_start);
CREATE INDEX IF NOT EXISTS idx_biweekly_payroll_employee ON biweekly_payroll(employee_id);

-- Trigger updated_at generique (fonction creee en mig 239)
DROP TRIGGER IF EXISTS biweekly_payroll_set_updated_at ON biweekly_payroll;
CREATE TRIGGER biweekly_payroll_set_updated_at BEFORE UPDATE ON biweekly_payroll
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Retenues d'avances : la quinzaine devient une 3e paie source possible.
ALTER TABLE salary_advance_repayments
  ADD COLUMN IF NOT EXISTS biweekly_payroll_id UUID REFERENCES biweekly_payroll(id);

-- Remplace le CHECK "exactement une paie source" (nom auto de la mig 228).
ALTER TABLE salary_advance_repayments DROP CONSTRAINT IF EXISTS salary_advance_repayments_check;
ALTER TABLE salary_advance_repayments DROP CONSTRAINT IF EXISTS salary_advance_repayments_one_source;
ALTER TABLE salary_advance_repayments ADD CONSTRAINT salary_advance_repayments_one_source
  CHECK ((payroll_id IS NOT NULL)::int
       + (weekly_payroll_id IS NOT NULL)::int
       + (biweekly_payroll_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_advance_repayments_biweekly
  ON salary_advance_repayments(biweekly_payroll_id) WHERE biweekly_payroll_id IS NOT NULL;
