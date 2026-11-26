-- 719 — Stock détenu pour le compte de clients : registre séparé (feuille de route, étape 2.5).
--
-- Un lot matière actif alimente automatiquement l'inventaire de la société, son coût et la
-- file de consommation FEFO de la production (déclencheurs de ingredient_lots). Y ranger la
-- marchandise d'un client exposerait la production à la consommer. Le stock des déposants
-- (entrepôt logistique) a donc son propre registre : articles du client, entrées et sorties
-- par lot, emplacement facultatif. Il n'entre ni dans l'inventaire, ni dans la valeur, ni dans
-- les achats de la société. Capacité stock_deposant (mig 712, profil transport).
-- La colonne ingredient_lots.owner_customer_id (mig 712) reste exclue de la valorisation mais
-- n'est plus le chemin de saisie.

CREATE TABLE IF NOT EXISTS deposit_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  code VARCHAR(60) NOT NULL,
  label VARCHAR(200) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'unité',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, code)
);

CREATE TABLE IF NOT EXISTS deposit_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES deposit_articles(id) ON DELETE RESTRICT,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('in', 'out')),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  lot_number VARCHAR(80),
  expiration_date DATE,
  location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  reference VARCHAR(120),
  note TEXT,
  store_id UUID REFERENCES stores(id),
  recorded_by UUID REFERENCES users(id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_movements_article ON deposit_movements(article_id, lot_number);

-- Stock par article et par lot (entrées − sorties).
CREATE OR REPLACE VIEW v_deposit_stock AS
SELECT a.id AS article_id, a.customer_id, a.code, a.label, a.unit, m.lot_number,
       MIN(m.expiration_date) FILTER (WHERE m.kind = 'in') AS expiration_date,
       SUM(CASE WHEN m.kind = 'in' THEN m.quantity ELSE -m.quantity END) AS quantity,
       MAX(m.moved_at) AS last_move_at
  FROM deposit_articles a JOIN deposit_movements m ON m.article_id = a.id
 GROUP BY a.id, a.customer_id, a.code, a.label, a.unit, m.lot_number;
