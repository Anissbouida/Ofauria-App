-- ═══════════════════════════════════════════════════════════════════════
-- 426 — Import des relevés bancaires (feuille de route compta, lot Important 7)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Le relevé ne s'importait qu'en collant un CSV au format figé
--   (date;libellé;débit;crédit), lu dans le navigateur, sans contrôle de
--   doublons : réimporter un relevé dédoublait le pointage. Les banques
--   fournissent du CSV à colonnes variables, de l'Excel, de l'OFX, du MT940
--   (SWIFT) ou du CFONB 120.
--
-- QUOI
--   1. bank_import_profiles : correspondance de colonnes réutilisable pour un
--      CSV/Excel de banque (séparateur, décimale, format de date, colonnes).
--   2. bank_statements : origine de l'import (format, fichier, empreinte,
--      profil, compte de trésorerie) et nombre de doublons écartés.
--   3. bank_statement_lines : date de valeur et empreinte de dédoublonnage
--      = SHA-256(compte | date | sens | montant | rang de l'opération identique
--      dans le relevé). Unique : une opération déjà importée ne revient pas,
--      même depuis un autre format. Reprise sur les lignes existantes.
--
-- INVERSION
--   DROP INDEX uq_bsl_fingerprint ;
--   ALTER TABLE bank_statement_lines DROP COLUMN fingerprint, DROP COLUMN value_date ;
--   ALTER TABLE bank_statements DROP COLUMN source_format, DROP COLUMN file_name,
--     DROP COLUMN file_sha256, DROP COLUMN profile_id, DROP COLUMN treasury_account_id,
--     DROP COLUMN duplicates_skipped ;
--   DROP TABLE bank_import_profiles.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bank_import_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(100) NOT NULL UNIQUE,
  delimiter      varchar(5),                       -- NULL = détection automatique
  decimal_sep    char(1) NOT NULL DEFAULT ',' CHECK (decimal_sep IN (',', '.')),
  date_format    varchar(12) NOT NULL DEFAULT 'DD/MM/YYYY'
                   CHECK (date_format IN ('DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'YYYY-MM-DD', 'MM/DD/YYYY')),
  skip_rows      smallint NOT NULL DEFAULT 0 CHECK (skip_rows BETWEEN 0 AND 50),
  has_header     boolean NOT NULL DEFAULT true,
  -- Colonnes (rang à partir de 0) ; débit/crédit séparés OU montant signé.
  col_date       smallint NOT NULL,
  col_value_date smallint,
  col_label      smallint NOT NULL,
  col_label2     smallint,
  col_reference  smallint,
  col_debit      smallint,
  col_credit     smallint,
  col_amount     smallint,
  negative_is_out boolean NOT NULL DEFAULT true,   -- montant signé : négatif = sortie
  treasury_account_id uuid REFERENCES treasury_accounts(id),
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((col_debit IS NOT NULL OR col_credit IS NOT NULL) <> (col_amount IS NOT NULL))
);
COMMENT ON TABLE bank_import_profiles IS
  'Mig 426 : correspondance de colonnes d''un relevé CSV/Excel de banque, réutilisable.';

-- Profils de départ : l'ancien format collé, et le montant signé.
INSERT INTO bank_import_profiles (name, delimiter, decimal_sep, date_format, has_header, col_date, col_label, col_debit, col_credit)
VALUES ('Date ; libellé ; débit ; crédit', NULL, ',', 'DD/MM/YYYY', true, 0, 1, 2, 3)
ON CONFLICT (name) DO NOTHING;
INSERT INTO bank_import_profiles (name, delimiter, decimal_sep, date_format, has_header, col_date, col_label, col_amount)
VALUES ('Date ; libellé ; montant signé', NULL, ',', 'DD/MM/YYYY', true, 0, 1, 2)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE bank_statements
  ADD COLUMN IF NOT EXISTS source_format       varchar(10),
  ADD COLUMN IF NOT EXISTS file_name           varchar(255),
  ADD COLUMN IF NOT EXISTS file_sha256         char(64),
  ADD COLUMN IF NOT EXISTS profile_id          uuid REFERENCES bank_import_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS treasury_account_id uuid REFERENCES treasury_accounts(id),
  ADD COLUMN IF NOT EXISTS duplicates_skipped  integer NOT NULL DEFAULT 0;

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS value_date  date,
  ADD COLUMN IF NOT EXISTS fingerprint char(64);

-- Reprise : empreinte des lignes déjà importées (même canon que le serveur).
UPDATE bank_statement_lines l
   SET fingerprint = x.fp
  FROM (SELECT l2.id,
               encode(sha256(convert_to(
                 b.account_id::text || '|' || l2.operation_date::text || '|' || l2.direction || '|'
                 || to_char(l2.amount, 'FM999999999990.00') || '|'
                 || row_number() OVER (PARTITION BY b.account_id, l2.operation_date, l2.direction, l2.amount
                                       ORDER BY l2.created_at, l2.id), 'UTF8')), 'hex') AS fp
          FROM bank_statement_lines l2 JOIN bank_statements b ON b.id = l2.bank_statement_id) x
 WHERE x.id = l.id AND l.fingerprint IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bsl_fingerprint ON bank_statement_lines (fingerprint) WHERE fingerprint IS NOT NULL;
COMMENT ON COLUMN bank_statement_lines.fingerprint IS
  'Mig 426 : SHA-256(compte|date|sens|montant|rang de l''opération identique) — une opération bancaire n''est importée qu''une fois.';
