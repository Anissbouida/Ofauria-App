-- G4-01 (plan d'action 2026-11) — paiements fournisseurs en lot (campagnes de paiement).
--
-- Une campagne regroupe des factures fournisseurs à régler par virement le même jour,
-- depuis un même compte de trésorerie. Circuit :
--   draft → (pending_approval →) approved → file_generated → executed
--   (cancelled possible tant que rien n'est exécuté)
-- L'exécution crée UN règlement par ligne par le chemin habituel (paymentRepository.create :
-- écriture comptable, lettrage, reste à payer de la facture). Une ligne rejetée par la
-- banque après exécution est annulée par l'annulation de règlement existante.
--
-- Analogie Oracle : c'est le « Payment Batch » d'Oracle Payables (sélection, revue,
-- formatage, confirmation).
--
-- suppliers.rib / bank_name : le RIB du fournisseur n'existait nulle part. Mêmes règles que
-- le RIB des salariés (24 chiffres, clé contrôlée par services/salary-transfer.ts).
--
-- INVERSION : DROP TABLE payment_run_lines; DROP TABLE payment_runs;
--             ALTER TABLE suppliers DROP COLUMN IF EXISTS rib, DROP COLUMN IF EXISTS bank_name;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rib       varchar(34);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name varchar(100);

CREATE TABLE IF NOT EXISTS payment_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number          varchar(30) NOT NULL UNIQUE,
  payment_date        date NOT NULL,
  treasury_account_id uuid NOT NULL REFERENCES treasury_accounts(id),
  status              varchar(20) NOT NULL DEFAULT 'draft',
  total_amount        numeric(14,2) NOT NULL DEFAULT 0,
  notes               text,
  store_id            uuid REFERENCES stores(id),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  file_generated_at   timestamptz,
  executed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  executed_at         timestamptz,
  cancelled_at        timestamptz,
  CONSTRAINT chk_payment_runs_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'file_generated', 'executed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_payment_runs_status ON payment_runs (status, payment_date DESC);

CREATE TABLE IF NOT EXISTS payment_run_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES payment_runs(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES invoices(id),
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  -- RIB et banque figés à la préparation : le fichier remis à la banque doit porter ce qui a été approuvé.
  rib           varchar(34),
  bank_name     varchar(100),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  status        varchar(20) NOT NULL DEFAULT 'pending',
  payment_id    uuid REFERENCES payments(id),
  reject_reason text,
  rejected_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_run_lines_status CHECK (status IN ('pending', 'paid', 'rejected')),
  CONSTRAINT uq_payment_run_lines_invoice UNIQUE (run_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_run_lines_invoice ON payment_run_lines (invoice_id) WHERE status = 'pending';
