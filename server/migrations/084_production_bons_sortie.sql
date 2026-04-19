-- =====================================================================
-- Migration 084: Bons de sortie (material requisition slips)
-- Phase 3 du module production v2
-- ADDITIVE ONLY — no existing tables or columns are modified
-- =====================================================================

-- 1. Table production_bons_sortie
-- En-tete du bon de sortie matiere premiere pour un plan de production
-- Format numero: BSI-YYMMDD-NNN
CREATE TABLE IF NOT EXISTS production_bons_sortie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  numero VARCHAR(30) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'genere'
    CHECK (status IN ('genere', 'prelevement', 'verifie', 'cloture', 'annule')),
  store_id UUID NOT NULL REFERENCES stores(id),
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  prelevement_by UUID REFERENCES users(id),
  prelevement_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table production_bons_sortie_lignes
-- Lignes du bon — une par allocation lot ingredient (FEFO)
CREATE TABLE IF NOT EXISTS production_bons_sortie_lignes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_id UUID NOT NULL REFERENCES production_bons_sortie(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  ingredient_lot_id UUID REFERENCES ingredient_lots(id),
  needed_quantity DECIMAL(12,4) NOT NULL,
  allocated_quantity DECIMAL(12,4) NOT NULL,
  actual_quantity DECIMAL(12,4),
  unit VARCHAR(20) NOT NULL DEFAULT 'kg',
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'preleve', 'ecart', 'substitue', 'rupture', 'annule')),
  ecart_quantity DECIMAL(12,4),
  ecart_reason TEXT,
  substitute_lot_id UUID REFERENCES ingredient_lots(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes pour performance
CREATE INDEX IF NOT EXISTS idx_bons_sortie_plan ON production_bons_sortie(plan_id);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_store ON production_bons_sortie(store_id);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_status ON production_bons_sortie(status);

CREATE INDEX IF NOT EXISTS idx_bons_sortie_lignes_bon ON production_bons_sortie_lignes(bon_id);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_lignes_ingredient ON production_bons_sortie_lignes(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_lignes_lot ON production_bons_sortie_lignes(ingredient_lot_id);

-- 4. Lien inverse: plan -> bon de sortie
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS bon_sortie_id UUID REFERENCES production_bons_sortie(id);
