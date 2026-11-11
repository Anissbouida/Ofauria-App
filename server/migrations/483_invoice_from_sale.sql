-- Phase 5.5 — Facture depuis un ticket de caisse.
--
-- Un client peut demander sa facture après un achat au comptoir. La vente POS a
-- déjà été comptabilisée par fromSale (trésorerie → 7111 + TVA collectée) ; la
-- facture émise qui en découle est une PIÈCE LÉGALE, pas un nouveau produit :
-- fromInvoice renvoie null quand source_sale_id est renseigné, pour ne jamais
-- recompter le chiffre d'affaires ni ouvrir une créance 3421 (le ticket est payé).
--
-- Additif : aucune facture existante n'a source_sale_id, rien ne change pour Ofauria.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_sale_id UUID REFERENCES sales(id);

-- Au plus une facture active par ticket (annulée mise à part) : une demande de
-- facture ne peut pas émettre deux pièces pour le même encaissement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_one_per_sale
  ON invoices (source_sale_id)
  WHERE source_sale_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_invoices_source_sale
  ON invoices (source_sale_id) WHERE source_sale_id IS NOT NULL;

COMMENT ON COLUMN invoices.source_sale_id IS
  'Ticket de caisse d''origine (phase 5.5) : la vente porte déjà l''écriture, cette facture ne recomptabilise pas.';
