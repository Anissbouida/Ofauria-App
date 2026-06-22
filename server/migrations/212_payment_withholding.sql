-- Migration 212 : retenue a la source sur les paiements
--
-- POURQUOI
--   Permettre de prelever une retenue a la source (loyers, honoraires...) au
--   moment d'un paiement. Le montant du paiement (payments.amount) reste le
--   montant BRUT (l'obligation envers le beneficiaire). Au paiement :
--     net verse = brut - retenue ; retenue reversee a l'Etat (compte 4452x).
--
-- PORTEE : colonnes additives nullables sur payments. Aucun impact sur les
--   paiements existants (withholding_type_id / withholding_amount restent NULL).
--
-- INVERSION : ALTER TABLE payments DROP COLUMN withholding_amount, withholding_type_id.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS withholding_type_id UUID REFERENCES withholding_tax_types(id),
  ADD COLUMN IF NOT EXISTS withholding_amount  DECIMAL(12,2);

COMMENT ON COLUMN payments.withholding_type_id IS
  'Type de retenue a la source appliquee (NULL = pas de retenue). amount reste le brut.';
COMMENT ON COLUMN payments.withholding_amount IS
  'Montant retenu a la source. Net verse = amount - withholding_amount.';
