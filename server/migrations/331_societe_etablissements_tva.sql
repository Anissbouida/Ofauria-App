-- ═══════════════════════════════════════════════════════════════════════
-- 331 — Société, établissements et TVA (audit Paramètres, lot 5)
--
--   1. Fiche société complétée : forme juridique, capital, site web
--      (l'identité légale vient de la mig 326).
--   2. company_bank_accounts : comptes bancaires de la société (RIB contrôlé
--      par sa clé, compte comptable 514x, compte par défaut, affichage sur
--      les factures). Jusqu'ici aucun RIB société n'était saisi.
--   3. Établissements (stores) : code court, type (boutique, laboratoire,
--      entrepôt, siège), responsable, e-mail, patente propre, horaires.
--   4. tax_codes : codes de TVA datés. Même définition et mêmes taux que la
--      mig 309 (travail achats, pas encore livrée partout) : CREATE ... IF NOT
--      EXISTS et ON CONFLICT DO NOTHING, les deux migrations peuvent passer
--      dans n'importe quel ordre. Un taux qui change = une nouvelle ligne datée.
--
-- INVERSION
--   ALTER TABLE company_settings DROP COLUMN legal_form, legal_capital, legal_website ;
--   DROP TABLE company_bank_accounts ;
--   ALTER TABLE stores DROP COLUMN code, kind, manager_user_id, email, patente,
--     opening_hours, is_headquarters ;
--   (tax_codes : laisser si la mig 309 est passée, sinon DROP TABLE tax_codes.)
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Fiche société ──────────────────────────────────────────────────────
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS legal_form    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS legal_capital NUMERIC(14,2) CHECK (legal_capital IS NULL OR legal_capital >= 0),
  ADD COLUMN IF NOT EXISTS legal_website VARCHAR(120);

-- 2. Comptes bancaires ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label             VARCHAR(80) NOT NULL,
  bank_name         VARCHAR(80) NOT NULL,
  rib               CHAR(24) NOT NULL UNIQUE CHECK (rib ~ '^[0-9]{24}$'),
  swift             VARCHAR(11) CHECK (swift IS NULL OR swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  ledger_account    VARCHAR(10),
  store_id          UUID REFERENCES stores(id) ON DELETE SET NULL,
  is_default        BOOLEAN NOT NULL DEFAULT false,
  show_on_invoices  BOOLEAN NOT NULL DEFAULT true,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL
);
-- Un seul compte par défaut.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_bank_default ON company_bank_accounts ((true)) WHERE is_default AND is_active;
COMMENT ON TABLE company_bank_accounts IS 'Comptes bancaires de la société (mig 331) : RIB 24 chiffres, clé contrôlée par l''API.';

-- 3. Établissements ─────────────────────────────────────────────────────
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS code            VARCHAR(10),
  ADD COLUMN IF NOT EXISTS kind            VARCHAR(15) NOT NULL DEFAULT 'shop',
  ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email           VARCHAR(120),
  ADD COLUMN IF NOT EXISTS patente         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS opening_hours   JSONB,
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_kind_check;
ALTER TABLE stores ADD CONSTRAINT stores_kind_check CHECK (kind IN ('shop', 'workshop', 'warehouse', 'office', 'mixed'));
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_code_format;
ALTER TABLE stores ADD CONSTRAINT stores_code_format CHECK (code IS NULL OR code ~ '^[A-Z0-9]{2,10}$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_code ON stores (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_headquarters ON stores ((true)) WHERE is_headquarters;

-- 4. Codes de TVA datés (identique à la mig 309) ────────────────────────
CREATE TABLE IF NOT EXISTS tax_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  code         VARCHAR(20) NOT NULL,
  label        VARCHAR(120) NOT NULL,
  rate         NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  kind         VARCHAR(25) NOT NULL CHECK (kind IN ('standard', 'reduced', 'zero', 'exempt_without_credit', 'exempt_with_credit', 'out_of_scope')),
  recoverable  BOOLEAN NOT NULL DEFAULT true,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  legal_ref    TEXT,
  UNIQUE (country_code, code, valid_from)
);
COMMENT ON TABLE tax_codes IS 'Codes de TVA datés par pays (pack pays, mig 309). Un taux qui change = une nouvelle ligne datée, jamais une mise à jour.';

INSERT INTO tax_codes (country_code, code, label, rate, kind, recoverable, valid_from, valid_to, legal_ref) VALUES
  ('MA', 'N20',     'TVA 20 %',                                 20, 'standard', true,  '2000-01-01', NULL,         'CGI art. 98'),
  ('MA', 'R14',     'TVA 14 %',                                 14, 'reduced',  true,  '2000-01-01', '2025-12-31', 'CGI art. 99 (résorbé par les LF 2024-2026)'),
  ('MA', 'R10',     'TVA 10 %',                                 10, 'reduced',  true,  '2000-01-01', NULL,         'CGI art. 99'),
  ('MA', 'R7',      'TVA 7 %',                                   7, 'reduced',  true,  '2000-01-01', '2025-12-31', 'CGI art. 99 (résorbé par les LF 2024-2026)'),
  ('MA', 'EXO_SDD', 'Exonéré sans droit à déduction (art. 91)', 0, 'exempt_without_credit', false, '2000-01-01', NULL, 'CGI art. 91 (farine, lait, beurre, sucre brut, levure fraîche…)'),
  ('MA', 'HC',      'Hors champ / non assujetti',                0, 'out_of_scope', false, '2000-01-01', NULL,       'Fournisseur non assujetti, achat au marché')
ON CONFLICT (country_code, code, valid_from) DO NOTHING;

-- Pas deux périodes qui se chevauchent pour un même code (contrôle aussi fait par l'API).
CREATE OR REPLACE FUNCTION trg_tax_codes_no_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tax_codes t
     WHERE t.country_code = NEW.country_code AND t.code = NEW.code AND t.id <> NEW.id
       AND daterange(t.valid_from, COALESCE(t.valid_to, 'infinity'::date), '[]')
           && daterange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Le code TVA % a déjà un taux sur cette période', NEW.code USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_codes_no_overlap ON tax_codes;
CREATE TRIGGER tax_codes_no_overlap BEFORE INSERT OR UPDATE ON tax_codes
  FOR EACH ROW EXECUTE FUNCTION trg_tax_codes_no_overlap();

-- Journal du paramétrage (mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS company_bank_accounts_config_audit ON company_bank_accounts;
    CREATE TRIGGER company_bank_accounts_config_audit AFTER INSERT OR UPDATE OR DELETE ON company_bank_accounts
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', '');
    DROP TRIGGER IF EXISTS tax_codes_config_audit ON tax_codes;
    CREATE TRIGGER tax_codes_config_audit AFTER INSERT OR UPDATE OR DELETE ON tax_codes
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', '');
  END IF;
END $$;
