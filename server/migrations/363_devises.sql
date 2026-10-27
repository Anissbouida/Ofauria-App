-- 363 — Plusieurs devises (lot 1 : achats)
--
-- La devise de tenue reste le dirham (MAD) : stock, coût matière, CMUP, factures et
-- comptabilité sont en DH. Une pièce d'achat peut être négociée dans une autre devise :
-- elle porte sa devise et le taux du jour, figé, et chaque ligne garde le prix d'origine
-- en devise à côté du prix converti en DH (celui qu'utilise tout le reste du système).
--
-- Conventions :
--   - un taux = nombre de DH pour 1 unité de devise (1 EUR = 10,85 DH) ;
--   - les taux sont datés ; le taux d'une date = le dernier connu à cette date ;
--   - MAD est la devise de base, son taux vaut toujours 1.
--
-- Rollback :
--   DROP TRIGGER trg_po_item_foreign_price ON purchase_order_items ; DROP FUNCTION fn_po_item_foreign_price() ;
--   ALTER TABLE supplier_quotations DROP COLUMN currency_code, DROP COLUMN exchange_rate ;
--   ALTER TABLE purchase_order_items DROP COLUMN foreign_unit_price ;
--   ALTER TABLE purchase_orders DROP COLUMN currency_code, DROP COLUMN exchange_rate ;
--   ALTER TABLE suppliers DROP COLUMN currency_code ;
--   DROP FUNCTION fn_exchange_rate(text, date) ; DROP TABLE exchange_rates, currencies.

CREATE TABLE IF NOT EXISTS currencies (
  code        CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  label       VARCHAR(60) NOT NULL,
  symbol      VARCHAR(8),
  decimals    SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  is_base     BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_currencies_base ON currencies (is_base) WHERE is_base;
COMMENT ON TABLE currencies IS 'Devises (mig 363). La devise de base (MAD) est celle de la tenue des comptes et du stock.';

INSERT INTO currencies (code, label, symbol, decimals, is_base) VALUES
  ('MAD', 'Dirham marocain', 'DH', 2, true),
  ('EUR', 'Euro', '€', 2, false),
  ('USD', 'Dollar américain', '$', 2, false),
  ('GBP', 'Livre sterling', '£', 2, false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code  CHAR(3) NOT NULL REFERENCES currencies(code),
  valid_on       DATE NOT NULL,
  rate           NUMERIC(14,6) NOT NULL CHECK (rate > 0),
  source         VARCHAR(80),
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (currency_code, valid_on)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates ON exchange_rates (currency_code, valid_on DESC);
COMMENT ON TABLE exchange_rates IS 'Taux de change datés (mig 363) : DH pour 1 unité de devise.';

/** Taux d'une devise à une date : dernier taux connu à cette date ; 1 pour la devise de base ; NULL si inconnu. */
CREATE OR REPLACE FUNCTION fn_exchange_rate(p_code TEXT, p_date DATE DEFAULT CURRENT_DATE) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN (SELECT is_base FROM currencies WHERE code = p_code) THEN 1::numeric
              ELSE (SELECT rate FROM exchange_rates WHERE currency_code = p_code AND valid_on <= p_date ORDER BY valid_on DESC LIMIT 1) END
$$;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code);
COMMENT ON COLUMN suppliers.currency_code IS 'Devise habituelle du fournisseur (mig 363) ; proposée sur ses BC et devis.';

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
COMMENT ON COLUMN purchase_orders.exchange_rate IS 'Taux figé à la création (DH pour 1 unité de devise) ; 1 en DH. Les prix des lignes sont en DH.';

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS foreign_unit_price NUMERIC(14,4) CHECK (foreign_unit_price IS NULL OR foreign_unit_price >= 0);
COMMENT ON COLUMN purchase_order_items.foreign_unit_price IS 'Prix unitaire dans la devise du BC (mig 363) ; unit_price reste le prix en DH.';

ALTER TABLE supplier_quotations ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code);
ALTER TABLE supplier_quotations ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
COMMENT ON COLUMN supplier_quotations.exchange_rate IS 'Taux du devis (mig 363) : prix et port saisis en devise, comparés en DH.';

-- Toute modification ultérieure du prix DH d'une ligne (révision des prix, prix saisi à la
-- réception, édition admin, avenant) recalcule le prix en devise au taux figé du BC, pour
-- que les deux prix ne divergent jamais. Ne s'applique pas si le prix devise est fourni.
CREATE OR REPLACE FUNCTION fn_po_item_foreign_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cur CHAR(3); v_rate NUMERIC;
BEGIN
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price AND NEW.foreign_unit_price IS NOT DISTINCT FROM OLD.foreign_unit_price THEN
    SELECT currency_code, exchange_rate INTO v_cur, v_rate FROM purchase_orders WHERE id = NEW.purchase_order_id;
    IF v_cur IS NOT NULL AND v_cur <> 'MAD' AND v_rate > 0 THEN
      NEW.foreign_unit_price := CASE WHEN NEW.unit_price IS NULL THEN NULL ELSE round(NEW.unit_price / v_rate, 4) END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_item_foreign_price ON purchase_order_items;
CREATE TRIGGER trg_po_item_foreign_price BEFORE UPDATE OF unit_price ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION fn_po_item_foreign_price();
