-- Phase 5.7 — Régime de TVA, droit de timbre, attestation d'exonération datée.
--
-- Cette phase est BLOQUÉE par les réponses de l'expert-comptable : on pose ici un
-- socle ADDITIF et INERTE par défaut. Rien ne change pour Ofauria tant qu'aucun
-- paramètre n'est activé et qu'aucune attestation n'est saisie. Les montants et les
-- écritures de TVA ne sont PAS modifiés par ce lot ; les réglages préparent les
-- décisions fiscales (droit de timbre, régime débit/encaissement, exonération).

-- Attestations d'exonération de TVA d'un client, datées (numéro, motif, validité).
CREATE TABLE IF NOT EXISTS customer_tax_exemptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  certificate_number VARCHAR(60) NOT NULL,
  reason             VARCHAR(160),
  valid_from         DATE NOT NULL,
  valid_to           DATE,
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_tax_exemption_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_customer_tax_exemptions_customer
  ON customer_tax_exemptions (customer_id) WHERE is_active;

-- Paramètres fiscaux, inertes par défaut :
--  - régime de TVA : débit (TVA exigible à la facture) ou encaissement ; informatif
--    pour l'instant, la déclaration l'exploitera selon l'expert ;
--  - droit de timbre : taux et minimum sur les règlements espèces, désactivé.
INSERT INTO module_parameters (key, value, description) VALUES
  ('sales.vat_regime', '{"mode":"debit"}'::jsonb,
   'Régime de TVA : débit (à la facture) ou encaissement (phase 5.7, selon expert-comptable).'),
  ('sales.stamp_duty', '{"enabled":false,"rate_pct":0.25,"min_dh":1,"cash_only":true}'::jsonb,
   'Droit de timbre sur les règlements espèces (phase 5.7, désactivé par défaut, selon expert-comptable).')
ON CONFLICT (key) DO NOTHING;
