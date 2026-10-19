-- ═══════════════════════════════════════════════════════════════════════
-- 321 — Heures supplémentaires majorées et jours fériés, lot 3 refonte RH
--   Code du travail art. 196-204 (et décret d'application) :
--     jour ouvrable : +25 % (6h-21h), +50 % (21h-6h) ;
--     repos hebdomadaire : +50 % (jour), +100 % (nuit) ;
--     taux horaire = salaire mensuel / 191 h (44 h x 52 / 12) ;
--     contingent annuel d'heures supplémentaires (100 h par défaut).
--   Jours fériés : non travaillé = jour payé (plus de retenue d'absence) ;
--   travaillé = indemnité en plus du salaire du jour (100 % par défaut).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Réglages ───────────────────────────────────────────────────────
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS ot_rate_day          DECIMAL(5,4) NOT NULL DEFAULT 0.25 CHECK (ot_rate_day >= 0),
  ADD COLUMN IF NOT EXISTS ot_rate_night        DECIMAL(5,4) NOT NULL DEFAULT 0.50 CHECK (ot_rate_night >= 0),
  ADD COLUMN IF NOT EXISTS ot_rate_rest_day     DECIMAL(5,4) NOT NULL DEFAULT 0.50 CHECK (ot_rate_rest_day >= 0),
  ADD COLUMN IF NOT EXISTS ot_rate_rest_night   DECIMAL(5,4) NOT NULL DEFAULT 1.00 CHECK (ot_rate_rest_night >= 0),
  ADD COLUMN IF NOT EXISTS night_start          TIME NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS night_end            TIME NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS monthly_legal_hours  DECIMAL(6,2) NOT NULL DEFAULT 191 CHECK (monthly_legal_hours > 0),
  ADD COLUMN IF NOT EXISTS weekly_legal_hours   DECIMAL(5,2) NOT NULL DEFAULT 44 CHECK (weekly_legal_hours > 0),
  ADD COLUMN IF NOT EXISTS holiday_worked_rate  DECIMAL(5,4) NOT NULL DEFAULT 1.00 CHECK (holiday_worked_rate >= 0),
  ADD COLUMN IF NOT EXISTS ot_annual_quota_hours DECIMAL(6,2) NOT NULL DEFAULT 100 CHECK (ot_annual_quota_hours > 0);

-- ─── 2. Pointage : part de nuit et jour de repos ──────────────────────
-- overtime_night_minutes : part des heures sup effectuée de nuit (calculée
-- depuis les heures d'arrivée/départ, modifiable). is_rest_day : jour de
-- repos hebdomadaire travaillé (NULL = déduit du jour de repos des réglages).
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS overtime_night_minutes INT NOT NULL DEFAULT 0 CHECK (overtime_night_minutes >= 0),
  ADD COLUMN IF NOT EXISTS is_rest_day BOOLEAN;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_night_within_overtime;
ALTER TABLE attendance ADD CONSTRAINT attendance_night_within_overtime
  CHECK (overtime_night_minutes <= COALESCE(overtime_minutes, 0));

-- ─── 3. Détail sur les paies ──────────────────────────────────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS ot_day_hours          DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_night_hours        DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_rest_day_hours     DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_rest_night_hours   DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_paid_days     DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_worked_days   DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_premium       DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE weekly_payroll
  ADD COLUMN IF NOT EXISTS holiday_paid_days     DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_worked_days   DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_premium       DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE biweekly_payroll
  ADD COLUMN IF NOT EXISTS holiday_paid_days     DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_worked_days   DECIMAL(4,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_premium       DECIMAL(10,2) NOT NULL DEFAULT 0;
