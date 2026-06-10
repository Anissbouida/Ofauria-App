-- Paie hebdomadaire : certains employes sont payes a la semaine (le lundi
-- pour la semaine ecoulee). On ajoute un type de frequence + salaire hebdo
-- sur l'employe et une table de paie hebdo paralle a la paie mensuelle.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pay_frequency VARCHAR(10) DEFAULT 'monthly'
    CHECK (pay_frequency IN ('monthly', 'weekly'));

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS weekly_salary DECIMAL(8,2);

-- 1 ligne par employe x semaine de reference (lundi -> dimanche).
-- Genere a partir du pointage : workedDays + heuresSup => baseAmount +
-- overtimeAmount. Marquage paye/non-paye + ecriture comptable au paiement.
CREATE TABLE IF NOT EXISTS weekly_payroll (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id),
  week_start      DATE NOT NULL,  -- toujours un lundi
  week_end        DATE NOT NULL,  -- toujours un dimanche
  base_amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  worked_days     INT NOT NULL DEFAULT 0,
  absent_days     INT NOT NULL DEFAULT 0,
  overtime_hours  DECIMAL(6,2) DEFAULT 0,
  overtime_amount DECIMAL(10,2) DEFAULT 0,
  net_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid            BOOLEAN DEFAULT false,
  paid_at         TIMESTAMPTZ,
  payment_method  VARCHAR(20) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'check')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_payroll_week ON weekly_payroll(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_payroll_employee ON weekly_payroll(employee_id);
