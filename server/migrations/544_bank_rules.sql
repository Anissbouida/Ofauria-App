-- G4-02 (plan d'action 2026-11) — rapprochement bancaire par règles.
--
-- Le rapprochement automatique ne savait faire qu'une chose : montant exact à ± 7 jours,
-- une requête par ligne de relevé. Le moteur (services/bank-matching.ts) passe désormais
-- en quatre temps : référence exacte (numéro de facture, de chèque ou de règlement lu dans
-- le libellé), règles, montant et date avec tolérance, regroupement (un virement pour
-- plusieurs écritures). Il PROPOSE avec un degré de confiance ; l'utilisateur valide.
--
-- bank_rules : règles saisies par l'utilisateur, appliquées par ordre de priorité.
--   label_contains / label_regex : condition sur le libellé (sans tenir compte de la casse)
--   direction, amount_min, amount_max : sens et plage de montant
--   action = 'match'      : rapprocher à une écriture existante, avec tolérances
--          = 'post_entry' : générer l'écriture (frais bancaires, commissions, agios) sur
--                           counter_account_id, puis la rapprocher
--
-- bank_statement_line_matches : une ligne de relevé peut solder PLUSIEURS lignes
--   d'écriture (virement reçu pour trois factures, remise de chèques). Une ligne
--   d'écriture n'est rapprochée qu'une fois (clé primaire). matched_entry_line_id reste
--   renseigné avec la première, pour les écrans existants.
--
-- INVERSION : DROP TABLE bank_statement_line_matches; DROP TABLE bank_rules;
--             ALTER TABLE bank_statement_lines DROP COLUMN IF EXISTS match_method,
--               DROP COLUMN IF EXISTS match_rule_id, DROP COLUMN IF EXISTS match_confidence,
--               DROP COLUMN IF EXISTS generated_entry_id;
CREATE TABLE IF NOT EXISTS bank_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority            integer NOT NULL DEFAULT 100,
  label               varchar(120) NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  label_contains      varchar(120),
  label_regex         varchar(200),
  direction           varchar(3),
  amount_min          numeric(14,2),
  amount_max          numeric(14,2),
  action              varchar(12) NOT NULL DEFAULT 'match',
  counter_account_id  uuid REFERENCES accounts(id),
  entry_label         varchar(120),
  amount_tolerance    numeric(14,2) NOT NULL DEFAULT 0,
  date_tolerance_days integer NOT NULL DEFAULT 7,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_bank_rules_direction CHECK (direction IS NULL OR direction IN ('in', 'out')),
  CONSTRAINT chk_bank_rules_action CHECK (action IN ('match', 'post_entry')),
  CONSTRAINT chk_bank_rules_condition CHECK (label_contains IS NOT NULL OR label_regex IS NOT NULL OR amount_min IS NOT NULL OR amount_max IS NOT NULL),
  CONSTRAINT chk_bank_rules_counter CHECK (action <> 'post_entry' OR counter_account_id IS NOT NULL),
  CONSTRAINT chk_bank_rules_tolerance CHECK (amount_tolerance >= 0 AND date_tolerance_days BETWEEN 0 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_bank_rules_priority ON bank_rules (priority, created_at) WHERE is_active;

ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS match_method       varchar(12);
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS match_rule_id      uuid REFERENCES bank_rules(id) ON DELETE SET NULL;
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS match_confidence   numeric(5,2);
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS generated_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS bank_statement_line_matches (
  entry_line_id uuid PRIMARY KEY REFERENCES journal_entry_lines(id) ON DELETE CASCADE,
  bank_line_id  uuid NOT NULL REFERENCES bank_statement_lines(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_line_matches_bank ON bank_statement_line_matches (bank_line_id);

-- Reprise : les rapprochements existants (une ligne pour une écriture) entrent dans la table.
INSERT INTO bank_statement_line_matches (entry_line_id, bank_line_id)
SELECT matched_entry_line_id, id FROM bank_statement_lines
 WHERE matched_entry_line_id IS NOT NULL
ON CONFLICT (entry_line_id) DO NOTHING;
UPDATE bank_statement_lines SET match_method = 'manual' WHERE matched_entry_line_id IS NOT NULL AND match_method IS NULL;
