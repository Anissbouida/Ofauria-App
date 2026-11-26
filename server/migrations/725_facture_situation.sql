-- 725 — Facture d'une situation de travaux (suite de la mig 713).
-- Une situation validée se facture une fois : facture client émise (lignes = ouvrages au net
-- de la période, retenue de garantie et remboursement d'avance rappelés en notes).
ALTER TABLE progress_billings ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_progress_billings_invoice ON progress_billings(invoice_id) WHERE invoice_id IS NOT NULL;
