-- 365 — Devis clients et facture proforma
--
-- Un devis chiffre une offre pour un client existant ou pour un prospect (nom, société,
-- téléphone, e-mail saisis sans fiche). Cycle : brouillon → envoyé → accepté | refusé |
-- expiré ; un devis accepté se convertit en commande (mêmes règles que la saisie d'une
-- commande : sourcing stock / production, BL et facture pour un professionnel).
-- Un devis refusé ou expiré porte un motif de perte (référentiel éditable) pour l'analyse.
--
-- Prix : `with_tax` = prix HT + TVA par ligne (professionnel) ; sinon prix TTC sans TVA
-- (particulier), comme les commandes (mig 354). Remise globale en % (mig 355).
--
-- Proforma : même contenu, titre « Facture proforma » et numéro PF propre attribué à la
-- première édition ; aucun effet comptable (ce n'est pas une facture).
--
-- Rollback :
--   DROP TABLE quote_events, quote_items, quotes ;
--   DELETE FROM document_sequences WHERE doc_type IN ('quote', 'proforma') ;
--   DELETE FROM document_templates WHERE doc_type = 'quote' ;
--   DELETE FROM ref_entries WHERE table_id = 'quote_lost_reasons' ; DELETE FROM ref_tables WHERE id = 'quote_lost_reasons' ;
--   DELETE FROM scheduled_jobs WHERE key = 'quotes_expire' ; DELETE FROM notification_rules WHERE domain = 'quotes'.

CREATE TABLE IF NOT EXISTS quotes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number             VARCHAR(30) NOT NULL UNIQUE,
  store_id           UUID REFERENCES stores(id),
  customer_id        UUID REFERENCES customers(id),
  -- Prospect sans fiche : au moins un nom (contrôle ci-dessous).
  prospect_name      VARCHAR(160),
  prospect_company   VARCHAR(200),
  prospect_phone     VARCHAR(30),
  prospect_email     VARCHAR(255),
  title              VARCHAR(200),
  status             VARCHAR(12) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'sent', 'accepted', 'refused', 'expired', 'converted', 'cancelled')),
  quote_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until        DATE NOT NULL,
  with_tax           BOOLEAN NOT NULL DEFAULT false,
  discount_pct       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_terms     VARCHAR(300),
  notes              TEXT,
  internal_notes     TEXT,
  sent_at            TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  lost_reason_code   VARCHAR(40),
  lost_note          TEXT,
  order_id           UUID REFERENCES orders(id),
  converted_at       TIMESTAMPTZ,
  proforma_number    VARCHAR(30) UNIQUE,
  revision_of        UUID REFERENCES quotes(id),
  expiry_notified_at TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR prospect_name IS NOT NULL OR prospect_company IS NOT NULL),
  CHECK (valid_until >= quote_date),
  CHECK ((status = 'converted') = (order_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes (status, valid_until);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes (customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created  ON quotes (created_at DESC);
COMMENT ON TABLE quotes IS 'Devis clients (mig 365) : offre chiffrée, convertie en commande une fois acceptée.';

CREATE TABLE IF NOT EXISTS quote_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id),
  description    VARCHAR(300),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  tva_rate       NUMERIC(5,2) CHECK (tva_rate IS NULL OR tva_rate BETWEEN 0 AND 100),
  subtotal       NUMERIC(12,2) NOT NULL,
  display_order  SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items (quote_id);

CREATE TABLE IF NOT EXISTS quote_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  event_type  VARCHAR(30) NOT NULL,
  from_value  VARCHAR(40),
  to_value    VARCHAR(40),
  note        TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_events ON quote_events (quote_id, created_at);

DROP TRIGGER IF EXISTS quotes_touch ON quotes;
CREATE OR REPLACE FUNCTION trg_quotes_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER quotes_touch BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION trg_quotes_touch();

-- Séries de numéros
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('quote',    'Devis client',      'sales', 'DV-{YYYY}-{SEQ}', 4, 'year', 'quotes', 'number',          false, 5),
       ('proforma', 'Facture proforma',  'sales', 'PF-{YYYY}-{SEQ}', 4, 'year', 'quotes', 'proforma_number', false, 6)
ON CONFLICT (doc_type) DO NOTHING;

-- Mentions du PDF (Paramètres › Documents)
INSERT INTO document_templates (doc_type, label, payment_terms, late_penalty, footer_note, show_bank, display_order)
VALUES ('quote', 'Devis et facture proforma',
        'Offre valable jusqu''à la date indiquée. Commande ferme à réception du devis signé ou du bon pour accord.',
        NULL, NULL, true, 15)
ON CONFLICT (doc_type) DO NOTHING;

-- Motifs de perte : référentiel éditable
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('quote_lost_reasons', 'Motifs de devis perdus', 'Prix, délai, concurrent, projet abandonné…', 'ThumbsDown', 'ref_entries', true, 61)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ref_entries (table_id, code, label, description, color, display_order) VALUES
  ('quote_lost_reasons', 'price',       'Prix trop élevé',          NULL, '#dc3545', 10),
  ('quote_lost_reasons', 'competitor',  'Concurrent retenu',        NULL, '#d9822b', 20),
  ('quote_lost_reasons', 'delay',       'Délai trop long',          NULL, '#0d6efd', 30),
  ('quote_lost_reasons', 'cancelled',   'Projet abandonné / reporté', NULL, '#6c757d', 40),
  ('quote_lost_reasons', 'no_answer',   'Sans réponse',             'Devis expiré sans retour du client', '#adb5bd', 50),
  ('quote_lost_reasons', 'other',       'Autre',                    NULL, '#adb5bd', 90)
ON CONFLICT (table_id, code) DO NOTHING;

-- Notifications et tâche planifiée (mig 364)
INSERT INTO notification_rules (type, label, domain, email_enabled) VALUES
  ('quote_expired',  'Devis expiré sans réponse', 'quotes', true),
  ('quote_accepted', 'Devis accepté par le client', 'quotes', false)
ON CONFLICT (type) DO NOTHING;
INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('quotes_expire', 'Devis expirés', 'Passe en « expiré » les devis envoyés dont la validité est dépassée et prévient leur auteur.', 'sales', 60, 45)
ON CONFLICT (key) DO NOTHING;
