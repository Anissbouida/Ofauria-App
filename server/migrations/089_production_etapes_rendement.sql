-- Migration 089: Production steps tracking (étapes) + yield tracking (rendement)
-- Phase 4: Extends the production system with runtime step execution and yield measurement
-- ADDITIVE ONLY — no existing tables or columns are modified

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Suivi des étapes de production par item (runtime execution)
-- ══════════════════════════════════════════════════════════════════════════════
-- Each row = one step instance for one plan item (copied from contenant.etapes_defaut
-- or produit_profil_production.etapes_surcharges at startItems() time).
-- The chef ticks steps as they go; blocking steps prevent produceItems() unless
-- the feature flag production_steps_blocking is enabled.

CREATE TABLE IF NOT EXISTS production_item_etapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id UUID NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  ordre SMALLINT NOT NULL,
  nom VARCHAR(200) NOT NULL,
  duree_estimee_min INT,
  est_bloquante BOOLEAN NOT NULL DEFAULT true,
  timer_auto BOOLEAN NOT NULL DEFAULT false,
  controle_qualite BOOLEAN NOT NULL DEFAULT false,
  checklist_items JSONB NOT NULL DEFAULT '[]',
  est_repetable BOOLEAN NOT NULL DEFAULT false,
  nb_repetitions_cible SMALLINT NOT NULL DEFAULT 1,
  nb_repetitions_actuelle SMALLINT NOT NULL DEFAULT 0,
  responsable_role VARCHAR(50),

  -- Runtime state
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  started_by UUID REFERENCES users(id),
  completed_by UUID REFERENCES users(id),
  timer_fire_at TIMESTAMPTZ,           -- When auto-timer should notify
  duree_reelle_min INT,                -- Actual duration (computed or manual)
  checklist_resultats JSONB DEFAULT '[]', -- QC results per checklist item
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_etapes_plan_item ON production_item_etapes(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_item_etapes_status ON production_item_etapes(status) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_item_etapes_timer ON production_item_etapes(timer_fire_at) WHERE timer_fire_at IS NOT NULL AND status = 'in_progress';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Suivi du rendement par item (yield tracking)
-- ══════════════════════════════════════════════════════════════════════════════
-- One row per plan item, created at produceItems() time.
-- Tracks actual yield vs. target, surplus to fridge, losses by category.

CREATE TABLE IF NOT EXISTS production_rendement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id UUID NOT NULL UNIQUE REFERENCES production_plan_items(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,

  -- Target (from contenant/profil)
  quantite_brute DECIMAL(10,2),              -- Gross qty produced (before losses)
  quantite_nette_cible DECIMAL(10,2),        -- Expected net yield
  seuil_rendement DECIMAL(5,2),              -- Target yield % (e.g. 90)

  -- Actual
  quantite_nette_reelle DECIMAL(10,2),       -- Actual net yield (= pieces vendables)
  rendement_reel DECIMAL(5,2),               -- Actual yield % (quantite_nette_reelle / quantite_brute * 100)
  vers_magasin INT NOT NULL DEFAULT 0,       -- Pieces sent to shop floor
  vers_frigo INT NOT NULL DEFAULT 0,         -- Pieces/qty sent to fridge (surplus)

  -- Losses breakdown
  pertes_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  pertes_detail JSONB NOT NULL DEFAULT '[]', -- [{categorie: "pertes_cuisson", quantite: 3, notes: "..."}]

  -- Metadata
  recorded_by UUID REFERENCES users(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rendement_plan ON production_rendement(plan_id);
CREATE INDEX IF NOT EXISTS idx_rendement_plan_item ON production_rendement(plan_item_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Feature flags
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS production_steps_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_steps_blocking BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_yield_enabled BOOLEAN DEFAULT false;
