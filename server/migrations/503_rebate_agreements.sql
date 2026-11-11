-- Phase 11 (D5-12) — ristournes de fin d'année (RFA).
--
-- Un accord par client et par année : un taux appliqué au chiffre d'affaires
-- annuel au-delà d'un seuil. Le réalisé se lit sur les factures émises (net des
-- avoirs). La « ristourne calculée » est figée à la clôture de l'accord ; son
-- émission en avoir reste le flux manuel existant (on y rattache l'avoir).
-- Additif : table neuve, aucun flux existant modifié.

CREATE TABLE IF NOT EXISTS rebate_agreements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            uuid NOT NULL REFERENCES customers(id),
  year                   integer NOT NULL,
  rate_percent           numeric(6,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  min_turnover           numeric(14,2) NOT NULL DEFAULT 0,  -- seuil de déclenchement
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
  computed_turnover      numeric(14,2),                     -- CA figé à la clôture
  computed_amount        numeric(14,2),                     -- ristourne figée à la clôture
  settled_at             timestamptz,
  settled_credit_note_id uuid REFERENCES invoices(id),       -- avoir émis, rattaché a posteriori
  notes                  text,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, year)
);
