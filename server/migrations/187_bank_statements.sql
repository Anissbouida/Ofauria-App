-- Migration 187 : Rapprochement bancaire
--
-- POURQUOI
--   Le compte 5141 (Banque) du grand livre doit correspondre au releve reel
--   de la banque. Le rapprochement consiste a pointer chaque ligne du releve
--   contre l'ecriture comptable correspondante, et a identifier les ecarts :
--     - ligne au releve sans ecriture (ex : agios bancaires pas encore saisis)
--     - ecriture sans ligne au releve (ex : cheque emis pas encore debite)
--
-- PORTEE
--   Tables nouvelles : bank_statements, bank_statement_lines.
--   Aucune table existante modifiee.
--
-- INVERSION
--   DROP TABLE bank_statement_lines; DROP TABLE bank_statements;

-- ============================================================================
-- 1. Releves bancaires
-- ============================================================================
CREATE TABLE IF NOT EXISTS bank_statements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label            VARCHAR(200) NOT NULL,
  account_id       UUID NOT NULL REFERENCES accounts(id),     -- 5141 (ou 5161 si caisse)
  statement_date   DATE NOT NULL,
  opening_balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
  closing_balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
  store_id         UUID REFERENCES stores(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_statements_account ON bank_statements(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_statements_date    ON bank_statements(statement_date);

COMMENT ON TABLE bank_statements IS
  'En-tete d''un releve bancaire importe. account_id = compte de tresorerie concerne (5141).';

-- ============================================================================
-- 2. Lignes de releve
-- ============================================================================
-- direction : 'in'  = encaissement (notre 5141 debite, le solde augmente)
--             'out' = decaissement (notre 5141 credite, le solde baisse)
-- matched_entry_line_id : ligne d'ecriture (journal_entry_lines) rapprochee.

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_statement_id     UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  operation_date        DATE NOT NULL,
  label                 VARCHAR(300),
  reference             VARCHAR(100),
  amount                DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  direction             VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
  -- Rapprochement
  matched_entry_line_id UUID REFERENCES journal_entry_lines(id) ON DELETE SET NULL,
  reconciled            BOOLEAN NOT NULL DEFAULT false,
  reconciled_at         TIMESTAMPTZ,
  reconciled_by         UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bsl_statement   ON bank_statement_lines(bank_statement_id);
CREATE INDEX IF NOT EXISTS idx_bsl_matched     ON bank_statement_lines(matched_entry_line_id) WHERE matched_entry_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bsl_reconciled  ON bank_statement_lines(reconciled);

COMMENT ON TABLE bank_statement_lines IS
  'Lignes d''un releve bancaire. direction in=encaissement (5141 debit), out=decaissement (5141 credit).';
