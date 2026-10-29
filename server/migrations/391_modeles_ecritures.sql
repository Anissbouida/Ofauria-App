-- Migration 391 : modèles d'écritures comptables
--
-- POURQUOI
--   Les écritures manuelles récurrentes (provisions, abonnements, OD mensuelles
--   type « loyer », réctifications types) étaient resaisies ligne par ligne à
--   chaque fois. Un modèle fige la structure (journal, comptes, sens, libellés,
--   montants par défaut) ; on l'instancie à une date donnée, en ajustant les
--   montants au besoin, et l'écriture est posée au grand livre.
--
-- PORTEE
--   Deux tables de paramétrage. L'instanciation crée une écriture ordinaire
--   (source_kind 'manual', source_id NULL, source_detail 'template:<id>'),
--   équilibrée et posée comme n'importe quelle OD manuelle (persistCcaEntry).
--
-- INVERSION
--   DROP TABLE IF EXISTS journal_entry_template_lines;
--   DROP TABLE IF EXISTS journal_entry_templates;

CREATE TABLE IF NOT EXISTS journal_entry_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(160) NOT NULL,
  journal_code  VARCHAR(10) NOT NULL DEFAULT 'OD',
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  store_id      UUID REFERENCES stores(id),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jet_active ON journal_entry_templates (is_active, name);

CREATE TABLE IF NOT EXISTS journal_entry_template_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES journal_entry_templates(id) ON DELETE CASCADE,
  line_order  INTEGER NOT NULL DEFAULT 0,
  account_id  UUID NOT NULL REFERENCES accounts(id),
  side        VARCHAR(6) NOT NULL CHECK (side IN ('debit', 'credit')),
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  label       VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS idx_jetl_template ON journal_entry_template_lines (template_id, line_order);
