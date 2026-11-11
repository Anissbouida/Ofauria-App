-- Phase 7.5 — Retour d'un professionnel : réception, décision, lot inversé, avoir.
--
-- Un retour client pro est reçu ligne par ligne, chaque ligne décidée « remise en stock »
-- (le lot d'origine est ré-incrémenté, la marchandise revient en stock) ou « rebut »
-- (perte, rien ne revient). Un avoir peut être émis pour la valeur retournée. Additif.

CREATE TABLE IF NOT EXISTS pro_returns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           VARCHAR(30) NOT NULL,
  customer_id      UUID NOT NULL REFERENCES customers(id),
  delivery_note_id UUID REFERENCES delivery_notes(id),
  store_id         UUID REFERENCES stores(id),
  status           VARCHAR(12) NOT NULL DEFAULT 'done',
  return_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  credit_note_id   UUID REFERENCES invoices(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pro_return_status CHECK (status::text = ANY (ARRAY['draft','done','cancelled']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_pro_returns_customer ON pro_returns (customer_id, return_date DESC);

CREATE TABLE IF NOT EXISTS pro_return_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_return_id         UUID NOT NULL REFERENCES pro_returns(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(id),
  product_lot_id        UUID REFERENCES product_lots(id),
  delivery_note_item_id UUID REFERENCES delivery_note_items(id),
  quantity              NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price            NUMERIC(12,4) NOT NULL DEFAULT 0,
  decision              VARCHAR(10) NOT NULL DEFAULT 'restock',
  CONSTRAINT chk_pro_return_decision CHECK (decision::text = ANY (ARRAY['restock','scrap']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_pro_return_items_return ON pro_return_items (pro_return_id);

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column)
VALUES ('pro_return', 'Retour client', 'sales', 'RET-{YYYY}-{SEQ}', 4, 'year', 'pro_returns', 'number')
ON CONFLICT (doc_type) DO NOTHING;
