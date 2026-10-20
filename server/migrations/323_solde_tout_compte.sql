-- ═══════════════════════════════════════════════════════════════════════
-- 323 — Départ du salarié, lot 6 refonte RH (Code du travail art. 41-76)
--   Solde de tout compte : indemnité compensatrice de congés payés,
--   indemnité de préavis (non effectué, dispense de l'employeur), indemnité
--   de licenciement (art. 52-53), dommages-intérêts (art. 41, sur décision),
--   retenues (préavis non respecté par le salarié, congés pris par anticipation).
--   Salarié payé au mois : les montants deviennent des lignes du dernier
--   bulletin (cotisations, IR, avances et comptabilité suivent le circuit
--   normal). Reçu pour solde de tout compte (art. 73-76) et certificat de
--   travail (art. 72) en PDF.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Rubriques de départ ────────────────────────────────────────────
-- Indemnités de licenciement et dommages-intérêts : exonérés de CNSS et d'IR
-- dans la limite légale (CGI art. 57-7°) ; le calcul produit le montant légal.
INSERT INTO payroll_rubriques (code, label, kind, soumis_cnss, soumis_ir, plafond_exoneration_mensuel, sort_order, notes) VALUES
  ('IND_CONGES',        'Indemnité compensatrice de congés payés', 'gain',    true,  true,  NULL, 200, 'Solde de tout compte : jours de congé acquis non pris.'),
  ('IND_PREAVIS',       'Indemnité compensatrice de préavis',      'gain',    true,  true,  NULL, 210, 'Solde de tout compte : préavis non effectué (dispense de l''employeur).'),
  ('IND_LICENCIEMENT',  'Indemnité de licenciement',               'gain',    false, false, NULL, 220, 'Art. 52-53 : montant légal exonéré de CNSS et d''IR.'),
  ('DOMMAGES_INTERETS', 'Dommages-intérêts',                       'gain',    false, false, NULL, 230, 'Art. 41 : licenciement abusif, dans la limite légale.'),
  ('RET_PREAVIS',       'Préavis non respecté par le salarié',     'retenue', false, false, NULL, 240, 'Indemnité due par le salarié démissionnaire.'),
  ('RET_CONGES',        'Congés pris par anticipation',            'retenue', false, false, NULL, 250, 'Solde de congés négatif au départ.')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Départ sur la fiche ───────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS exit_date   DATE,
  ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(30);

-- ─── 3. Soldes de tout compte ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS final_settlements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id           UUID REFERENCES employee_contracts(id),
  exit_date             DATE NOT NULL,
  reason                VARCHAR(30) NOT NULL CHECK (reason IN (
                          'demission', 'licenciement', 'faute_grave', 'fin_cdd', 'rupture_essai',
                          'depart_negocie', 'retraite', 'deces', 'abandon_poste')),
  notice_worked         BOOLEAN NOT NULL DEFAULT true,
  -- Détail du calcul (ancienneté, salaire de référence, jours, barème) : figé à la validation.
  computation           JSONB NOT NULL,
  leave_indemnity       DECIMAL(12,2) NOT NULL DEFAULT 0,
  notice_indemnity      DECIMAL(12,2) NOT NULL DEFAULT 0,
  severance_indemnity   DECIMAL(12,2) NOT NULL DEFAULT 0,
  damages               DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions            DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- Bulletin du mois de départ qui porte les lignes (salarié payé au mois).
  payroll_id            UUID REFERENCES payroll(id) ON DELETE SET NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'validated' CHECK (status IN ('validated', 'cancelled')),
  notes                 TEXT,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_final_settlements_emp ON final_settlements(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_final_settlements_active ON final_settlements(employee_id) WHERE status = 'validated';

-- Une ligne de bulletin issue d'un solde de tout compte reste rattachée à lui.
ALTER TABLE payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_source_check;
ALTER TABLE payroll_lines ADD CONSTRAINT payroll_lines_source_check CHECK (source IN ('fixe', 'manuel', 'stc'));
