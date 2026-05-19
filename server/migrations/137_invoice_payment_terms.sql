-- ═══════════════════════════════════════════════════════════════
-- 137: Modalites de reglement & echeances fournisseurs
--
-- Additif/non-breaking : on enrichit la table invoices avec :
--   * expected_payment_mode : mode de reglement PREVU (espece/cheque/virement)
--     - se distingue de payments.payment_method (mode REEL d'un paiement)
--   * reception_date        : date a laquelle la facture a ete recue
--     (peut differer de invoice_date qui est la date sur la facture)
--   * statut 'disputed'     : facture en litige
--
-- Toutes les colonnes sont nullables, les factures existantes restent valides.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS expected_payment_mode VARCHAR(20)
  CHECK (expected_payment_mode IN ('cash', 'check', 'transfer'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reception_date DATE;

-- Etend le CHECK status pour autoriser 'disputed' (en litige)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled', 'disputed'));

-- Index pour les requetes d'alerte (factures non reglees avec echeance proche)
CREATE INDEX IF NOT EXISTS idx_invoices_due_date_status
  ON invoices(due_date, status)
  WHERE due_date IS NOT NULL AND status IN ('pending', 'partial', 'overdue', 'disputed');
