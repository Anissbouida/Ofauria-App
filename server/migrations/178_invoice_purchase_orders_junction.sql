-- Migration 178 : table de jonction invoices <-> purchase_orders (M:N).
--
-- Avant cette mig, invoices.purchase_order_id liait une facture a UN seul BC.
-- Or il arrive qu'un fournisseur livre plusieurs BCs en une seule fois avec
-- une seule facture (un seul N° fournisseur). On veut pouvoir fusionner les
-- factures generees pour ces BCs en une seule entree comptable.
--
-- La colonne invoices.purchase_order_id est conservee (compat ascendante,
-- requetes existantes), elle pointera sur le premier BC fusionne. La table de
-- jonction est la source de verite pour le multi-BC.

CREATE TABLE IF NOT EXISTS invoice_purchase_orders (
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  PRIMARY KEY (invoice_id, purchase_order_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_purchase_orders_po
  ON invoice_purchase_orders(purchase_order_id);

-- Backfill : chaque facture existante avec purchase_order_id non nul devient
-- un lien M:N. Idempotent via ON CONFLICT.
INSERT INTO invoice_purchase_orders (invoice_id, purchase_order_id)
SELECT id, purchase_order_id
FROM invoices
WHERE purchase_order_id IS NOT NULL
ON CONFLICT DO NOTHING;
