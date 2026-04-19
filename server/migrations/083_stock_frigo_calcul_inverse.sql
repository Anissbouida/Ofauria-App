-- =====================================================================
-- Migration 083: Stock frigo (produits finis reliquats) + Calcul inverse
-- Phase 2 du module production v2
-- =====================================================================

-- 1. Table stock_semifini_frigo
-- Stocke les reliquats de produits finis issus de la production par contenant
-- Ex: on produit 1 cadre de 20 parts, on en vend 18 → 2 parts restent au frigo
CREATE TABLE IF NOT EXISTS stock_semifini_frigo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  lot_number VARCHAR(50),
  produced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  source_plan_id UUID REFERENCES production_plans(id),
  source_contenant_id UUID REFERENCES production_contenants(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_frigo_product ON stock_semifini_frigo(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_stock_frigo_expiry ON stock_semifini_frigo(expires_at) WHERE is_active = true AND quantity > 0;

-- 2. Transactions frigo (tracabilite entrees/sorties)
CREATE TABLE IF NOT EXISTS stock_frigo_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_frigo_id UUID NOT NULL REFERENCES stock_semifini_frigo(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('production_in', 'sale_out', 'replenishment_out', 'loss', 'adjustment', 'expired')),
  quantity DECIMAL(10,2) NOT NULL,
  reference_id UUID,
  reference_type VARCHAR(50),
  performed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Colonnes calcul inverse sur production_plan_items
-- nb_contenants = nombre de contenants a produire
-- quantite_nette_cible = quantite nette par contenant (snapshot au moment du calcul)
-- contenant_id = reference au contenant utilise
-- surplus_frigo = quantite excedentaire a stocker au frigo
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS contenant_id UUID REFERENCES production_contenants(id);
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS nb_contenants INTEGER;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS quantite_nette_cible DECIMAL(10,2);
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS quantite_brute_totale DECIMAL(10,2);
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS qty_from_frigo INTEGER DEFAULT 0;
ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS surplus_frigo INTEGER DEFAULT 0;

-- 4. Feature flag pour activer le stock frigo
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS production_frigo_enabled BOOLEAN DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS production_calcul_inverse_enabled BOOLEAN DEFAULT false;
