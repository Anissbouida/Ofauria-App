-- Phase 7.4 — Transferts de produits finis entre magasins ou dépôts.
--
-- Un transfert laisse UNE pièce (product_transfers) et DEUX mouvements de stock
-- (sortie du site source, entrée au site destination), tracés dans
-- product_stock_transactions. Additif : aucune donnée existante touchée.

-- Deux nouveaux types de mouvement de stock produit fini.
ALTER TABLE product_stock_transactions DROP CONSTRAINT IF EXISTS product_stock_transactions_type_check;
ALTER TABLE product_stock_transactions ADD CONSTRAINT product_stock_transactions_type_check
  CHECK (type::text = ANY (ARRAY['production','sale','return','adjustment','waste','exchange','loss',
    'replenishment_in','unsold_return','delivery','delivery_reversal','transfer_in','transfer_out']::text[]));

CREATE TABLE IF NOT EXISTS product_transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        VARCHAR(30) NOT NULL,
  from_store_id UUID NOT NULL REFERENCES stores(id),
  to_store_id   UUID NOT NULL REFERENCES stores(id),
  status        VARCHAR(12) NOT NULL DEFAULT 'done',
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_product_transfer_distinct CHECK (from_store_id <> to_store_id),
  CONSTRAINT chk_product_transfer_status CHECK (status::text = ANY (ARRAY['draft','done','cancelled']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_product_transfers_stores ON product_transfers (from_store_id, to_store_id, transfer_date DESC);

CREATE TABLE IF NOT EXISTS product_transfer_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES product_transfers(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  quantity    NUMERIC(12,3) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_product_transfer_items_transfer ON product_transfer_items (transfer_id);

-- Série de numéros du transfert (TR-{YYYY}-{SEQ}).
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column)
VALUES ('product_transfer', 'Transfert de produits', 'sales', 'TR-{YYYY}-{SEQ}', 4, 'year', 'product_transfers', 'number')
ON CONFLICT (doc_type) DO NOTHING;
