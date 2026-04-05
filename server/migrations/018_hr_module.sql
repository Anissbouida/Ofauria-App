-- Fix salary column: rename hourly_rate to monthly_salary
ALTER TABLE employees RENAME COLUMN hourly_rate TO monthly_salary;

-- Add HR fields to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cin VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cnss_number VARCHAR(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) DEFAULT 'cdi' CHECK (contract_type IN ('cdi', 'cdd', 'stage', 'interim'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT;

-- Attendance / Pointage
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  status VARCHAR(20) NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'half_day')),
  overtime_minutes INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);

-- Leave / Conges
CREATE TABLE IF NOT EXISTS leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  type VARCHAR(30) NOT NULL DEFAULT 'annual' CHECK (type IN ('annual', 'sick', 'unpaid', 'maternity', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INT NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves(start_date, end_date);

-- Payroll / Paie
CREATE TABLE IF NOT EXISTS payroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL,
  base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
  worked_days INT NOT NULL DEFAULT 26,
  absent_days INT NOT NULL DEFAULT 0,
  overtime_hours DECIMAL(6,2) DEFAULT 0,
  overtime_amount DECIMAL(10,2) DEFAULT 0,
  bonuses DECIMAL(10,2) DEFAULT 0,
  deductions DECIMAL(10,2) DEFAULT 0,
  cnss_employee DECIMAL(10,2) DEFAULT 0,
  cnss_employer DECIMAL(10,2) DEFAULT 0,
  net_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(20) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'check')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(year, month);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
