-- 360 — Achats : appels d'offres et devis fournisseurs
--
-- Un appel d'offres (AO) = une liste d'articles à acheter, envoyée à plusieurs
-- fournisseurs. Chaque fournisseur répond par un devis (prix par ligne, délai,
-- conditions, frais de port). Le tableau comparatif met les devis côte à côte ;
-- on retient un devis, ce qui crée le bon de commande (BC) depuis ses lignes.
--
-- Conventions :
--   - statut AO : draft → sent → quoted (au moins un devis) → awarded (BC créé) ;
--     cancelled ; closed (sans suite) ;
--   - une ligne d'AO suit les mêmes genres qu'une ligne de BC (mig 349) :
--     ingrédient, consommable, service, immobilisation ;
--   - un devis par fournisseur et par AO ; ses lignes pointent les lignes de l'AO ;
--     une ligne non proposée reste sans prix (available = false).
--
-- Rollback :
--   DROP TABLE supplier_quotation_items, supplier_quotations, rfq_suppliers, rfq_items, rfqs ;
--   DELETE FROM document_sequences WHERE doc_type = 'rfq'.

CREATE TABLE IF NOT EXISTS rfqs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                VARCHAR(30) NOT NULL UNIQUE,
  store_id              UUID REFERENCES stores(id),
  title                 VARCHAR(200) NOT NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'sent', 'quoted', 'awarded', 'cancelled', 'closed')),
  needed_by             DATE,
  response_deadline     DATE,
  notes                 TEXT,
  sent_at               TIMESTAMPTZ,
  awarded_at            TIMESTAMPTZ,
  awarded_quotation_id  UUID,
  purchase_order_id     UUID REFERENCES purchase_orders(id),
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'awarded') = (awarded_quotation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs (status, created_at DESC);
COMMENT ON TABLE rfqs IS 'Appels d''offres fournisseurs (mig 360) : articles demandés, fournisseurs consultés, devis, BC du devis retenu.';

CREATE TABLE IF NOT EXISTS rfq_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id         UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  line_type      VARCHAR(20) NOT NULL DEFAULT 'ingredient' CHECK (line_type IN ('ingredient', 'consumable', 'service', 'asset')),
  ingredient_id  UUID REFERENCES ingredients(id),
  packaging_id   UUID REFERENCES packaging_items(id),
  description    VARCHAR(500),
  category_id    UUID REFERENCES expense_categories(id),
  unit           VARCHAR(20),
  quantity       NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  display_order  INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (line_type = 'ingredient' AND ingredient_id IS NOT NULL AND packaging_id IS NULL)
    OR (line_type = 'consumable' AND packaging_id IS NOT NULL AND ingredient_id IS NULL)
    OR (line_type IN ('service', 'asset') AND ingredient_id IS NULL AND packaging_id IS NULL AND COALESCE(btrim(description), '') <> '')
  )
);
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items (rfq_id, display_order);

CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id        UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES suppliers(id),
  status        VARCHAR(12) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'quoted', 'declined', 'no_response')),
  invited_at    TIMESTAMPTZ,
  contact_note  TEXT,
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_quotations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id          UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  quotation_ref   VARCHAR(80),
  received_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until     DATE,
  delivery_days   INTEGER CHECK (delivery_days IS NULL OR delivery_days >= 0),
  payment_terms   VARCHAR(200),
  shipping_cost   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  notes           TEXT,
  status          VARCHAR(10) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'selected', 'rejected')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);
ALTER TABLE rfqs DROP CONSTRAINT IF EXISTS rfqs_awarded_quotation_fk;
ALTER TABLE rfqs ADD CONSTRAINT rfqs_awarded_quotation_fk FOREIGN KEY (awarded_quotation_id) REFERENCES supplier_quotations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS supplier_quotation_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  UUID NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
  rfq_item_id   UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  available     BOOLEAN NOT NULL DEFAULT true,
  unit_price    NUMERIC(12,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  quantity      NUMERIC(12,3) CHECK (quantity IS NULL OR quantity > 0),
  note          VARCHAR(300),
  UNIQUE (quotation_id, rfq_item_id),
  CHECK (NOT available OR unit_price IS NOT NULL)
);

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('rfq', 'Appel d''offres fournisseurs', 'purchasing', 'AO-{YYYY}-{SEQ}', 4, 'year', 'rfqs', 'number', false, 12)
ON CONFLICT (doc_type) DO NOTHING;

DROP TRIGGER IF EXISTS rfqs_touch ON rfqs;
CREATE TRIGGER rfqs_touch BEFORE UPDATE ON rfqs FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
DROP TRIGGER IF EXISTS supplier_quotations_touch ON supplier_quotations;
CREATE TRIGGER supplier_quotations_touch BEFORE UPDATE ON supplier_quotations FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
