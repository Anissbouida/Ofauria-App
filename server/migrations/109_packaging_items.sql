-- Phase Emballages : modele dedie, separe des ingredients alimentaires.
-- Pas de lots, pas de DLC, pas de FEFO. Juste : nom, format, cout, stock, fournisseur.
-- Multi-store via packaging_store_stock comme product_store_stock.
-- Cost integre a recipe.total_cost via recipe_packaging.

-- ─── Table 1 : Catalogue emballages ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS packaging_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  format varchar(120),                         -- ex: '24cm rond', '37x57cm', 'rouleau 50m'
  unit varchar(20) NOT NULL DEFAULT 'piece',   -- piece, m, kg
  unit_cost numeric(10,4) NOT NULL DEFAULT 0,
  supplier varchar(200),
  category varchar(40) NOT NULL DEFAULT 'autre' -- boites / sachets / etiquettes / films / supports / autre
    CHECK (category IN ('boites','sachets','etiquettes','films','supports','rubans','caissettes','autre')),
  is_recyclable boolean DEFAULT false,
  is_compostable boolean DEFAULT false,
  is_food_safe boolean DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packaging_items_active
  ON packaging_items (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_packaging_items_category
  ON packaging_items (category);

-- ─── Table 2 : Stock par magasin ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packaging_store_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stock_quantity numeric(12,3) NOT NULL DEFAULT 0,
  stock_min_threshold numeric(12,3) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT NOW(),
  CONSTRAINT packaging_store_stock_unique UNIQUE (packaging_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_packaging_store_stock_low
  ON packaging_store_stock (packaging_id, store_id)
  WHERE stock_quantity <= stock_min_threshold;

-- ─── Table 3 : Mouvements de stock (journal simple, sans lots) ────────────
CREATE TABLE IF NOT EXISTS packaging_stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL
    CHECK (type IN ('reception','consumption','adjustment','waste','restock')),
  quantity_change numeric(12,3) NOT NULL,        -- +N pour reception, -N pour conso
  stock_after numeric(12,3) NOT NULL,            -- snapshot pour audit
  reference_id uuid,                              -- plan_id (si conso prod), purchase_order_id (si reception)
  reference_type varchar(30),                     -- 'production_plan' | 'purchase_order' | 'manual'
  unit_cost numeric(10,4),                        -- snapshot prix au moment du mouvement
  note text,
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packaging_tx_packaging ON packaging_stock_transactions (packaging_id);
CREATE INDEX IF NOT EXISTS idx_packaging_tx_store_date ON packaging_stock_transactions (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packaging_tx_ref ON packaging_stock_transactions (reference_id) WHERE reference_id IS NOT NULL;

-- ─── Table 4 : Liens recette ↔ emballage ──────────────────────────────────
CREATE TABLE IF NOT EXISTS recipe_packaging (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  packaging_id uuid NOT NULL REFERENCES packaging_items(id) ON DELETE RESTRICT,
  quantity numeric(12,4) NOT NULL,
  unit varchar(20),
  notes text,
  created_at timestamptz DEFAULT NOW(),
  CONSTRAINT recipe_packaging_unique UNIQUE (recipe_id, packaging_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_packaging_recipe ON recipe_packaging (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_packaging_packaging ON recipe_packaging (packaging_id);
