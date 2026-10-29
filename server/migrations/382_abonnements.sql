-- 382 — Abonnements / facturation récurrente
--
-- Un abonnement génère automatiquement une facture client émise à échéance
-- régulière (mensuelle, trimestrielle, annuelle) : contrats d'entretien, café/pain
-- en dépôt récurrent, prestations périodiques… (ERPNext « Subscription »).
--
-- La génération réutilise le chemin de facture émise existant (compta auto
-- 3421 / 7111 + TVA). Chaque période n'est facturée qu'une fois (contrainte
-- d'unicité sur subscription_invoices).
--
-- Rollback : DROP TABLE subscription_invoices, subscriptions ;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id),
  label              VARCHAR(200) NOT NULL,
  amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0),   -- montant HT par échéance
  tva_rate           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tva_rate BETWEEN 0 AND 100),
  frequency          VARCHAR(10) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  start_date         DATE NOT NULL,
  next_invoice_date  DATE NOT NULL,
  end_date           DATE,
  status             VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  store_id           UUID REFERENCES stores(id),
  notes              TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_due ON subscriptions (next_invoice_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (customer_id);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  invoice_id       UUID REFERENCES invoices(id) ON DELETE SET NULL,
  period_date      DATE NOT NULL,          -- date de facture de la période générée
  amount_ttc       NUMERIC(12,2) NOT NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_date)
);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_sub ON subscription_invoices (subscription_id);
