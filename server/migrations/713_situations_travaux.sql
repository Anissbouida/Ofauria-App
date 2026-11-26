-- 713 — Facturation à l'avancement : situations de travaux (feuille de route, étape 3.3).
--
-- Le marché est le devis accepté (lots et ouvrages = sections et lignes du devis, mig 365).
-- Une situation fixe, ligne par ligne, le pourcentage d'avancement CUMULÉ ; le montant de la
-- période est le cumul moins la situation validée précédente. Sur ce montant :
--   - retenue de garantie (taux du marché) ;
--   - remboursement de l'avance de démarrage (taux du marché, borné au reste de l'avance) ;
--   - TVA au taux de chaque ligne, sur le net (règle de la maquette, à faire valider par le métier).
-- Capacité facturation_avancement (module Ventes), éteinte par défaut, active dans le profil BTP.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS retention_pct NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK (retention_pct >= 0 AND retention_pct <= 100);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS advance_recovery_pct NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK (advance_recovery_pct >= 0 AND advance_recovery_pct <= 100);
COMMENT ON COLUMN quotes.retention_pct IS 'Retenue de garantie du marché, en % de chaque situation (mig 713).';
COMMENT ON COLUMN quotes.advance_amount IS 'Avance de démarrage versée au titulaire du marché (mig 713).';
COMMENT ON COLUMN quotes.advance_recovery_pct IS 'Remboursement de l''avance, en % de chaque situation (mig 713).';

CREATE TABLE IF NOT EXISTS progress_billings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(40) NOT NULL UNIQUE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  situation_no INTEGER NOT NULL CHECK (situation_no > 0),
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),
  retention_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  advance_recovery_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  contract_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  cumulative_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  previous_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  period_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  retention_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  advance_recovery_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  UNIQUE (quote_id, situation_no)
);
-- Une seule situation en préparation par marché.
CREATE UNIQUE INDEX IF NOT EXISTS uq_progress_billings_draft ON progress_billings(quote_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS progress_billing_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_id UUID NOT NULL REFERENCES progress_billings(id) ON DELETE CASCADE,
  quote_item_id UUID NOT NULL REFERENCES quote_items(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  contract_amount NUMERIC(14,2) NOT NULL,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_cumulative NUMERIC(6,2) NOT NULL CHECK (pct_cumulative >= 0 AND pct_cumulative <= 100),
  amount_cumulative NUMERIC(14,2) NOT NULL,
  amount_previous NUMERIC(14,2) NOT NULL,
  amount_period NUMERIC(14,2) NOT NULL,
  UNIQUE (billing_id, quote_item_id)
);

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('facturation_avancement', 'sales', 'Facturation à l''avancement',
   'Marchés facturés par situations de travaux : avancement cumulé par ouvrage, retenue de garantie, remboursement de l''avance.', 390, 'fonction', '{devis}', false)
ON CONFLICT (key) DO NOTHING;
UPDATE sector_packs SET features = array_append(features, 'facturation_avancement')
 WHERE code = 'btp' AND NOT ('facturation_avancement' = ANY(features));
