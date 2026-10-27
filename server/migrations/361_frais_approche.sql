-- 361 — Achats : frais d'approche (transport, douane, assurance, manutention)
--
-- Un bon de frais d'approche rattache des frais annexes à un bon de réception et les
-- répartit sur ses lignes, au prorata de la valeur reçue ou de la quantité. À
-- l'application, le coût du lot reçu (ingredient_lots.unit_cost, base du coût réel
-- de production) et le coût standard de l'article (ingredients / packaging_items
-- .unit_cost, base des coûts théoriques, en CMUP) sont augmentés d'autant : le coût
-- matière reflète ce que la marchandise a réellement coûté rendue.
--
-- Conventions :
--   - statut : draft (répartition calculée, rien d'appliqué) → applied ; cancelled ;
--   - un bon appliqué ne se modifie plus (les coûts ont été écrits) ; pour corriger,
--     on en crée un autre, au besoin avec des montants négatifs ;
--   - la comptabilité n'est pas touchée : la facture du transporteur reste comptabilisée
--     par sa propre catégorie de charge ; ici on ne corrige que la valorisation du stock.
--
-- Rollback :
--   DROP TABLE landed_cost_allocations, landed_cost_charges, landed_cost_vouchers ;
--   DELETE FROM document_sequences WHERE doc_type = 'landed_cost'.

CREATE TABLE IF NOT EXISTS landed_cost_vouchers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 VARCHAR(30) NOT NULL UNIQUE,
  store_id               UUID REFERENCES stores(id),
  reception_voucher_id   UUID NOT NULL REFERENCES reception_vouchers(id),
  allocation_method      VARCHAR(10) NOT NULL DEFAULT 'value' CHECK (allocation_method IN ('value', 'quantity')),
  status                 VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'cancelled')),
  total_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes                  TEXT,
  applied_at             TIMESTAMPTZ,
  applied_by             UUID REFERENCES users(id),
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_landed_cost_reception ON landed_cost_vouchers (reception_voucher_id);
CREATE INDEX IF NOT EXISTS idx_landed_cost_status ON landed_cost_vouchers (status, created_at DESC);
COMMENT ON TABLE landed_cost_vouchers IS 'Frais d''approche (mig 361) : frais annexes répartis sur les lignes d''une réception, appliqués au coût des lots et au coût standard.';

CREATE TABLE IF NOT EXISTS landed_cost_charges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id     UUID NOT NULL REFERENCES landed_cost_vouchers(id) ON DELETE CASCADE,
  label          VARCHAR(200) NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  category_id    UUID REFERENCES expense_categories(id),
  supplier_id    UUID REFERENCES suppliers(id),
  invoice_id     UUID REFERENCES invoices(id),
  display_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_landed_cost_charges_voucher ON landed_cost_charges (voucher_id, display_order);

CREATE TABLE IF NOT EXISTS landed_cost_allocations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id                  UUID NOT NULL REFERENCES landed_cost_vouchers(id) ON DELETE CASCADE,
  reception_voucher_item_id   UUID NOT NULL REFERENCES reception_voucher_items(id),
  basis_value                 NUMERIC(14,4) NOT NULL DEFAULT 0,
  share_pct                   NUMERIC(7,4) NOT NULL DEFAULT 0,
  amount                      NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity                    NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_increment              NUMERIC(12,6) NOT NULL DEFAULT 0,
  -- Écrit à l'application : ce qui a réellement changé.
  ingredient_lot_id           UUID REFERENCES ingredient_lots(id),
  lot_cost_before             NUMERIC(12,4),
  lot_cost_after              NUMERIC(12,4),
  standard_cost_before        NUMERIC(12,4),
  standard_cost_after         NUMERIC(12,4),
  UNIQUE (voucher_id, reception_voucher_item_id)
);

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('landed_cost', 'Frais d''approche', 'purchasing', 'FAP-{YYYY}-{SEQ}', 4, 'year', 'landed_cost_vouchers', 'number', false, 14)
ON CONFLICT (doc_type) DO NOTHING;

DROP TRIGGER IF EXISTS landed_cost_vouchers_touch ON landed_cost_vouchers;
CREATE TRIGGER landed_cost_vouchers_touch BEFORE UPDATE ON landed_cost_vouchers FOR EACH ROW EXECUTE FUNCTION trg_projects_touch();
