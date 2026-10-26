-- Migration 352 : ventes aux professionnels — bons de livraison clients (lot 2)
--
-- POURQUOI
--   Une vente à un professionnel (hôtel, café, revendeur) était saisie comme
--   une « vente spéciale » payée d'un coup. Les ERP (SAP B1 « copier vers »,
--   Odoo « À facturer », Sage gestion commerciale) suivent une chaîne :
--   commande → bon de livraison → facture, avec une facture mensuelle qui
--   regroupe les livraisons d'un client régulier.
--
-- PORTEE
--   delivery_notes / delivery_note_items : le BL client (lignes, prix négocié,
--   TVA par ligne), rattaché éventuellement à une commande, puis à la facture
--   client qui le solde (invoice_id). Le BL ne passe aucune écriture : le
--   chiffre d'affaires, la TVA et la créance naissent à la facture (FE).
--   Série de numérotation « delivery_note » : BL-AAAA-NNNN.
--
-- INVERSION
--   DROP TABLE delivery_note_items, delivery_notes ;
--   DELETE FROM document_sequences WHERE doc_type = 'delivery_note'.

CREATE TABLE IF NOT EXISTS delivery_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         varchar(30) NOT NULL UNIQUE,
  customer_id    uuid NOT NULL REFERENCES customers(id),
  store_id       uuid REFERENCES stores(id),
  order_id       uuid REFERENCES orders(id),
  delivery_date  date NOT NULL DEFAULT CURRENT_DATE,
  status         varchar(12) NOT NULL DEFAULT 'delivered'
                   CHECK (status IN ('delivered', 'invoiced', 'cancelled')),
  invoice_id     uuid REFERENCES invoices(id),
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  CHECK ((status = 'invoiced') = (invoice_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer ON delivery_notes (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice ON delivery_notes (invoice_id) WHERE invoice_id IS NOT NULL;
-- Une commande ne donne qu'un BL actif (pas de double livraison / facturation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_notes_order ON delivery_notes (order_id) WHERE order_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS delivery_note_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id  uuid NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES products(id),
  description       text NOT NULL,
  quantity          numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price        numeric(12,4) NOT NULL CHECK (unit_price >= 0),
  tva_rate          numeric(5,2) CHECK (tva_rate IS NULL OR (tva_rate >= 0 AND tva_rate <= 100)),
  subtotal          numeric(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_note ON delivery_note_items (delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_note_items_product ON delivery_note_items (product_id);

COMMENT ON TABLE delivery_notes IS
  'Bon de livraison client (mig 352) : livré → facturé (invoice_id) ; aucune écriture, le CA naît à la facture.';

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('delivery_note', 'Bon de livraison client', 'sales', 'BL-{YYYY}-{SEQ}', 4, 'year', 'delivery_notes', 'number', false, 45)
ON CONFLICT (doc_type) DO NOTHING;
