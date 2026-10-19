-- ═══════════════════════════════════════════════════════════════════════
-- 322 — Contrats, avenants et documents du salarié, lot 4 refonte RH
--   1. Historique des contrats (Code du travail art. 13-17) : contrat
--      initial, avenants (salaire, poste, horaires, type), renouvellements
--      de CDD ; période d'essai (cadre 3 mois, employé 1,5 mois, ouvrier
--      15 jours, renouvelable une fois). Le contrat actif alimente la fiche
--      employé (contract_type, dates, salaire) : une seule source de vérité.
--   2. Documents (CIN, contrat signé, CNSS, diplômes, visite médicale…)
--      stockés en base (le disque Cloud Run est éphémère), avec échéance.
--   3. Reprise : un contrat initial par employé depuis sa fiche actuelle.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Contrats ───────────────────────────────────────────────────────
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_contract_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_contract_type_check
  CHECK (contract_type IS NULL OR contract_type IN ('cdi', 'cdd', 'stage', 'interim', 'saisonnier'));

CREATE TABLE IF NOT EXISTS employee_contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- contrat : initial ; avenant : modification ; renouvellement : CDD prolongé.
  kind                VARCHAR(15) NOT NULL DEFAULT 'contrat' CHECK (kind IN ('contrat', 'avenant', 'renouvellement')),
  parent_id           UUID REFERENCES employee_contracts(id),
  contract_type       VARCHAR(20) NOT NULL CHECK (contract_type IN ('cdi', 'cdd', 'stage', 'interim', 'saisonnier')),
  category            VARCHAR(10) NOT NULL DEFAULT 'employe' CHECK (category IN ('cadre', 'employe', 'ouvrier')),
  job_title           VARCHAR(120),
  start_date          DATE NOT NULL,
  end_date            DATE,
  trial_end_date      DATE,
  trial_renewed       BOOLEAN NOT NULL DEFAULT false,
  weekly_hours        DECIMAL(5,2) NOT NULL DEFAULT 44 CHECK (weekly_hours > 0 AND weekly_hours <= 60),
  monthly_salary      DECIMAL(10,2) CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  weekly_salary       DECIMAL(10,2) CHECK (weekly_salary IS NULL OR weekly_salary >= 0),
  -- active : en vigueur ; superseded : remplacé par un avenant/renouvellement ;
  -- ended : terminé (fin de CDD, rupture — solde de tout compte au lot 6).
  status              VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'ended')),
  end_reason          VARCHAR(200),
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_contracts_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employee_contracts_trial CHECK (trial_end_date IS NULL OR trial_end_date >= start_date),
  CONSTRAINT employee_contracts_cdd_end CHECK (contract_type <> 'cdd' OR end_date IS NOT NULL OR status <> 'active')
);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_emp ON employee_contracts(employee_id, start_date DESC);
-- Un seul contrat actif par employé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_contracts_active ON employee_contracts(employee_id) WHERE status = 'active';

-- ─── 2. Documents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id   UUID REFERENCES employee_contracts(id) ON DELETE SET NULL,
  doc_type      VARCHAR(30) NOT NULL CHECK (doc_type IN (
                  'cin', 'contrat', 'avenant', 'cnss', 'diplome', 'certificat_medical',
                  'visite_medicale', 'rib', 'attestation', 'photo', 'autre')),
  title         VARCHAR(150) NOT NULL,
  expires_on    DATE,
  file_name     VARCHAR(200) NOT NULL,
  mime_type     VARCHAR(80) NOT NULL,
  size_bytes    INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  content       BYTEA NOT NULL,
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_emp ON employee_documents(employee_id, doc_type);

-- Échéance de la CIN sur la fiche (pièce d'identité à jour).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cin_expires_on DATE;

-- ─── 3. Reprise des contrats existants ────────────────────────────────
-- Un CDD sans date de fin ne peut pas être actif : repris en CDI à vérifier.
INSERT INTO employee_contracts (employee_id, kind, contract_type, start_date, end_date, monthly_salary, weekly_salary, status, notes)
SELECT e.id, 'contrat',
       CASE WHEN COALESCE(e.contract_type, 'cdi') = 'cdd' AND e.contract_end IS NULL THEN 'cdi' ELSE COALESCE(e.contract_type, 'cdi') END,
       COALESCE(e.contract_start, e.hire_date, CURRENT_DATE),
       CASE WHEN e.contract_end IS NOT NULL AND e.contract_end >= COALESCE(e.contract_start, e.hire_date, CURRENT_DATE) THEN e.contract_end END,
       e.monthly_salary, e.weekly_salary,
       CASE WHEN e.is_active THEN 'active' ELSE 'ended' END,
       CASE WHEN COALESCE(e.contract_type, 'cdi') = 'cdd' AND e.contract_end IS NULL
            THEN 'Reprise : CDD sans date de fin, repris en CDI — à vérifier'
            ELSE 'Reprise de la fiche employé (migration 322)' END
  FROM employees e
 WHERE NOT EXISTS (SELECT 1 FROM employee_contracts c WHERE c.employee_id = e.id);

-- Type « saisonnier » dans le référentiel des types de contrat.
INSERT INTO ref_entries (table_id, code, label, display_order)
SELECT 'contract_types', 'saisonnier', 'Saisonnier', 50
 WHERE EXISTS (SELECT 1 FROM ref_tables WHERE id = 'contract_types')
ON CONFLICT (table_id, code) DO NOTHING;
