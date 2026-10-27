-- 357 — SAV : réclamations clients (module générique, toutes industries)
--
-- Une réclamation = un client (fiche ou nom libre) qui signale un problème sur une
-- vente, une commande, un article ou un lot. Elle a une catégorie (référentiel
-- éditable), une priorité qui fixe un délai de traitement, un responsable, un
-- journal d'événements et une résolution (remboursement, remplacement, geste
-- commercial…). Rien ici n'est propre à la boulangerie : les liens vers l'article,
-- le lot, la vente, la commande et la facture sont tous optionnels, pour qu'un
-- prestataire de services ou un atelier puisse s'en servir tel quel.
--
-- Conventions :
--   - statut : open → in_progress → resolved → closed ; rejected = non fondée ;
--   - priorité : low | normal | high | critical ; délai = sav.sla_hours[priorité] ;
--   - la saisie rapide (caisse) ne remplit que l'article, le motif et un mot ;
--     le gérant complète ensuite depuis Contrôle & Qualité.
--
-- Rollback :
--   DROP TABLE complaint_events, complaints ;
--   DELETE FROM document_sequences WHERE doc_type = 'complaint' ;
--   DELETE FROM ref_entries WHERE table_id = 'complaint_categories' ;
--   DELETE FROM ref_tables WHERE id = 'complaint_categories' ;
--   DELETE FROM notification_rules WHERE domain = 'sav' ;
--   DELETE FROM module_parameters WHERE key LIKE 'sav.%'.

-- ─── 1. Réclamations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number             VARCHAR(30) NOT NULL UNIQUE,
  store_id           UUID REFERENCES stores(id),
  -- Client : fiche si connue, sinon nom / téléphone saisis au comptoir.
  customer_id        UUID REFERENCES customers(id),
  customer_name      VARCHAR(160),
  customer_phone     VARCHAR(40),
  channel            VARCHAR(12) NOT NULL DEFAULT 'counter'
                       CHECK (channel IN ('counter', 'phone', 'email', 'social', 'other')),
  category_code      VARCHAR(60) NOT NULL,
  priority           VARCHAR(10) NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status             VARCHAR(12) NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'rejected')),
  subject            VARCHAR(200) NOT NULL,
  description        TEXT,
  -- Objet de la réclamation : tous optionnels.
  product_id         UUID REFERENCES products(id),
  product_lot_id     UUID REFERENCES product_lots(id),
  sale_id            UUID REFERENCES sales(id),
  order_id           UUID REFERENCES orders(id),
  invoice_id         UUID REFERENCES invoices(id),
  quantity           NUMERIC(12,3) CHECK (quantity IS NULL OR quantity > 0),
  photo_url          TEXT,
  -- Délai de traitement, figé à la création (ou au changement de priorité).
  due_at             TIMESTAMPTZ,
  assigned_to        UUID REFERENCES users(id),
  -- Résolution.
  resolution_code    VARCHAR(20)
                       CHECK (resolution_code IS NULL OR resolution_code IN
                              ('refund', 'replacement', 'voucher', 'discount', 'apology', 'none', 'not_founded')),
  resolution         TEXT,
  resolution_amount  NUMERIC(12,2) CHECK (resolution_amount IS NULL OR resolution_amount >= 0),
  resolved_by        UUID REFERENCES users(id),
  resolved_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR COALESCE(btrim(customer_name), '') <> ''),
  CHECK ((status IN ('resolved', 'closed', 'rejected')) = (resolved_at IS NOT NULL)),
  CHECK (status NOT IN ('resolved', 'closed') OR resolution_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_complaints_status   ON complaints (status, due_at);
CREATE INDEX IF NOT EXISTS idx_complaints_customer ON complaints (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_product  ON complaints (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_lot      ON complaints (product_lot_id) WHERE product_lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_store    ON complaints (store_id, created_at DESC);
COMMENT ON TABLE complaints IS 'SAV : réclamations clients (mig 357). Liens article/lot/vente/commande/facture optionnels.';

-- ─── 2. Journal de la réclamation ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaint_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  event_type    VARCHAR(12) NOT NULL
                  CHECK (event_type IN ('created', 'comment', 'status', 'assigned', 'priority', 'edited')),
  from_value    VARCHAR(40),
  to_value      VARCHAR(40),
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaint_events ON complaint_events (complaint_id, created_at);

-- ─── 3. Numérotation RCL-AAAA-NNNN (mig 329) ───────────────────────────────
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('complaint', 'Réclamation client', 'sav', 'RCL-{YYYY}-{SEQ}', 4, 'year', 'complaints', 'number', false, 70)
ON CONFLICT (doc_type) DO NOTHING;

-- ─── 4. Motifs de réclamation : référentiel éditable ───────────────────────
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('complaint_categories', 'Motifs de réclamation', 'Qualité, sécurité, délai, service, facturation…', 'MessageSquareWarning', 'ref_entries', true, 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, color, display_order)
VALUES
  ('complaint_categories', 'quality',  'Qualité du produit',     'Goût, texture, cuisson, aspect, conformité',       '#d9822b', 10),
  ('complaint_categories', 'safety',   'Sécurité / allergène',   'Corps étranger, allergène non signalé, hygiène',   '#dc3545', 20),
  ('complaint_categories', 'quantity', 'Quantité / manquant',    'Article manquant, poids ou nombre insuffisant',    '#6c757d', 30),
  ('complaint_categories', 'delay',    'Délai / retard',         'Commande ou livraison en retard, créneau manqué',  '#0d6efd', 40),
  ('complaint_categories', 'service',  'Accueil / service',      'Comportement, attente, erreur de préparation',     '#6f42c1', 50),
  ('complaint_categories', 'billing',  'Prix / facturation',     'Erreur de prix, de ticket ou de facture',          '#198754', 60),
  ('complaint_categories', 'other',    'Autre',                  NULL,                                               '#adb5bd', 90)
ON CONFLICT (table_id, code) DO NOTHING;

-- ─── 5. Délais de traitement par priorité (heures) ─────────────────────────
INSERT INTO module_parameters (key, value, description) VALUES
  ('sav.sla_hours',
   '{"critical": 4, "high": 24, "normal": 72, "low": 168}'::jsonb,
   'SAV : délai de traitement d''une réclamation en heures, par priorité (critical, high, normal, low).'),
  ('sav.safety_is_critical', 'true'::jsonb,
   'SAV : une réclamation de catégorie « Sécurité / allergène » est créée en priorité critique.')
ON CONFLICT (key) DO NOTHING;

-- ─── 6. Notifications ──────────────────────────────────────────────────────
INSERT INTO notification_rules (type, label, domain) VALUES
  ('complaint_created',  'Nouvelle réclamation client', 'sav'),
  ('complaint_critical', 'Réclamation critique',        'sav'),
  ('complaint_overdue',  'Réclamation en retard',       'sav')
ON CONFLICT (type) DO NOTHING;

-- ─── 7. updated_at ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_complaints_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS complaints_touch ON complaints;
CREATE TRIGGER complaints_touch BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION trg_complaints_touch();
