-- 372 — Promotions (règles de prix) et programme de fidélité.
--
-- 1. promotions : remise automatique sur des articles (pourcentage, montant par unité,
--    prix spécial, « X achetés = Y offerts ») ou sur le panier (pourcentage, montant),
--    sous conditions (période, jours, heures, magasin, type de client, niveau de fidélité,
--    quantité ou montant minimum, code promo, nombre d'utilisations). Canaux : caisse,
--    commandes, devis. Règle de cumul simple : par ligne, la meilleure promotion article ;
--    puis la meilleure promotion panier sur le reste.
-- 2. document_promotions : promotions appliquées à une vente, une commande ou un devis.
--    sales/orders/quotes.promotion_amount : part promotion de discount_amount.
-- 3. Fidélité : paramètres (loyalty_settings, une ligne), niveaux (loyalty_tiers, sur les
--    points gagnés en 12 mois glissants) et mouvements (loyalty_transactions). Le solde
--    customers.loyalty_points est tenu par trigger ; les points gagnés expirent au bout de
--    expiry_months (consommation la plus ancienne d'abord, colonne remaining).
-- 4. Comptabilité : les points sont une dette envers les clients (4491). Gain : D 7129 /
--    C 4491 ; utilisation (remise sur le ticket, déjà en 7129 dans l'écriture de vente) et
--    expiration : D 4491 / C 7129. Écritures OD, source_kind 'loyalty'.
--
-- Rollback :
--   DROP TABLE document_promotions, promotions, loyalty_transactions, loyalty_tiers, loyalty_settings ;
--   ALTER TABLE sales DROP COLUMN promotion_amount, DROP COLUMN loyalty_points_used, DROP COLUMN loyalty_amount, DROP COLUMN coupon_code ;
--   ALTER TABLE sale_items DROP COLUMN promo_discount ; ALTER TABLE orders/quotes DROP COLUMN promotion_amount ;
--   DELETE FROM scheduled_jobs WHERE key = 'loyalty_expire' ; DELETE FROM posting_profiles WHERE event_type LIKE 'loyalty_%' ;
--   remettre l'ancienne contrainte journal_entries_source_kind_check (sans 'loyalty').

-- ─── 1. Promotions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(120) NOT NULL,
  description    TEXT,
  target         VARCHAR(10) NOT NULL CHECK (target IN ('items', 'cart')),
  kind           VARCHAR(16) NOT NULL CHECK (kind IN ('percent', 'amount', 'fixed_price', 'buy_x_get_y')),
  value          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  buy_qty        SMALLINT CHECK (buy_qty IS NULL OR buy_qty >= 1),
  get_qty        SMALLINT CHECK (get_qty IS NULL OR get_qty >= 1),
  -- Articles visés : produits et/ou catégories ; les deux vides = tout le catalogue.
  product_ids    UUID[] NOT NULL DEFAULT '{}',
  category_ids   INTEGER[] NOT NULL DEFAULT '{}',
  min_quantity   NUMERIC(12,3) CHECK (min_quantity IS NULL OR min_quantity > 0),
  min_amount     NUMERIC(12,2) CHECK (min_amount IS NULL OR min_amount > 0),
  coupon_code    VARCHAR(40),
  customer_scope VARCHAR(16) NOT NULL DEFAULT 'all'
                 CHECK (customer_scope IN ('all', 'identified', 'particulier', 'professionnel', 'tier')),
  min_tier_code  VARCHAR(20),
  on_pos         BOOLEAN NOT NULL DEFAULT true,
  on_orders      BOOLEAN NOT NULL DEFAULT false,
  on_quotes      BOOLEAN NOT NULL DEFAULT false,
  store_id       UUID REFERENCES stores(id) ON DELETE SET NULL,
  starts_on      DATE,
  ends_on        DATE,
  days_of_week   SMALLINT[] NOT NULL DEFAULT '{}',   -- 1 = lundi … 7 = dimanche ; vide = tous
  time_from      TIME,
  time_to        TIME,
  max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count     INTEGER NOT NULL DEFAULT 0,
  priority       SMALLINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotions_cart_kind CHECK (target = 'items' OR kind IN ('percent', 'amount')),
  CONSTRAINT promotions_percent CHECK (kind <> 'percent' OR value <= 100),
  CONSTRAINT promotions_bxgy CHECK (kind <> 'buy_x_get_y' OR (buy_qty IS NOT NULL AND get_qty IS NOT NULL)),
  CONSTRAINT promotions_tier CHECK (customer_scope <> 'tier' OR min_tier_code IS NOT NULL),
  CONSTRAINT promotions_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT promotions_channel CHECK (on_pos OR on_orders OR on_quotes)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_coupon ON promotions (upper(coupon_code)) WHERE coupon_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions (is_active, ends_on);
COMMENT ON TABLE promotions IS 'Règles de prix (mig 372) : remise automatique articles ou panier, sous conditions.';

CREATE TABLE IF NOT EXISTS document_promotions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  sale_id      UUID REFERENCES sales(id) ON DELETE CASCADE,
  order_id     UUID REFERENCES orders(id) ON DELETE CASCADE,
  quote_id     UUID REFERENCES quotes(id) ON DELETE CASCADE,
  label        VARCHAR(160) NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_promotions_one_doc CHECK (num_nonnulls(sale_id, order_id, quote_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_docpromo_sale ON document_promotions (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docpromo_order ON document_promotions (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docpromo_quote ON document_promotions (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docpromo_promotion ON document_promotions (promotion_id, created_at);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS promotion_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS loyalty_points_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS loyalty_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(40);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promo_discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS promotion_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN sales.promotion_amount IS 'Part de discount_amount due aux promotions (mig 372).';
COMMENT ON COLUMN sales.loyalty_amount IS 'Part de discount_amount payée en points de fidélité (mig 372).';

-- ─── 2. Fidélité ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id                BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  earn_points       INTEGER NOT NULL DEFAULT 1 CHECK (earn_points >= 1),
  earn_per_amount   NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (earn_per_amount > 0),
  point_value       NUMERIC(10,4) NOT NULL DEFAULT 0.01 CHECK (point_value > 0),
  min_redeem_points INTEGER NOT NULL DEFAULT 500 CHECK (min_redeem_points >= 1),
  max_redeem_pct    NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (max_redeem_pct > 0 AND max_redeem_pct <= 100),
  expiry_months     SMALLINT NOT NULL DEFAULT 12 CHECK (expiry_months BETWEEN 0 AND 120),
  updated_by        UUID REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Barème repris de l'existant : 1 point par dirham ; 1 point = 0,01 DH (1 % rendu).
INSERT INTO loyalty_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
COMMENT ON TABLE loyalty_settings IS 'Programme de fidélité (mig 372) : earn_points points par earn_per_amount DH payés ; 1 point vaut point_value DH.';

CREATE TABLE IF NOT EXISTS loyalty_tiers (
  code            VARCHAR(20) PRIMARY KEY,
  label           VARCHAR(60) NOT NULL,
  min_points      INTEGER NOT NULL CHECK (min_points >= 0),
  earn_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (earn_multiplier >= 1 AND earn_multiplier <= 10),
  color           VARCHAR(20),
  is_active       BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO loyalty_tiers (code, label, min_points, earn_multiplier, color) VALUES
  ('bronze', 'Bronze', 500, 1, 'orange'),
  ('argent', 'Argent', 2000, 1.25, 'grey'),
  ('or',     'Or',     5000, 1.5, 'yellow')
ON CONFLICT (code) DO NOTHING;
COMMENT ON TABLE loyalty_tiers IS 'Niveaux de fidélité (mig 372) : atteints selon les points gagnés sur 12 mois glissants ; multiplient les points gagnés.';

ALTER TABLE promotions ADD CONSTRAINT promotions_tier_fk FOREIGN KEY (min_tier_code) REFERENCES loyalty_tiers(code) ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind        VARCHAR(10) NOT NULL CHECK (kind IN ('earn', 'redeem', 'expire', 'adjust', 'reverse')),
  points      INTEGER NOT NULL CHECK (points <> 0),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,      -- valeur en DH au moment du mouvement
  remaining   INTEGER,                               -- points encore disponibles (mouvements positifs)
  expires_at  TIMESTAMPTZ,
  sale_id     UUID REFERENCES sales(id) ON DELETE SET NULL,
  note        VARCHAR(255),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_tx_remaining CHECK (remaining IS NULL OR (points > 0 AND remaining BETWEEN 0 AND points))
);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON loyalty_transactions (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_open ON loyalty_transactions (customer_id, expires_at) WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_sale ON loyalty_transactions (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_expiry ON loyalty_transactions (expires_at) WHERE remaining > 0;

-- Reprise des soldes existants (1 point par dirham déjà cumulé), avant le trigger :
-- le solde de la fiche est déjà juste. Pas d'écriture : la dette d'ouverture reste hors bilan.
INSERT INTO loyalty_transactions (customer_id, kind, points, amount, remaining, expires_at, note)
SELECT id, 'adjust', loyalty_points, round(loyalty_points * 0.01, 2), loyalty_points, now() + interval '12 months', 'Solde repris à la mise en place du programme'
  FROM customers WHERE loyalty_points > 0
   AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.customer_id = customers.id);
UPDATE customers SET loyalty_points = 0 WHERE loyalty_points IS NULL OR loyalty_points < 0;

CREATE OR REPLACE FUNCTION trg_loyalty_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + NEW.points WHERE id = NEW.customer_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS loyalty_transactions_balance ON loyalty_transactions;
CREATE TRIGGER loyalty_transactions_balance AFTER INSERT ON loyalty_transactions FOR EACH ROW EXECUTE FUNCTION trg_loyalty_balance();

-- ─── 3. Comptabilité ───────────────────────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active)
VALUES ('4491', 'Produits constatés d''avance (points de fidélité)', 4, '44', '449', 'liability', 'C', false, true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO posting_profiles (event_type, account_code, description) VALUES
  ('loyalty_liability', '4491', 'Points de fidélité non encore utilisés : dette envers les clients (mig 372)'),
  ('loyalty_cost',      '7129', 'Contrepartie des points de fidélité : remise accordée (mig 372)')
ON CONFLICT DO NOTHING;

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check CHECK (source_kind IN (
  'manual', 'invoice', 'credit_note', 'payment', 'payment_void', 'sale', 'reversal', 'backfill', 'shift_entry',
  'product_loss', 'closure_diff', 'advance_repayment', 'goods_receipt', 'goods_receipt_return', 'price_variance',
  'landed_cost', 'period_accrual', 'accrual_reversal', 'grir_write_off', 'vat_reclass', 'depreciation',
  'asset_acquisition', 'withholding_remittance', 'loyalty'));

-- ─── 4. Tâche planifiée ────────────────────────────────────────────────────
INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('loyalty_expire', 'Expiration des points de fidélité', 'Retire les points arrivés à expiration et solde la dette correspondante.', 'sales', 1440, 48)
ON CONFLICT (key) DO NOTHING;
