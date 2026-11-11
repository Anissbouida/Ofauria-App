-- 482 — Facture d'acompte client (phase 5.4).
--
-- L'acompte d'une commande était réservé au comptoir (ticket sale_type='advance',
-- avance en 4421) pour les particuliers. Les professionnels n'avaient aucun moyen de
-- verser un acompte : « ni avance ni caisse, réglé sur facture ». On ouvre l'acompte
-- aux pros sous forme d'une vraie FACTURE D'ACOMPTE (kind='prepayment', série FA),
-- numérotée, avec TVA, et reprise automatiquement sur la facture finale.
--
-- `prepayment_consumed_invoice_id` : sur une facture d'acompte, la facture finale qui
-- l'a reprise (NULL = acompte encore disponible). La facture finale la pose à sa
-- création ; le générateur d'écritures lit ce lien pour ventiler la reprise (4421 D,
-- créance 3421 réduite, TVA régularisée).
--
-- Rollback :
--   ALTER TABLE invoices DROP COLUMN prepayment_consumed_invoice_id ;
--   DELETE FROM document_sequences WHERE doc_type = 'prepayment_emitted' ;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS prepayment_consumed_invoice_id UUID REFERENCES invoices(id);

CREATE INDEX IF NOT EXISTS idx_invoices_prepayment_consumed
  ON invoices (prepayment_consumed_invoice_id) WHERE prepayment_consumed_invoice_id IS NOT NULL;

COMMENT ON COLUMN invoices.prepayment_consumed_invoice_id IS
  'Sur une facture d''acompte (kind=prepayment) : facture finale qui l''a reprise (mig 482). NULL = disponible.';

-- Série continue des factures d'acompte (FA-AAAA-NNNN), comme la facture et l'avoir.
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('prepayment_emitted', 'Facture d''acompte', 'accounting', 'FA-{YYYY}-{SEQ}', 4, 'year', 'invoices', 'invoice_number', true, 42)
ON CONFLICT (doc_type) DO NOTHING;
