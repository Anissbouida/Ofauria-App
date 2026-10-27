-- 371 — CRM : opportunités et pipeline commercial
--
-- Une opportunité suit une affaire avant le devis : un client existant ou un prospect
-- (nom, société, téléphone, e-mail), une source, un montant espéré, une probabilité,
-- une date de conclusion prévue, un commercial responsable et des activités (appel,
-- rendez-vous, e-mail, tâche) datées. Étapes : nouveau → qualifié → proposition →
-- négociation → gagné | perdu (motif, même référentiel que les devis perdus, mig 365).
-- Un devis se crée depuis l'opportunité (quotes.opportunity_id) : son envoi passe
-- l'opportunité en « proposition », sa transformation en commande la passe « gagnée ».
--
-- Rollback :
--   ALTER TABLE quotes DROP COLUMN opportunity_id ; DROP TABLE crm_activities, opportunities ;
--   DELETE FROM document_sequences WHERE doc_type = 'opportunity' ;
--   DELETE FROM ref_entries WHERE table_id = 'crm_sources' ; DELETE FROM ref_tables WHERE id = 'crm_sources' ;
--   DELETE FROM notification_rules WHERE domain = 'crm' ; DELETE FROM scheduled_jobs WHERE key = 'crm_activities_due' ;
--   DELETE FROM role_permissions WHERE module = 'crm' ; custom_field_defs : retirer 'opportunity' de la contrainte.

CREATE TABLE IF NOT EXISTS opportunities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number              VARCHAR(30) NOT NULL UNIQUE,
  store_id            UUID REFERENCES stores(id),
  title               VARCHAR(200) NOT NULL,
  customer_id         UUID REFERENCES customers(id),
  prospect_name       VARCHAR(160),
  prospect_company    VARCHAR(200),
  prospect_phone      VARCHAR(30),
  prospect_email      VARCHAR(255),
  prospect_city       VARCHAR(100),
  source_code         VARCHAR(40),
  stage               VARCHAR(12) NOT NULL DEFAULT 'new'
                        CHECK (stage IN ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  expected_amount     NUMERIC(14,2) CHECK (expected_amount IS NULL OR expected_amount >= 0),
  probability         SMALLINT NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  owner_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  description         TEXT,
  lost_reason_code    VARCHAR(40),
  lost_note           TEXT,
  closed_at           TIMESTAMPTZ,
  custom_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR prospect_name IS NOT NULL OR prospect_company IS NOT NULL),
  CHECK ((stage IN ('won', 'lost')) = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities (stage, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities (owner_id) WHERE stage NOT IN ('won', 'lost');
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities (customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_custom_fields ON opportunities USING gin (custom_fields);
COMMENT ON TABLE opportunities IS 'Opportunités commerciales (mig 371) : pipeline avant devis.';

CREATE TABLE IF NOT EXISTS crm_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  kind            VARCHAR(10) NOT NULL CHECK (kind IN ('call', 'meeting', 'email', 'task', 'note')),
  subject         VARCHAR(200) NOT NULL,
  due_at          TIMESTAMPTZ,
  done_at         TIMESTAMPTZ,
  outcome         TEXT,
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  notified_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opp ON crm_activities (opportunity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_crm_activities_todo ON crm_activities (assigned_to, due_at) WHERE done_at IS NULL;
COMMENT ON TABLE crm_activities IS 'Activités commerciales (mig 371) : appel, rendez-vous, e-mail, tâche à faire ; note = trace sans échéance.';

DROP TRIGGER IF EXISTS opportunities_touch ON opportunities;
CREATE OR REPLACE FUNCTION trg_opportunities_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER opportunities_touch BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION trg_opportunities_touch();

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id);
CREATE INDEX IF NOT EXISTS idx_quotes_opportunity ON quotes (opportunity_id) WHERE opportunity_id IS NOT NULL;

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('opportunity', 'Opportunité commerciale', 'sales', 'OPP-{YYYY}-{SEQ}', 4, 'year', 'opportunities', 'number', false, 4)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('crm_sources', 'Sources des opportunités', 'D''où vient l''affaire : recommandation, site web, salon…', 'Radar', 'ref_entries', true, 62)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ref_entries (table_id, code, label, description, color, display_order) VALUES
  ('crm_sources', 'referral',  'Recommandation',        NULL, '#198754', 10),
  ('crm_sources', 'inbound',   'Appel ou visite entrant', NULL, '#0d6efd', 20),
  ('crm_sources', 'website',   'Site web / réseaux sociaux', NULL, '#6f42c1', 30),
  ('crm_sources', 'event',     'Salon / événement',     NULL, '#d9822b', 40),
  ('crm_sources', 'outbound',  'Prospection',           NULL, '#20c997', 50),
  ('crm_sources', 'customer',  'Client existant',       NULL, '#6c757d', 60),
  ('crm_sources', 'other',     'Autre',                 NULL, '#adb5bd', 90)
ON CONFLICT (table_id, code) DO NOTHING;

INSERT INTO notification_rules (type, label, domain, email_enabled) VALUES
  ('crm_activity_due', 'Activité commerciale à faire', 'crm', true),
  ('crm_opportunity_assigned', 'Opportunité confiée', 'crm', false)
ON CONFLICT (type) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('crm_activities_due', 'Activités commerciales échues', 'Prévient chaque commercial de ses appels, rendez-vous et tâches arrivés à échéance.', 'sales', 60, 47)
ON CONFLICT (key) DO NOTHING;

-- Droit « CRM » : gérant par défaut (l'admin a tout).
INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete)
SELECT r.code, 'crm', true, true, true, true FROM roles r WHERE r.code = 'manager'
ON CONFLICT (role_code, module) DO NOTHING;

-- Champs personnalisés sur les opportunités (mig 369).
ALTER TABLE custom_field_defs DROP CONSTRAINT IF EXISTS custom_field_defs_entity_check;
ALTER TABLE custom_field_defs ADD CONSTRAINT custom_field_defs_entity_check
  CHECK (entity IN ('customer', 'supplier', 'ingredient', 'packaging_item', 'product', 'order', 'intervention', 'project', 'opportunity'));
