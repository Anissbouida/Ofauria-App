-- M7-02 — Plan de contrôle par article.
-- Une ligne de plan : article (ou famille d'articles) pour les étapes « en cours » et
-- « final », matière (ou famille de matières) pour l'étape « réception » ; une
-- caractéristique (mesure avec bornes, oui / non, visuel) ; une fréquence (chaque lot,
-- 1 lot sur N, par quantité de N unités) ; une taille d'échantillon ; bloquante ou non
-- (le CCP en devient un cas particulier, M7-03).
-- Les inspections à faire sont générées à la réception, à l'opération de contrôle et à la
-- déclaration de production (contrôle final), avec leurs points dans pending_items.

CREATE TABLE IF NOT EXISTS quality_control_plan_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  product_category_id INTEGER,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
  ingredient_category_id UUID,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('reception', 'en_cours', 'final')),
  characteristic VARCHAR(160) NOT NULL,
  char_type VARCHAR(10) NOT NULL DEFAULT 'oui_non' CHECK (char_type IN ('mesure', 'oui_non', 'visuel')),
  min_value NUMERIC(12,3),
  max_value NUMERIC(12,3),
  unit VARCHAR(16),
  frequency VARCHAR(14) NOT NULL DEFAULT 'chaque_lot' CHECK (frequency IN ('chaque_lot', 'un_sur_n', 'par_quantite')),
  frequency_n INTEGER CHECK (frequency_n IS NULL OR frequency_n > 0),
  sample_size INTEGER NOT NULL DEFAULT 1 CHECK (sample_size > 0),
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_qcp_target CHECK (
    (stage = 'reception' AND (ingredient_id IS NOT NULL OR ingredient_category_id IS NOT NULL))
    OR (stage <> 'reception' AND (product_id IS NOT NULL OR product_category_id IS NOT NULL))),
  CONSTRAINT chk_qcp_measure CHECK (char_type <> 'mesure' OR min_value IS NOT NULL OR max_value IS NOT NULL),
  CONSTRAINT chk_qcp_frequency CHECK (frequency = 'chaque_lot' OR frequency_n IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_qcp_product ON quality_control_plan_lines (product_id, stage) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_qcp_ingredient ON quality_control_plan_lines (ingredient_id, stage) WHERE is_active;

-- Compteur d'occurrences par ligne (fréquence « 1 lot sur N »).
CREATE TABLE IF NOT EXISTS quality_control_counters (
  line_id UUID PRIMARY KEY REFERENCES quality_control_plan_lines(id) ON DELETE CASCADE,
  seen INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE quality_inspections
  ADD COLUMN IF NOT EXISTS pending_items JSONB,
  ADD COLUMN IF NOT EXISTS control_stage VARCHAR(10);
