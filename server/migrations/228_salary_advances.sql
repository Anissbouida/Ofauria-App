-- Migration 228 : avances sur salaire — suivi et retenue sur paie
--
-- POURQUOI
--   Aujourd'hui une avance est saisie comme simple depense (categorie
--   "Avances sur salaire") : aucun lien avec la paie, pas de solde par
--   employe, et double comptage en charges (l'avance PUIS le salaire
--   complet passent en 6xxx). Une avance est comptablement une CREANCE
--   sur l'employe (3431 CGNC), soldee par retenue sur les paies suivantes.
--
-- CONTENU
--   1. payments.type accepte 'advance' (decaissement d'avance : sort de la
--      tresorerie mais n'est PAS une charge).
--   2. Table salary_advances : l'avance accordee + solde restant.
--   3. Table salary_advance_repayments : les retenues qui la soldent
--      (lettrage avance <-> paie, une avance peut s'etaler sur N paies).
--   4. Colonne advance_deduction sur payroll / weekly_payroll (montant
--      retenu sur ce bulletin, pour affichage bulletin + audit).
--   5. Compte 3431 "Avances et acomptes au personnel" au plan comptable.
--   6. journal_entries.source_kind accepte 'advance_repayment' (ecriture
--      de retenue 6171 D / 3431 C, sans mouvement de tresorerie).
--
-- INVERSION : DROP TABLE salary_advance_repayments, salary_advances ;
--   retirer 'advance' et 'advance_repayment' des CHECK ; DROP COLUMN
--   advance_deduction ; DELETE FROM accounts WHERE code='3431'.

-- 1. Nouveau type de paiement
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check
  CHECK (type IN ('invoice', 'salary', 'expense', 'income', 'advance'));

-- 2. Avances accordees
CREATE TABLE IF NOT EXISTS salary_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  -- Decaissement reel (ligne payments type='advance'). Nullable : les avances
  -- historiques reprises depuis les depenses gardent leur paiement d'origine.
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  remaining_amount NUMERIC(12,2) NOT NULL CHECK (remaining_amount >= 0),
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'repaid')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_employee ON salary_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_advances_status ON salary_advances(status) WHERE status != 'repaid';

-- 3. Retenues (remboursements) — exactement une paie source par ligne
CREATE TABLE IF NOT EXISTS salary_advance_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES salary_advances(id) ON DELETE CASCADE,
  payroll_id UUID REFERENCES payroll(id),
  weekly_payroll_id UUID REFERENCES weekly_payroll(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  repayment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((payroll_id IS NOT NULL)::int + (weekly_payroll_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_advance_repayments_advance ON salary_advance_repayments(advance_id);
CREATE INDEX IF NOT EXISTS idx_advance_repayments_payroll ON salary_advance_repayments(payroll_id) WHERE payroll_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_advance_repayments_weekly ON salary_advance_repayments(weekly_payroll_id) WHERE weekly_payroll_id IS NOT NULL;

-- 4. Retenue portee par le bulletin
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS advance_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE weekly_payroll ADD COLUMN IF NOT EXISTS advance_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 5. Compte de creance personnel (CGNC classe 3)
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side)
VALUES ('3431', 'Avances et acomptes au personnel', 3, '34', '343', 'asset', 'D')
ON CONFLICT (code) DO NOTHING;

-- 6. Source d'ecriture pour la retenue
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check
  CHECK (source_kind IN ('manual','invoice','payment','sale','reversal','backfill','shift_entry','advance_repayment'));
