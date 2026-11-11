-- Phase 11 (D3-13) — objectifs par commercial.
--
-- Un objectif de chiffre d'affaires par vendeur et par période ; le réalisé se
-- lit sur les factures émises qui lui sont attribuées (invoices.salesperson_id,
-- mig 477), net des avoirs. Écart = réalisé − objectif. Additif : table neuve.

CREATE TABLE IF NOT EXISTS sales_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  target_amount  numeric(14,2) NOT NULL CHECK (target_amount >= 0),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sales_target_period CHECK (period_end >= period_start),
  UNIQUE (salesperson_id, period_start, period_end)
);
