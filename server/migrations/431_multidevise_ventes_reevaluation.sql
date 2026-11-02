-- 431 — Plusieurs devises, lot 3 : ventes en devise et réévaluation de clôture
--
-- Suite des mig 363 (BC en devise) et 368 (factures fournisseurs, règlements,
-- écarts de change réalisés). Principe comptable (CGNC) :
--
--   Ventes : une facture client peut être émise en devise, au taux du jour de la
--   facture (saisi). Elle est comptabilisée en DH (3421 / 7111 / 4455) et garde
--   son montant en devise (foreign_total_amount, mig 368). Son encaissement se
--   saisit en devise au taux du jour : la trésorerie reçoit le montant réel en
--   DH, la créance 3421 est soldée au taux de la facture, l'écart est un gain
--   (7331) si la devise a monté, une perte (6331) sinon.
--
--   Clôture : les créances et dettes en devise encore ouvertes au 31/12 sont
--   converties au taux de clôture. L'écart n'est pas un résultat réalisé :
--     - perte latente (créance qui baisse, dette qui monte) : écart de
--       conversion actif 3701 (diminution des créances circulantes) / 3702
--       (augmentation des dettes circulantes), couvert par une provision pour
--       perte de change 6393 / 4506 ;
--     - gain latent (créance qui monte, dette qui baisse) : écart de conversion
--       passif 4701 (augmentation des créances) / 4702 (diminution des dettes),
--       sans produit.
--   Les écarts de conversion sont contre-passés au 1er jour de l'exercice
--   suivant (la facture revient à son taux historique, le règlement dégagera
--   l'écart réel) ; la provision est reprise (4506 / 7393) à la réévaluation
--   suivante.
--
-- Rollback :
--   DROP TABLE fx_revaluation_lines, fx_revaluations ;
--   DELETE FROM accounts WHERE code IN ('3701','3702','4701','4702','4506','6393','7393') (s'ils sont vides).

-- ─── 1. Comptes ───────────────────────────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active) VALUES
  ('3701', 'Écarts de conversion actif — diminution des créances circulantes', 3, '37', '370', 'asset', 'D', false, true),
  ('3702', 'Écarts de conversion actif — augmentation des dettes circulantes', 3, '37', '370', 'asset', 'D', false, true),
  ('4701', 'Écarts de conversion passif — augmentation des créances circulantes', 4, '47', '470', 'liability', 'C', false, true),
  ('4702', 'Écarts de conversion passif — diminution des dettes circulantes', 4, '47', '470', 'liability', 'C', false, true),
  ('4506', 'Provisions pour pertes de change', 4, '45', '450', 'liability', 'C', false, true),
  ('6393', 'Dotations aux provisions pour risques et charges financiers', 6, '63', '639', 'expense', 'D', false, true),
  ('7393', 'Reprises sur provisions pour risques et charges financiers', 7, '73', '739', 'revenue', 'C', false, true)
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN payments.fx_difference IS
  'amount − settled_amount (mig 368, 431). Facture fournisseur : > 0 perte de change (6331), < 0 gain (7331). '
  'Facture client (encaissement) : > 0 gain de change (7331), < 0 perte (6331).';

-- ─── 2. Réévaluations de clôture ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_revaluations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year               SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  closing_date       DATE NOT NULL,
  status             VARCHAR(10) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  rates              JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { "EUR": 10.95, … } taux de clôture retenus
  loss_total         NUMERIC(14,2) NOT NULL DEFAULT 0,        -- écarts de conversion actif (3701 + 3702)
  gain_total         NUMERIC(14,2) NOT NULL DEFAULT 0,        -- écarts de conversion passif (4701 + 4702)
  provision          NUMERIC(14,2) NOT NULL DEFAULT 0,        -- dotation 6393 / 4506
  provision_reversal NUMERIC(14,2) NOT NULL DEFAULT 0,        -- reprise de la provision de l'exercice précédent
  reval_entry_id     UUID NOT NULL REFERENCES journal_entries(id),
  reopen_entry_id    UUID REFERENCES journal_entries(id),     -- contre-passation au 1er jour de l'exercice suivant
  booked_by          UUID REFERENCES users(id),
  booked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by       UUID REFERENCES users(id),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_revaluation_year ON fx_revaluations (year) WHERE status = 'booked';
COMMENT ON TABLE fx_revaluations IS
  'Réévaluation de clôture des créances et dettes en devise (mig 431) : une réévaluation comptabilisée par exercice ; une annulation garde la trace (status cancelled).';

CREATE TABLE IF NOT EXISTS fx_revaluation_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revaluation_id    UUID NOT NULL REFERENCES fx_revaluations(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES invoices(id),
  side              VARCHAR(10) NOT NULL CHECK (side IN ('receivable', 'payable')),
  currency_code     CHAR(3) NOT NULL REFERENCES currencies(code),
  foreign_remaining NUMERIC(14,2) NOT NULL,
  book_rate         NUMERIC(14,6) NOT NULL,
  book_amount       NUMERIC(14,2) NOT NULL,     -- reste dû en DH au taux de la facture
  closing_rate      NUMERIC(14,6) NOT NULL,
  closing_amount    NUMERIC(14,2) NOT NULL,     -- reste dû en DH au taux de clôture
  difference        NUMERIC(14,2) NOT NULL,     -- closing − book
  account_code      VARCHAR(10) NOT NULL        -- 3701 / 3702 / 4701 / 4702
);
CREATE INDEX IF NOT EXISTS idx_fx_reval_lines ON fx_revaluation_lines (revaluation_id);
COMMENT ON TABLE fx_revaluation_lines IS 'Détail par facture de la réévaluation de clôture (mig 431).';
