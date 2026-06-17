-- Migration 173 : Override de prix par produit et par canal.
--
-- Pour un produit donne, on peut definir un prix specifique pour un canal.
-- Si un row existe pour (product_id, channel_id), il prime sur le prix de
-- catalogue (products.price / products.price_per_kg) et sur les paliers
-- tarifaires (mig 171).
--
-- Resolution prix au POS (ordre de priorite) :
--   1) product_channel_pricing pour (product, canal)
--   2) product_pricing_tiers pour (product, poids)             (vente au poids uniquement)
--   3) products.price ou products.price_per_kg                 (catalogue)
--
-- Pour les produits 'unit' : price_override est utilise.
-- Pour les produits 'weight' : price_per_kg_override est utilise.
-- Les 2 sont nullables : on peut definir un override pour un canal et pas
-- pour les autres (le canal sans row tombe en fallback).

CREATE TABLE IF NOT EXISTS product_channel_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  price_override DECIMAL(10,2) NULL CHECK (price_override IS NULL OR price_override > 0),
  price_per_kg_override DECIMAL(10,2) NULL CHECK (price_per_kg_override IS NULL OR price_per_kg_override > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, channel_id),
  -- Au moins l'un des 2 doit etre renseigne (sinon la ligne est inutile).
  CHECK (price_override IS NOT NULL OR price_per_kg_override IS NOT NULL)
);

COMMENT ON TABLE product_channel_pricing IS
  'Override du prix d''un produit pour un canal. Resolution POS : channel_pricing > pricing_tier > products.price.';

CREATE INDEX IF NOT EXISTS idx_pcp_product_channel
  ON product_channel_pricing(product_id, channel_id);
