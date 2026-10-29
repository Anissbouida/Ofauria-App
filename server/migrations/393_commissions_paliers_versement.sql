-- 393 — Commissions : contrats-cadres à paliers + versement sur bulletin de paie
--
-- POURQUOI
--   Les barèmes de commission (mig 123, employee_commissions) étaient des taux
--   FIXES par vendeur/produit. Il manquait (1) les barèmes à PALIERS progressifs
--   (contrats-cadres : plus le vendeur vend, plus le taux monte) et (2) le
--   versement effectif de la commission due sur le bulletin de paie.
--
-- QUOI
--   1. commission_schemes       : un contrat-cadre nommé (barème à paliers).
--   2. commission_scheme_tiers  : les paliers (seuil bas inclus → taux), progressifs.
--   3. employee_commission_schemes : affectation d'un contrat-cadre à un vendeur,
--      avec période de validité (un vendeur affecté à un contrat-cadre est commissionné
--      aux paliers sur sa base de ventes ; sinon il reste aux taux fixes mig 123).
--   4. commission_payouts       : trace d'un versement d'une période sur la paie,
--      idempotent par (vendeur, période). Le versement crée un élément fixe de paie
--      (employee_payroll_items) rattaché à la rubrique COMMISSION → repris comme
--      gain sur le bulletin du mois de paie (soumis CNSS + IR).
--   5. Rubrique de paie COMMISSION (gain imposable) si absente.
--
-- INVERSION
--   DROP TABLE commission_payouts, employee_commission_schemes,
--     commission_scheme_tiers, commission_schemes;
--   DELETE FROM payroll_rubriques WHERE code = 'COMMISSION';

CREATE TABLE IF NOT EXISTS commission_schemes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  store_id    UUID REFERENCES stores(id),
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE commission_schemes IS 'Contrat-cadre de commissionnement à paliers (mig 393).';

CREATE TABLE IF NOT EXISTS commission_scheme_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id     UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE CASCADE,
  from_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (from_amount >= 0),
  rate_percent  NUMERIC(6,3) NOT NULL CHECK (rate_percent >= 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scheme_id, from_amount)
);
COMMENT ON TABLE commission_scheme_tiers IS 'Paliers progressifs : la tranche de base ≥ from_amount est commissionnée à rate_percent (mig 393).';

CREATE TABLE IF NOT EXISTS employee_commission_schemes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  scheme_id   UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE CASCADE,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_comm_scheme ON employee_commission_schemes (employee_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS commission_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id),
  period_from      DATE NOT NULL,
  period_to        DATE NOT NULL,
  pay_month        INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  pay_year         INTEGER NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  basis            NUMERIC(14,2) NOT NULL DEFAULT 0,
  source           VARCHAR(10) NOT NULL DEFAULT 'rules' CHECK (source IN ('rules', 'scheme')),
  payroll_item_id  UUID REFERENCES employee_payroll_items(id) ON DELETE SET NULL,
  store_id         UUID REFERENCES stores(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_from, period_to)
);
COMMENT ON TABLE commission_payouts IS 'Versement d''une période de commissions sur la paie (idempotent par vendeur+période) — mig 393.';

INSERT INTO payroll_rubriques (code, label, kind, soumis_cnss, soumis_ir, is_active, sort_order, notes)
VALUES ('COMMISSION', 'Commissions commerciales', 'gain', true, true, true, 260, 'Commissions versées depuis le module Commissions (mig 393).')
ON CONFLICT (code) DO NOTHING;
