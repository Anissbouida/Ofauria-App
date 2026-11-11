-- Phase 11 (D5-59) — litige rattaché à une facture.
--
-- Avant : `invoices.status = 'disputed'` se posait par l'API, sans dossier (ni
-- motif, ni montant contesté), et la relance prenait quand même toute la pièce.
-- Désormais un dossier de litige porte le montant contesté : ce montant est
-- exclu du reste à recouvrer (openDocuments), donc des relances, tant que le
-- litige est ouvert. Additif : table neuve, le reste du flux est inchangé.

CREATE TABLE IF NOT EXISTS invoice_disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reason              text NOT NULL,
  disputed_amount     numeric(12,2) NOT NULL CHECK (disputed_amount >= 0),
  responsible_user_id uuid REFERENCES users(id),
  target_date         date,                       -- échéance de résolution visée
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolution          text,
  credit_note_id      uuid REFERENCES invoices(id), -- avoir émis en résolution, le cas échéant
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);

-- Un seul litige ouvert par facture (le montant contesté est additif sinon flou).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_dispute_open
  ON invoice_disputes (invoice_id) WHERE status = 'open';
