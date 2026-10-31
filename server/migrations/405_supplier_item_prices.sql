-- 405 — Prix d'achat datés par fournisseur (Achats, lot prix P2)
--
-- Historise le prix d'achat PAR fournisseur et PAR date, sur la fiche article ×
-- fournisseur (mig 404). Résout le problème n°1 de l'audit : un prix par
-- fournisseur, qualifié (unité, source), au lieu d'un `ingredients.unit_cost`
-- unique écrasé. (Le CMUP `unit_cost` reste la valorisation du stock — intact.)
--
-- « Prix courant » d'un fournisseur = la ligne en vigueur (valid_to NULL, ou dont
-- [valid_from, valid_to] couvre aujourd'hui). Un seul prix en vigueur par fiche
-- (index unique partiel). Alimenté à la main OU automatiquement à la réception
-- (source='reception') et, plus tard, au BC / à la facture.
--
-- INVERSION :
--   DROP VIEW IF EXISTS v_current_supplier_price;
--   DROP TABLE IF EXISTS supplier_item_prices;

CREATE TABLE IF NOT EXISTS supplier_item_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_item_id UUID NOT NULL REFERENCES supplier_items(id) ON DELETE CASCADE,
  price            NUMERIC(14,4) NOT NULL CHECK (price >= 0),
  currency         CHAR(3) NOT NULL DEFAULT 'MAD',
  price_unit       VARCHAR(10) NOT NULL DEFAULT 'base' CHECK (price_unit IN ('base', 'container')),
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to         DATE,
  source           VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'quote', 'invoice', 'po', 'reception')),
  source_doc_id    UUID,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sip_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_sip_item ON supplier_item_prices (supplier_item_id, valid_from DESC);
-- Un seul prix « en vigueur » (valid_to NULL) par fiche.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sip_current ON supplier_item_prices (supplier_item_id) WHERE valid_to IS NULL;

CREATE OR REPLACE VIEW v_current_supplier_price AS
SELECT DISTINCT ON (supplier_item_id)
       supplier_item_id, price, currency, price_unit, valid_from, source
FROM supplier_item_prices
WHERE valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
ORDER BY supplier_item_id, (valid_to IS NULL) DESC, valid_from DESC, created_at DESC;

COMMENT ON VIEW v_current_supplier_price IS
  'Prix d''achat en vigueur par fiche article × fournisseur (mig 405, Achats lot prix P2).';
