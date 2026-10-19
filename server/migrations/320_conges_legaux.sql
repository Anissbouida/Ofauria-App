-- ═══════════════════════════════════════════════════════════════════════
-- 320 — Congés légaux, lot 2 de la refonte RH (Code du travail, art. 231-268)
--   1. Jours fériés (calendrier marocain, éditable) : non décomptés du congé.
--   2. Réglages : jour de repos hebdomadaire, acquisition mensuelle (1,5 j),
--      années de report (cumul sur deux années consécutives, art. 240).
--   3. Types de congé paramétrés (ref_entries leave_types, metadata) :
--      payé par l'employeur, décompté du solde, unité ouvrable/calendaire.
--   4. Ajustements de solde (reprise d'un solde initial, régularisation).
-- Le solde se calcule (services/leave-engine.ts) : droits acquis depuis
-- l'embauche, majoration d'ancienneté (+1,5 j par 5 ans, plafond 30 j/an),
-- congés approuvés consommés du plus ancien droit au plus récent.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Jours fériés ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_holidays (
  holiday_date  DATE PRIMARY KEY,
  label         VARCHAR(120) NOT NULL,
  -- Fêtes religieuses : date lunaire, à confirmer à l'annonce officielle.
  is_confirmed  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public_holidays (holiday_date, label, is_confirmed) VALUES
  ('2026-01-01', 'Nouvel an', true),
  ('2026-01-11', 'Manifeste de l''Indépendance', true),
  ('2026-01-14', 'Nouvel an amazigh', true),
  ('2026-03-20', 'Aïd al-Fitr', false),
  ('2026-03-21', 'Aïd al-Fitr (2e jour)', false),
  ('2026-05-01', 'Fête du Travail', true),
  ('2026-05-27', 'Aïd al-Adha', false),
  ('2026-05-28', 'Aïd al-Adha (2e jour)', false),
  ('2026-06-16', '1er Moharram', false),
  ('2026-07-30', 'Fête du Trône', true),
  ('2026-08-14', 'Allégeance Oued Eddahab', true),
  ('2026-08-20', 'Révolution du Roi et du Peuple', true),
  ('2026-08-21', 'Fête de la Jeunesse', true),
  ('2026-08-25', 'Aïd al-Mawlid', false),
  ('2026-08-26', 'Aïd al-Mawlid (2e jour)', false),
  ('2026-10-31', 'Fête de l''Unité', true),
  ('2026-11-06', 'Marche Verte', true),
  ('2026-11-18', 'Fête de l''Indépendance', true),
  ('2027-01-01', 'Nouvel an', true),
  ('2027-01-11', 'Manifeste de l''Indépendance', true),
  ('2027-01-14', 'Nouvel an amazigh', true),
  ('2027-03-10', 'Aïd al-Fitr', false),
  ('2027-03-11', 'Aïd al-Fitr (2e jour)', false),
  ('2027-05-01', 'Fête du Travail', true),
  ('2027-05-17', 'Aïd al-Adha', false),
  ('2027-05-18', 'Aïd al-Adha (2e jour)', false),
  ('2027-06-06', '1er Moharram', false),
  ('2027-07-30', 'Fête du Trône', true),
  ('2027-08-14', 'Allégeance Oued Eddahab', true),
  ('2027-08-15', 'Aïd al-Mawlid', false),
  ('2027-08-16', 'Aïd al-Mawlid (2e jour)', false),
  ('2027-08-20', 'Révolution du Roi et du Peuple', true),
  ('2027-08-21', 'Fête de la Jeunesse', true),
  ('2027-10-31', 'Fête de l''Unité', true),
  ('2027-11-06', 'Marche Verte', true),
  ('2027-11-18', 'Fête de l''Indépendance', true)
ON CONFLICT (holiday_date) DO NOTHING;

-- ─── 2. Réglages ───────────────────────────────────────────────────────
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS leave_rest_weekday     SMALLINT NOT NULL DEFAULT 0 CHECK (leave_rest_weekday BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS leave_days_per_month   DECIMAL(4,2) NOT NULL DEFAULT 1.5 CHECK (leave_days_per_month > 0),
  ADD COLUMN IF NOT EXISTS leave_carryover_years  SMALLINT NOT NULL DEFAULT 1 CHECK (leave_carryover_years BETWEEN 0 AND 5);
COMMENT ON COLUMN payroll_settings.leave_rest_weekday IS '0 = dimanche ... 6 = samedi : jour non décompté d''un congé en jours ouvrables.';
COMMENT ON COLUMN payroll_settings.leave_carryover_years IS 'Années pendant lesquelles un reliquat reste utilisable après l''année d''acquisition (1 = cumul sur deux années consécutives).';

-- ─── 3. Types de congé paramétrés ─────────────────────────────────────
-- metadata : paid (payé par l'employeur, compté dans la paie),
-- deducts_balance (décompté du solde de congés payés), unit (ouvrable | calendaire).
UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || v.meta::jsonb
  FROM (VALUES
    ('annual',    '{"paid": true,  "deducts_balance": true,  "unit": "ouvrable"}'),
    ('sick',      '{"paid": false, "deducts_balance": false, "unit": "calendaire"}'),
    ('unpaid',    '{"paid": false, "deducts_balance": false, "unit": "ouvrable"}'),
    ('maternity', '{"paid": false, "deducts_balance": false, "unit": "calendaire"}'),
    ('other',     '{"paid": false, "deducts_balance": false, "unit": "ouvrable"}')
  ) AS v(code, meta)
 WHERE ref_entries.table_id = 'leave_types' AND ref_entries.code = v.code
   AND NOT (ref_entries.metadata ? 'deducts_balance');

INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
SELECT 'leave_types', v.code, v.label, v.ord, v.meta::jsonb
  FROM (VALUES
    ('paternity',   'Naissance (paternité, 3 j)',          60, '{"paid": true, "deducts_balance": false, "unit": "ouvrable"}'),
    ('exceptional', 'Absence exceptionnelle payée (art. 274)', 70, '{"paid": true, "deducts_balance": false, "unit": "ouvrable"}')
  ) AS v(code, label, ord, meta)
 WHERE EXISTS (SELECT 1 FROM ref_tables WHERE id = 'leave_types')
ON CONFLICT (table_id, code) DO NOTHING;

ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_type_check;
ALTER TABLE leaves ADD CONSTRAINT leaves_type_check
  CHECK (type IN ('annual', 'paid', 'sick', 'unpaid', 'maternity', 'paternity', 'exceptional', 'other'));

-- ─── 4. Ajustements de solde ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_adjustments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Année de rattachement du droit (le report suit cette année).
  year         SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  days         DECIMAL(5,2) NOT NULL CHECK (days <> 0 AND days BETWEEN -60 AND 60),
  reason       VARCHAR(300) NOT NULL,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_adjustments_emp ON leave_adjustments(employee_id, year);

-- ─── 5. Congés payés comptés dans la paie ─────────────────────────────
-- Jours de congé payé approuvés (hors jours pointés) comptés comme couverts.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS paid_leave_days DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE weekly_payroll ADD COLUMN IF NOT EXISTS paid_leave_days DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE biweekly_payroll ADD COLUMN IF NOT EXISTS paid_leave_days DECIMAL(5,2) NOT NULL DEFAULT 0;
