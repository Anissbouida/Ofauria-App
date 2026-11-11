-- Phase 6.1–6.3 — Listes de prix, prix négocié par client, résolution prioritaire.
--
-- Une liste de prix cible un canal, un groupe de clients (type ou groupe libre) ou un
-- client précis, avec une devise et une période de validité. Ses lignes portent un prix
-- par article, avec un palier de quantité (min_quantity). Un résolveur unique choisit la
-- liste la plus spécifique en vigueur, puis la ligne du bon palier — appliqué en caisse,
-- devis, commande et BL.
--
-- Additif : sans aucune liste active, la résolution ne renvoie rien et les écrans gardent
-- le prix de base de l'article (paliers mig 171 / surcharges canal mig 173 inchangés).

-- Groupe de clients libre (ex. « Hôtels », « Grossistes ») : dimension de ciblage en plus
-- du type de client.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_group VARCHAR(40);

CREATE TABLE IF NOT EXISTS price_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  currency      VARCHAR(3) NOT NULL DEFAULT 'MAD',
  channel_id    UUID REFERENCES sales_channels(id) ON DELETE CASCADE,
  customer_type VARCHAR(20),
  price_group   VARCHAR(40),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  valid_from    DATE,
  valid_to      DATE,
  priority      INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_price_lists_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_price_lists_active ON price_lists (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS price_list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity  NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_price    NUMERIC(12,4) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_price_list_item UNIQUE (price_list_id, product_id, min_quantity),
  CONSTRAINT chk_price_list_item_qty CHECK (min_quantity >= 0),
  CONSTRAINT chk_price_list_item_price CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_price_list_items_lookup ON price_list_items (product_id, price_list_id);
