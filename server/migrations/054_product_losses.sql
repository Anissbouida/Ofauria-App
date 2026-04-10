-- Product losses: production failures, display breakage, expired items
CREATE TABLE IF NOT EXISTS product_losses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(10,2) NOT NULL CHECK (quantity > 0),

  -- Type: production (failed during making), vitrine (broken/damaged in display), perime (expired), recyclage (recycled)
  loss_type VARCHAR(20) NOT NULL CHECK (loss_type IN ('production', 'vitrine', 'perime', 'recyclage')),

  -- Reason for the loss
  reason VARCHAR(50) NOT NULL CHECK (reason IN (
    'brule', 'rate', 'machine', 'matiere_defectueuse', 'erreur_humaine',
    'chute', 'casse', 'qualite_non_conforme', 'retour_client',
    'perime', 'invendu_fin_journee',
    'recycle', 'autre'
  )),
  reason_note TEXT,

  -- Cost tracking
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Optional link to production plan
  production_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,

  -- Ingredients consumed (for production losses, the ingredients were used but product failed)
  ingredients_consumed BOOLEAN NOT NULL DEFAULT false,

  -- Audit
  declared_by UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_losses_product ON product_losses(product_id);
CREATE INDEX idx_product_losses_type ON product_losses(loss_type);
CREATE INDEX idx_product_losses_date ON product_losses(created_at);
CREATE INDEX idx_product_losses_store ON product_losses(store_id);
