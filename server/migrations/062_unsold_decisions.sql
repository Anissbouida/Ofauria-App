-- ═══════════════════════════════════════════════════════════════════════════
-- Decisions invendus fin de journee
-- Traçabilite complete du devenir de chaque produit invendu
-- ═══════════════════════════════════════════════════════════════════════════

-- Table principale : une decision par produit par session de cloture
CREATE TABLE IF NOT EXISTS unsold_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  session_id UUID REFERENCES cash_register_sessions(id),
  check_id UUID REFERENCES daily_inventory_checks(id) ON DELETE CASCADE,

  product_id UUID NOT NULL REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  category_name VARCHAR(255),

  -- Quantites
  initial_qty INTEGER NOT NULL DEFAULT 0,       -- stock debut de journee (avant ventes)
  sold_qty INTEGER NOT NULL DEFAULT 0,          -- vendus dans la journee
  remaining_qty INTEGER NOT NULL DEFAULT 0,     -- comptes physiquement par operateur
  discrepancy INTEGER NOT NULL DEFAULT 0,       -- ecart entre attendu et compte

  -- Decision
  -- 'reexpose' = maintien vitrine J+1, 'recycle' = recyclage production, 'waste' = destruction
  suggested_destination VARCHAR(20) NOT NULL CHECK (suggested_destination IN ('reexpose', 'recycle', 'waste')),
  suggested_reason TEXT,                        -- explication de la suggestion systeme
  final_destination VARCHAR(20) NOT NULL CHECK (final_destination IN ('reexpose', 'recycle', 'waste')),
  override_reason TEXT,                         -- motif si l'operateur change la suggestion
  is_override BOOLEAN NOT NULL DEFAULT false,   -- true si l'operateur a modifie la suggestion

  -- Contexte produit au moment de la decision (snapshot)
  shelf_life_days INTEGER,
  display_life_hours INTEGER,
  is_reexposable BOOLEAN DEFAULT false,
  max_reexpositions INTEGER DEFAULT 0,
  current_reexposition_count INTEGER DEFAULT 0,
  is_recyclable BOOLEAN DEFAULT false,
  recycle_ingredient_id UUID,
  sale_type VARCHAR(20),
  display_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  produced_at TIMESTAMPTZ,

  -- Cout pour valorisation des pertes
  unit_cost DECIMAL(10,2) DEFAULT 0,
  total_cost DECIMAL(10,2) DEFAULT 0,

  -- Audit
  decided_by UUID NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unsold_decisions_store ON unsold_decisions(store_id);
CREATE INDEX IF NOT EXISTS idx_unsold_decisions_session ON unsold_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_unsold_decisions_product ON unsold_decisions(product_id);
CREATE INDEX IF NOT EXISTS idx_unsold_decisions_date ON unsold_decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_unsold_decisions_destination ON unsold_decisions(final_destination);
CREATE INDEX IF NOT EXISTS idx_unsold_decisions_check ON unsold_decisions(check_id);

-- Ajouter le type 'recycle' aux transactions d'inventaire si pas deja present
-- (deja gere dans le code, mais on s'assure que la contrainte est compatible)
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_transactions' AND column_name = 'type') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check
      CHECK (type IN ('restock', 'usage', 'adjustment', 'waste', 'recycle'));
  END IF;
EXCEPTION WHEN others THEN
  -- constraint may not exist or column may differ
  NULL;
END $$;
