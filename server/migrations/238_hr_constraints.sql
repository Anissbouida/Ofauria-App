-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 238 — Contraintes correctives RH (audit RH 07/2026)
--
-- Corrige les faiblesses schema identifiees par l'audit :
--   1. CASCADE destructeurs -> RESTRICT (evite la perte d'ecritures comptables
--      lors d'une suppression accidentelle d'employe ou d'avance).
--   2. Bornes de valeur (salaires >= 0, payroll.year, week_start = lundi).
--   3. Anti-chevauchement conges + coherence dates.
--   4. Types de conge : autoriser 'paternity' (present dans le validator zod).
--
-- La FK employees.role -> ref_entries('employee_roles').code n'est PAS ajoutee :
-- ref_entries a (table_id, code) en cle composite, PG ne supporte pas de FK
-- vers une sous-cle. Une validation applicative reste possible via un trigger
-- ou dans le validator zod (option future).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. RESTRICT au lieu de CASCADE ───────────────────────────────────────

-- 1a. employee_commissions (mig 123) : supprimer un employe efface aussi ses
-- regles de commission historiques -> perte d'attribution CA. RESTRICT force
-- l'admin a soft-delete ou a nettoyer les commissions d'abord.
ALTER TABLE employee_commissions
  DROP CONSTRAINT IF EXISTS employee_commissions_employee_id_fkey;
ALTER TABLE employee_commissions
  ADD CONSTRAINT employee_commissions_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;

-- 1b. salary_advance_repayments (mig 228) : supprimer une avance effacait
-- son lettrage mais laissait les ecritures 6171/3431 orphelines. RESTRICT
-- impose de reverser d'abord (via reverseRepayments + unmarkPaid).
ALTER TABLE salary_advance_repayments
  DROP CONSTRAINT IF EXISTS salary_advance_repayments_advance_id_fkey;
ALTER TABLE salary_advance_repayments
  ADD CONSTRAINT salary_advance_repayments_advance_id_fkey
    FOREIGN KEY (advance_id) REFERENCES salary_advances(id) ON DELETE RESTRICT;

-- ─── 2. Bornes de valeur ──────────────────────────────────────────────────

-- 2a. Salaires >= 0. Note : monthly_salary et weekly_salary sont NULLABLE,
-- le CHECK autorise NULL (comportement PG standard : NULL passe tous les CHECK).
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_monthly_salary_nonneg;
ALTER TABLE employees ADD CONSTRAINT employees_monthly_salary_nonneg
  CHECK (monthly_salary IS NULL OR monthly_salary >= 0);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_weekly_salary_nonneg;
ALTER TABLE employees ADD CONSTRAINT employees_weekly_salary_nonneg
  CHECK (weekly_salary IS NULL OR weekly_salary >= 0);

-- Colonne hourly_rate n'existe plus (renommee en monthly_salary mig 009).
-- Si elle reapparait dans un future export/import, elle sera couverte par
-- le CHECK au moment de sa recreation.

-- 2b. payroll.year borne (evite les typos 20025, negatifs, etc.).
ALTER TABLE payroll DROP CONSTRAINT IF EXISTS payroll_year_range;
ALTER TABLE payroll ADD CONSTRAINT payroll_year_range
  CHECK (year BETWEEN 2000 AND 2100);

-- 2c. week_start doit tomber un lundi (DOW=1 en PG : 0=dim, 1=lun...).
-- La generation serveur (weekBounds) garantit deja l'invariant, on l'ancre
-- au niveau schema pour bloquer toute insertion manuelle ou script bugge.
ALTER TABLE weekly_payroll DROP CONSTRAINT IF EXISTS weekly_payroll_week_start_monday;
ALTER TABLE weekly_payroll ADD CONSTRAINT weekly_payroll_week_start_monday
  CHECK (EXTRACT(DOW FROM week_start) = 1);

-- ─── 3. Conges : coherence dates + anti-chevauchement ─────────────────────

-- 3a. Types de conge : le validator zod autorise 'paternity' mais le CHECK
-- initial (mig 018) ne le liste pas -> INSERT echoue en prod. Aligne les deux.
ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_type_check;
ALTER TABLE leaves ADD CONSTRAINT leaves_type_check
  CHECK (type IN ('annual', 'paid', 'sick', 'unpaid', 'maternity', 'paternity', 'other'));

-- 3b. end_date >= start_date : garde-fou basique manquant.
ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_date_order;
ALTER TABLE leaves ADD CONSTRAINT leaves_date_order
  CHECK (end_date >= start_date);

-- 3c. days > 0 (0 jour de conge n'a pas de sens).
ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_days_positive;
ALTER TABLE leaves ADD CONSTRAINT leaves_days_positive
  CHECK (days > 0);

-- 3d. Anti-chevauchement : un meme employe ne peut avoir deux conges
-- 'approved' qui se chevauchent (le validator applicatif ne le detectait
-- pas). Contrainte d'exclusion via GIST + btree_gist pour les operateurs
-- d'egalite sur uuid.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_no_overlap;
ALTER TABLE leaves ADD CONSTRAINT leaves_no_overlap
  EXCLUDE USING GIST (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'approved');
