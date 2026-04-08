-- Enrichir daily_inventory_check_items avec la destination des invendus
ALTER TABLE daily_inventory_check_items ADD COLUMN IF NOT EXISTS destination TEXT DEFAULT 'reexpose';
-- destination: 'reexpose' (remis en vitrine), 'recycle' (réutilisé comme ingrédient), 'waste' (perte/destruction)
ALTER TABLE daily_inventory_check_items ADD COLUMN IF NOT EXISTS reexposition_count INTEGER DEFAULT 0;
ALTER TABLE daily_inventory_check_items ADD COLUMN IF NOT EXISTS display_status TEXT;
-- display_status: 'ok', 'expiring_soon', 'expired' — snapshot du statut au moment de la fermeture

-- Table pour tracker le nombre de réexpositions cumulées par produit/magasin
CREATE TABLE IF NOT EXISTS product_display_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  current_reexposition_count INTEGER DEFAULT 0,
  first_displayed_at TIMESTAMPTZ,
  last_reexposed_at TIMESTAMPTZ,
  produced_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  display_expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active', -- 'active', 'removed', 'recycled', 'wasted'
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, store_id, first_displayed_at)
);

CREATE INDEX IF NOT EXISTS idx_product_display_tracking_store ON product_display_tracking(store_id, status);
CREATE INDEX IF NOT EXISTS idx_product_display_tracking_product ON product_display_tracking(product_id);
