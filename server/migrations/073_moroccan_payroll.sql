-- =====================================================
-- Moroccan payroll model — CNSS, AMO, IR bareme 2025
-- =====================================================

-- Add missing columns for full Moroccan payroll
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS gross_salary DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS seniority_bonus DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS amo_employee DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS amo_employer DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS ir_gross DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS ir_net DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS frais_pro DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS alloc_familiales DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS taxe_fp DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS total_charges_patron DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS family_deduction DECIMAL(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS nb_dependents INT DEFAULT 0;

-- Add seniority / dependents to employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS seniority_years INT DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nb_dependents INT DEFAULT 0;
