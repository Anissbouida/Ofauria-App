-- Migration 171 : Paliers tarifaires pour la vente au poids.
--
-- Aujourd'hui, products.price_per_kg est unique : peu importe que le client
-- achete 100g ou 2kg, le prix au kg est le meme. On veut pouvoir tarifer
-- de maniere degressive (ou progressive) selon la quantite achetee.
--
-- Exemple gateau marocain vendu au kg :
--   <250g  -> 80 DH/kg
--   250-500g -> 75 DH/kg
--   >500g  -> 70 DH/kg
--
-- Chaque palier definit [min_grammes, max_grammes) et un prix_per_kg. Le palier
-- "trouve" est celui dont min_grammes <= poids_g < COALESCE(max_grammes, infinity).
-- Si aucun palier ne matche pour le poids demande, le POS retombe sur
-- products.price_per_kg (comportement existant inchange).
--
-- N'a de sens que pour les produits sale_unit='weight'. Aucune contrainte SQL
-- ne le force (un produit unit peut avoir une ligne sans qu'elle soit utilisee)
-- mais la fiche produit cachera l'UI pour les produits unit.

CREATE TABLE IF NOT EXISTS product_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_grammes INT NOT NULL CHECK (min_grammes >= 0),
  max_grammes INT NULL CHECK (max_grammes IS NULL OR max_grammes > min_grammes),
  prix_per_kg DECIMAL(10,2) NOT NULL CHECK (prix_per_kg > 0),
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE product_pricing_tiers IS
  'Paliers tarifaires pour la vente au poids. Le palier matche si min_grammes <= poids < COALESCE(max_grammes, infini).';
COMMENT ON COLUMN product_pricing_tiers.max_grammes IS
  'NULL = pas de limite haute (s''applique a partir de min_grammes).';

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_product
  ON product_pricing_tiers(product_id, min_grammes);
