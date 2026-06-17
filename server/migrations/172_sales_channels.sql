-- Migration 172 : Canaux de vente.
--
-- Aujourd'hui, un produit a un seul prix (products.price ou price_per_kg).
-- Peu importe que la vente passe en boutique, par commande, lors d'un evenement
-- ou en gros : c'est toujours le meme prix.
--
-- Ici on introduit la notion de "canal de vente". Le canal sera utilise :
--   - au POS pour resoudre le prix (via product_channel_pricing en mig 173)
--   - sur la table sales pour tracer le canal de chaque transaction
--
-- 5 canaux seedes par defaut (le client peut en ajouter via Settings) :
--   boutique     : vente directe au comptoir (canal par defaut)
--   commande     : commande client a l'avance
--   evenement    : commande pour evenement (mariage, anniversaire...)
--   gros        : vente B2B en gros (restaurants, hotels...)
--   livraison   : livraison a domicile (plate-forme externe ou propre)

CREATE TABLE IF NOT EXISTS sales_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#64748b',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sales_channels IS
  'Canaux de vente. Chaque vente est rattachee a un canal pour la tarification differenciee et le reporting.';
COMMENT ON COLUMN sales_channels.is_default IS
  'Un seul canal peut etre is_default=true. Utilise quand la vente n''indique pas explicitement un canal.';

-- Garantit un seul defaut actif a tout moment.
CREATE UNIQUE INDEX IF NOT EXISTS sales_channels_one_default
  ON sales_channels(is_default) WHERE is_default = true;

INSERT INTO sales_channels (code, label, color, is_default, display_order) VALUES
  ('boutique',  'Boutique',   '#16a34a', true,  10),  -- green-600
  ('commande',  'Commande',   '#2563eb', false, 20),  -- blue-600
  ('evenement', 'Evenement',  '#9333ea', false, 30),  -- purple-600
  ('gros',      'Gros / B2B', '#ea580c', false, 40),  -- orange-600
  ('livraison', 'Livraison',  '#0891b2', false, 50)   -- cyan-600
ON CONFLICT (code) DO NOTHING;

-- channel_id sur sales. Nullable au depart (compat retro), backfille en
-- meme temps. Le code POS sera modifie pour ecrire le canal a chaque vente.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS channel_id UUID NULL REFERENCES sales_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales(channel_id) WHERE channel_id IS NOT NULL;

COMMENT ON COLUMN sales.channel_id IS
  'Canal de vente. NULL pour les ventes legacy ou backfille = boutique.';

-- Backfill : toutes les ventes existantes -> canal 'boutique'
UPDATE sales
SET channel_id = (SELECT id FROM sales_channels WHERE code = 'boutique' LIMIT 1)
WHERE channel_id IS NULL;
