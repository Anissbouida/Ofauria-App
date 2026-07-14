-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 239 — Tracabilite RH (audit RH 07/2026)
--
-- Ajoute updated_at / updated_by / paid_by sur les 5 tables RH et cree une
-- table employee_salary_history alimentee par trigger. Requis pour :
--   - Auditer QUI a change un salaire, QUAND, et QUELLE etait l'ancienne valeur
--   - Detecter les requalifications de pointage (absent -> present la veille
--     de la paie = risque de fraude)
--   - Tracer les bulletins bascules paye/non-paye
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Colonnes de tracabilite ───────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

ALTER TABLE leaves
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id);

ALTER TABLE weekly_payroll
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id);

-- ─── 2. Trigger generique updated_at ──────────────────────────────────────
-- Setle a NOW() a chaque UPDATE. Ne touche pas updated_by (c'est au code
-- applicatif de le passer explicitement — sinon le trigger ne pourrait pas
-- distinguer un changement systeme d'un changement utilisateur).

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employees_set_updated_at ON employees;
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS attendance_set_updated_at ON attendance;
CREATE TRIGGER attendance_set_updated_at BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS leaves_set_updated_at ON leaves;
CREATE TRIGGER leaves_set_updated_at BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS payroll_set_updated_at ON payroll;
CREATE TRIGGER payroll_set_updated_at BEFORE UPDATE ON payroll
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS weekly_payroll_set_updated_at ON weekly_payroll;
CREATE TRIGGER weekly_payroll_set_updated_at BEFORE UPDATE ON weekly_payroll
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Historique des changements de salaire ─────────────────────────────
-- Une nouvelle ligne a chaque modification de monthly_salary OU weekly_salary.
-- Permet de repondre a "quel etait le salaire de X en septembre 2025 ?" et
-- de prouver la conformite en cas de controle CNSS.

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id),
  old_monthly_salary DECIMAL(10,2),
  new_monthly_salary DECIMAL(10,2),
  old_weekly_salary DECIMAL(10,2),
  new_weekly_salary DECIMAL(10,2),
  old_pay_frequency VARCHAR(20),
  new_pay_frequency VARCHAR(20),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_esh_employee ON employee_salary_history(employee_id, changed_at DESC);

CREATE OR REPLACE FUNCTION log_employee_salary_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Ne log qu'en cas de changement effectif d'un des 3 champs surveilles.
  -- COALESCE + IS DISTINCT FROM gere proprement les NULL (pas d'insertion si
  -- ancien et nouveau sont tous deux NULL).
  IF (OLD.monthly_salary IS DISTINCT FROM NEW.monthly_salary)
     OR (OLD.weekly_salary IS DISTINCT FROM NEW.weekly_salary)
     OR (OLD.pay_frequency IS DISTINCT FROM NEW.pay_frequency) THEN
    INSERT INTO employee_salary_history (
      employee_id, changed_by,
      old_monthly_salary, new_monthly_salary,
      old_weekly_salary, new_weekly_salary,
      old_pay_frequency, new_pay_frequency
    ) VALUES (
      NEW.id, NEW.updated_by,
      OLD.monthly_salary, NEW.monthly_salary,
      OLD.weekly_salary, NEW.weekly_salary,
      OLD.pay_frequency, NEW.pay_frequency
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employees_log_salary_change ON employees;
CREATE TRIGGER employees_log_salary_change AFTER UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION log_employee_salary_change();

-- Optionnel : backfill l'historique avec le salaire actuel comme "premiere
-- valeur connue". Utile pour eviter des trous quand un rapport commence
-- avant la migration.
INSERT INTO employee_salary_history (
  employee_id, changed_at, new_monthly_salary, new_weekly_salary, new_pay_frequency, reason
)
SELECT id, hire_date::timestamptz, monthly_salary, weekly_salary, pay_frequency,
       'Backfill migration 239 (salaire a l''embauche)'
  FROM employees
 WHERE NOT EXISTS (
   SELECT 1 FROM employee_salary_history h WHERE h.employee_id = employees.id
 );
