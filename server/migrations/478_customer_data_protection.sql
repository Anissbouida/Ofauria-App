-- Migration 478 : protection des données client — loi 09-08 (phase 4.6)
--
-- Trois droits de la loi 09-08 (équivalent marocain du RGPD) :
--   - consentement : marketing_consent + date, saisis sur la fiche.
--   - export : lu à la volée (aucune colonne), droit d'accès/portabilité.
--   - effacement : ANONYMISATION et non suppression — on scrub les données
--     personnelles mais on GARDE la ligne, son id et ses liens comptables
--     (factures, créances, écritures) pour ne pas casser la comptabilité.
--     anonymized_at date l'opération (irréversible).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- L'anonymisation est aussi tracée dans la piste d'audit (mig 476).
ALTER TABLE customer_audit DROP CONSTRAINT IF EXISTS customer_audit_action_check;
ALTER TABLE customer_audit ADD CONSTRAINT customer_audit_action_check
  CHECK (action IN ('create', 'update', 'archive', 'restore', 'anonymize'));
