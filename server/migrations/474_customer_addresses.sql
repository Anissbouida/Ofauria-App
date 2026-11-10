-- Migration 474 : référentiel d'adresses client (phase 4.1)
--
-- Un client peut avoir plusieurs adresses (livraison, facturation), avec pays
-- et code postal — la fiche client passe de l'adresse unique (customers.address,
-- conservée pour compat) à un référentiel comme les grands ERP. Chaque pièce
-- (BL d'abord) fige l'adresse retenue au moment de son émission.
--
-- kind : rôle de l'adresse — livraison, facturation, ou les deux.
-- Un seul défaut de livraison et un seul défaut de facturation par client
-- (index partiels uniques) : la résolution d'une pièce est déterministe.

CREATE TABLE IF NOT EXISTS customer_addresses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label               VARCHAR(80),
  kind                VARCHAR(12) NOT NULL DEFAULT 'both' CHECK (kind IN ('delivery', 'billing', 'both')),
  address_line        TEXT NOT NULL,
  postal_code         VARCHAR(20),
  city                VARCHAR(120),
  country_code        CHAR(2) NOT NULL DEFAULT 'MA',
  is_default_delivery BOOLEAN NOT NULL DEFAULT false,
  is_default_billing  BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);
-- Au plus une adresse par défaut de chaque rôle par client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_default_delivery
  ON customer_addresses(customer_id) WHERE is_default_delivery;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_default_billing
  ON customer_addresses(customer_id) WHERE is_default_billing;

-- Reprise de l'adresse unique existante en adresse par défaut (livraison +
-- facturation) : aucun client ne perd son adresse.
INSERT INTO customer_addresses (customer_id, label, kind, address_line, city, is_default_delivery, is_default_billing)
SELECT id, 'Adresse principale', 'both', address, city, true, true
  FROM customers
 WHERE address IS NOT NULL AND TRIM(address) <> '';

-- Adresse d'expédition figée sur le bon de livraison au moment de l'émission.
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS ship_address TEXT;
