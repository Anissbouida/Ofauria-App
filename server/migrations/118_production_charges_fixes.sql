-- Charges fixes mensuelles (loyer, energie, autres) pour le calcul du cout de revient.
-- Distribuees proportionnellement sur chaque plan de production du mois.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS production_charge_loyer DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_charge_energie DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_charge_autres DECIMAL(10,2) DEFAULT 0;

ALTER TABLE production_cout_reel
  ADD COLUMN IF NOT EXISTS cout_charges_fixes DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detail_charges_fixes JSONB DEFAULT '[]';

ALTER TABLE production_cout_reel ALTER COLUMN ecart_pct TYPE DECIMAL(8,2);
