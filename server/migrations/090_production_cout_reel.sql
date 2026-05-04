-- Migration 090: Production cost tracking (coût réel)
-- Phase 5: Real cost calculation per production plan/item
-- ADDITIVE ONLY — no existing tables or columns are modified

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Taux horaire sur employés (dérivé du salaire mensuel)
-- ══════════════════════════════════════════════════════════════════════════════
-- hourly_rate = monthly_salary / 191 (norme Maroc: 44h/sem × 52/12)
-- Can be overridden manually per employee.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(8,2);

-- Backfill from monthly_salary (191h/mois norme marocaine)
UPDATE employees SET hourly_rate = ROUND(monthly_salary / 191, 2)
  WHERE monthly_salary IS NOT NULL AND monthly_salary > 0 AND hourly_rate IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Référentiel équipements de production
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS production_equipements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('four', 'batteur', 'petrin', 'laminoir', 'surgele', 'frigo', 'autre')),
  cout_horaire DECIMAL(8,2) NOT NULL DEFAULT 0,  -- Cost per hour of use (energy + depreciation)
  puissance_kw DECIMAL(6,2),                      -- Power consumption in kW (for energy calc)
  cout_kwh DECIMAL(6,4) DEFAULT 1.50,             -- Cost per kWh (default Maroc tarif)
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipements_type ON production_equipements(type);
CREATE INDEX IF NOT EXISTS idx_equipements_store ON production_equipements(store_id);

-- Seed typical bakery equipment
INSERT INTO production_equipements (nom, type, cout_horaire, puissance_kw, notes) VALUES
  ('Four patisserie 1', 'four', 15.00, 10.0, 'Four electrique principal'),
  ('Four boulangerie 1', 'four', 12.00, 8.0, 'Four a sole boulangerie'),
  ('Batteur planetaire', 'batteur', 3.00, 1.5, 'Batteur 60L'),
  ('Petrin spirale', 'petrin', 4.00, 2.2, 'Petrin 80L'),
  ('Laminoir', 'laminoir', 2.00, 1.0, 'Laminoir pate feuilletee'),
  ('Cellule de surgelation', 'surgele', 8.00, 5.0, 'Cellule blast chiller'),
  ('Frigo positif production', 'frigo', 1.50, 0.8, 'Frigo repos/stockage')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Coût réel de production par plan
-- ══════════════════════════════════════════════════════════════════════════════
-- One row per production plan. Aggregates all cost components.

CREATE TABLE IF NOT EXISTS production_cout_reel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL UNIQUE REFERENCES production_plans(id) ON DELETE CASCADE,

  -- 4 composantes de coût
  cout_matieres DECIMAL(12,2) NOT NULL DEFAULT 0,       -- Ingredient costs (from lots consumed)
  cout_main_oeuvre DECIMAL(12,2) NOT NULL DEFAULT 0,     -- Labor cost (time × hourly_rate)
  cout_energie DECIMAL(12,2) NOT NULL DEFAULT 0,         -- Equipment/energy cost
  cout_pertes DECIMAL(12,2) NOT NULL DEFAULT 0,          -- Cost of losses/waste

  -- Totaux
  cout_total DECIMAL(12,2) GENERATED ALWAYS AS (cout_matieres + cout_main_oeuvre + cout_energie + cout_pertes) STORED,
  cout_prevu DECIMAL(12,2),                              -- Planned cost (from recipe total_cost × qty)
  ecart_pct DECIMAL(5,2),                                -- Variance % ((reel - prevu) / prevu * 100)

  -- Détails
  detail_matieres JSONB NOT NULL DEFAULT '[]',           -- [{ingredient_id, name, qty, unit_cost, total}]
  detail_main_oeuvre JSONB NOT NULL DEFAULT '[]',         -- [{employee_id, name, minutes, hourly_rate, total}]
  detail_energie JSONB NOT NULL DEFAULT '[]',             -- [{equipement_id, name, minutes, cout_horaire, total}]
  detail_pertes JSONB NOT NULL DEFAULT '[]',              -- [{categorie, quantite, cout_unitaire, total}]

  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  calculated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cout_reel_plan ON production_cout_reel(plan_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Temps de travail par item (pour calcul MO)
-- ══════════════════════════════════════════════════════════════════════════════
-- Tracks which employee worked on which item and for how long.
-- Can be auto-populated from étapes (started_at → completed_at) or manual.

CREATE TABLE IF NOT EXISTS production_temps_travail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id UUID REFERENCES production_plan_items(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  debut TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ,
  duree_minutes INT,                                     -- Computed or manual
  hourly_rate_snapshot DECIMAL(8,2),                      -- Rate at time of work
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temps_travail_plan ON production_temps_travail(plan_id);
CREATE INDEX IF NOT EXISTS idx_temps_travail_employee ON production_temps_travail(employee_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Utilisation équipements par plan (pour calcul énergie)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS production_equipement_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  equipement_id UUID NOT NULL REFERENCES production_equipements(id),
  debut TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ,
  duree_minutes INT,
  cout_horaire_snapshot DECIMAL(8,2),                    -- Rate at time of use
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equip_usage_plan ON production_equipement_usage(plan_id);
CREATE INDEX IF NOT EXISTS idx_equip_usage_equip ON production_equipement_usage(equipement_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Feature flag
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS production_cost_enabled BOOLEAN DEFAULT false;
