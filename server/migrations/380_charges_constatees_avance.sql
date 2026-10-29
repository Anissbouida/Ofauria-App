-- 380 — Charges constatées d'avance (CCA, compte 486)
--
-- Une charge payée/comptabilisée sur une période qui déborde l'exercice (loyer,
-- assurance, abonnement annuel…) est étalée sur les mois qu'elle couvre, comme
-- ERPNext « Deferred Expense » / SAP. Traitement CGNC retenu :
--
--   1. À la création : RECLASSEMENT du montant total hors des charges vers l'actif
--      de régularisation — débit 486, crédit 6x (le compte de charge d'origine).
--   2. Chaque mois couvert : CONSTATATION au prorata linéaire — débit 6x, crédit 486.
--   3. En fin de période, le 486 est entièrement repassé en charges (solde nul).
--
-- Toutes les écritures passent au journal OD (opérations diverses), en 'posted'.
-- Une constatation par (CCA, mois) au maximum (contrainte d'unicité) : rejouer la
-- constatation d'un mois déjà fait ne double rien.
--
-- Rollback :
--   DROP TABLE prepaid_charge_recognitions, prepaid_charges ;
--   DELETE FROM accounts WHERE code = '486' ;   -- seulement si aucune écriture ne l'utilise

-- Compte 486 (régularisation actif). account_class 4, rubrique 48, poste 486.
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side)
VALUES ('486', 'Charges constatées d''avance', 4, '48', '486', 'asset', 'D')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS prepaid_charges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label                VARCHAR(200) NOT NULL,
  -- Compte de charge (classe 6) sur lequel la dépense est étalée.
  charge_account_code  VARCHAR(10) NOT NULL REFERENCES accounts(code),
  total_amount         NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  -- Nombre de mois couverts (dérivé de start/end, figé à la création).
  months               SMALLINT NOT NULL CHECK (months >= 1),
  -- Facture d'origine éventuelle (traçabilité ; la charge y est déjà comptabilisée).
  source_invoice_id    UUID REFERENCES invoices(id) ON DELETE SET NULL,
  store_id             UUID REFERENCES stores(id),
  status               VARCHAR(12) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'done', 'cancelled')),
  -- Écriture de reclassement initial (débit 486 / crédit 6x).
  init_entry_id        UUID REFERENCES journal_entries(id),
  notes                TEXT,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_charges_status ON prepaid_charges (status);

CREATE TABLE IF NOT EXISTS prepaid_charge_recognitions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prepaid_charge_id  UUID NOT NULL REFERENCES prepaid_charges(id) ON DELETE CASCADE,
  -- Premier jour du mois constaté.
  period_month       DATE NOT NULL,
  amount             NUMERIC(12,2) NOT NULL,
  journal_entry_id   UUID REFERENCES journal_entries(id),
  recognized_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prepaid_charge_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_recognitions_charge ON prepaid_charge_recognitions (prepaid_charge_id);
