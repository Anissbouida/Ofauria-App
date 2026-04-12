-- ═══════════════════════════════════════════════════════════════════
-- 060 – Product Integration Pipeline (Workflow de validation multi-étapes)
-- ═══════════════════════════════════════════════════════════════════
-- 7-stage sequential workflow for new product integration:
-- 1. Proposition → 2. Développement recette → 3. Calcul coût →
-- 4. Test production → 5. Dégustation → 6. Validation admin → 7. Intégration catalogue

-- Pipeline stage enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_stage') THEN
    CREATE TYPE pipeline_stage AS ENUM (
      'proposition',
      'recipe_development',
      'cost_calculation',
      'production_test',
      'tasting_evaluation',
      'admin_validation',
      'catalog_integration'
    );
  END IF;
END $$;

-- Admin decision enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_decision') THEN
    CREATE TYPE pipeline_decision AS ENUM ('approved', 'rejected', 'revision_requested');
  END IF;
END $$;

-- Pipeline status (overall)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_status') THEN
    CREATE TYPE pipeline_status AS ENUM ('active', 'completed', 'rejected', 'cancelled');
  END IF;
END $$;

-- ═══ Main pipeline table ═══
CREATE TABLE IF NOT EXISTS product_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ─── Stage 1: Proposition ───
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id INT REFERENCES categories(id),
  responsible_user_id UUID REFERENCES users(id),
  target_date DATE,

  -- ─── Stage tracking ───
  current_stage pipeline_stage NOT NULL DEFAULT 'proposition',
  status pipeline_status NOT NULL DEFAULT 'active',

  -- ─── Stage 2: Recipe Development ───
  recipe_id UUID REFERENCES recipes(id),
  recipe_notes TEXT,

  -- ─── Stage 3: Cost Calculation ───
  estimated_cost DECIMAL(10,2),
  target_price DECIMAL(10,2),
  target_margin DECIMAL(5,2),
  cost_notes TEXT,
  cost_validated BOOLEAN DEFAULT false,
  cost_validated_at TIMESTAMPTZ,
  cost_validated_by UUID REFERENCES users(id),

  -- ─── Stage 4: Production Test ───
  test_date DATE,
  test_quantity DECIMAL(10,2),
  test_yield DECIMAL(10,2),
  test_observations TEXT,
  recipe_revised BOOLEAN DEFAULT false,
  test_validated BOOLEAN DEFAULT false,
  test_validated_at TIMESTAMPTZ,
  test_validated_by UUID REFERENCES users(id),

  -- ─── Stage 5: Tasting & Evaluation ───
  tasting_date DATE,
  tasting_scores JSONB DEFAULT '{}',
  -- scores: { visual: 1-10, taste: 1-10, texture: 1-10, originality: 1-10, overall: 1-10, panelists: [...] }
  tasting_comments TEXT,
  tasting_validated BOOLEAN DEFAULT false,
  tasting_validated_at TIMESTAMPTZ,
  tasting_validated_by UUID REFERENCES users(id),

  -- ─── Stage 6: Admin Validation ───
  admin_decision pipeline_decision,
  admin_comments TEXT,
  admin_decided_at TIMESTAMPTZ,
  admin_decided_by UUID REFERENCES users(id),

  -- ─── Stage 7: Catalog Integration ───
  product_id UUID REFERENCES products(id),
  integrated_at TIMESTAMPTZ,

  -- ─── Metadata ───
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ Pipeline history / audit trail ═══
CREATE TABLE IF NOT EXISTS product_pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES product_pipeline(id) ON DELETE CASCADE,
  from_stage pipeline_stage,
  to_stage pipeline_stage,
  action VARCHAR(100) NOT NULL,
  details JSONB DEFAULT '{}',
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_status ON product_pipeline(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON product_pipeline(current_stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_responsible ON product_pipeline(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_created_by ON product_pipeline(created_by);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_pipeline ON product_pipeline_history(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_date ON product_pipeline_history(created_at);
