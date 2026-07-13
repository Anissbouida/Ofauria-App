-- Migration 236 : Catalogue produits éditable du module Contrôle des ventes (ISOLE, TEMPORAIRE)
-- Jusqu'ici le catalogue était déduit de l'historique recon_lines (DISTINCT ON) :
-- impossible d'ajouter / corriger / supprimer un produit. Cette table devient la
-- source du catalogue ; les imports (Loyverse, appro) y enregistrent
-- automatiquement les produits inconnus.
-- DROP : DROP TABLE IF EXISTS recon_products;

CREATE TABLE IF NOT EXISTS recon_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cle de rapprochement : SKU s'il existe, sinon nom normalise (UPPER)
  product_key VARCHAR(200) NOT NULL UNIQUE,
  sku VARCHAR(100),
  product_name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reprise : peuple le catalogue depuis l'historique (version la plus recente de chaque produit)
INSERT INTO recon_products (product_key, sku, product_name, category, unit_price)
SELECT DISTINCT ON (rl.product_key)
  rl.product_key, rl.sku, rl.product_name, rl.category, rl.unit_price
FROM recon_lines rl
JOIN recon_days rd ON rd.id = rl.recon_day_id
ORDER BY rl.product_key, rd.business_date DESC
ON CONFLICT (product_key) DO NOTHING;
