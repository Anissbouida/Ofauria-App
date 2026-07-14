-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 241 — Baremes fiscaux CNSS/AMO/IR versionnes
--
-- Aujourd'hui les taux marocains sont en dur dans employee.repository.ts :
-- un changement de loi de finances imposerait de recalculer TOUT l'historique
-- (car le code recalcule les bulletins non-payes a chaque generate). Cette
-- table permet de :
--   - Nouvelle version chaque annee : `effective_from` (date d'effet)
--   - Le repo doit charger le bareme dont effective_from est le plus recent
--     et <= period_start du bulletin genere
--   - Historique intact : les bulletins deja payes conservent leur snapshot
--
-- APPLY_SOCIAL_DEDUCTIONS = false actuellement -> le bareme n'est PAS utilise
-- en production (etablissement pas encore declare CNSS). Table prete pour
-- le jour ou le flag passera a true.
--
-- Convention hebdo : les employes 'weekly' n'ont PAS de cotisations dans le
-- modele actuel (extras/journaliers, hors declaration CNSS). Documente ici
-- pour justifier l'absence de colonnes weekly-specifiques.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_tax_scales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from DATE NOT NULL UNIQUE,
  effective_to DATE,  -- NULL = en cours
  label VARCHAR(100) NOT NULL,

  -- CNSS (Caisse Nationale de Securite Sociale)
  cnss_plafond DECIMAL(10,2) NOT NULL,     -- assiette max mensuelle
  cnss_rate_employee DECIMAL(6,4) NOT NULL, -- ex. 0.0448 = 4,48%
  cnss_rate_employer DECIMAL(6,4) NOT NULL,

  -- AMO (Assurance Maladie Obligatoire)
  amo_rate_employee DECIMAL(6,4) NOT NULL,
  amo_rate_employer DECIMAL(6,4) NOT NULL,

  -- Charges patronales
  alloc_familiales_rate DECIMAL(6,4) NOT NULL,
  taxe_fp_rate DECIMAL(6,4) NOT NULL,

  -- Frais professionnels
  frais_pro_rate DECIMAL(6,4) NOT NULL,
  frais_pro_plafond DECIMAL(10,2) NOT NULL,

  -- Deductions personnelles
  deduction_famille DECIMAL(10,2) NOT NULL, -- par personne a charge / mois

  -- Bareme IR annuel progressif : JSONB pour flexibilite.
  -- Format: [{"threshold": 30000, "rate": 0.0}, {"threshold": 50000, "rate": 0.10}, ...]
  -- Interpretation : jusqu'a threshold[i], le taux marginal rate[i] s'applique.
  ir_brackets JSONB NOT NULL,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payroll_tax_scales_period_valid CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_tax_scales_from ON payroll_tax_scales(effective_from DESC);

-- Seed : bareme 2025 (celui actuellement code en dur dans employee.repository.ts).
INSERT INTO payroll_tax_scales (
  effective_from, effective_to, label,
  cnss_plafond, cnss_rate_employee, cnss_rate_employer,
  amo_rate_employee, amo_rate_employer,
  alloc_familiales_rate, taxe_fp_rate,
  frais_pro_rate, frais_pro_plafond,
  deduction_famille,
  ir_brackets, notes
) VALUES (
  '2025-01-01', NULL, 'Bareme fiscal marocain 2025',
  6000, 0.0448, 0.0898,
  0.0226, 0.0411,
  0.064, 0.016,
  0.20, 2500,
  30,
  '[
    {"threshold": 30000,  "rate": 0.00, "cumulative": 0},
    {"threshold": 50000,  "rate": 0.10, "cumulative": 0},
    {"threshold": 60000,  "rate": 0.20, "cumulative": 2000},
    {"threshold": 80000,  "rate": 0.30, "cumulative": 4000},
    {"threshold": 180000, "rate": 0.34, "cumulative": 10000},
    {"threshold": null,   "rate": 0.38, "cumulative": 44000}
  ]'::jsonb,
  'Bareme initial (loi de finances 2025). Cumulative = IR accumule au seuil precedent — sert au calcul progressif.'
)
ON CONFLICT (effective_from) DO NOTHING;

COMMENT ON TABLE payroll_tax_scales IS
  'Baremes fiscaux marocains versionnes par date d''effet. Le repo doit
   selectionner la version dont effective_from est <= period_start du bulletin.
   APPLY_SOCIAL_DEDUCTIONS=false actuellement -> non utilise en prod.';
