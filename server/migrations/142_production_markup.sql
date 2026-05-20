-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 142 : majoration parametrable des quantites suggerees d'appro
--
-- La suggestion d'approvisionnement (getRecommendations) applique une
-- majoration sur la quantite de reference (ventes J-7 / J-14) pour absorber
-- les aleas de demande. Ce taux etait code en dur (+10%) cote client ; il
-- devient parametrable :
--   - un taux global par defaut (company_settings.production_markup_percent) ;
--   - un override optionnel par categorie (category_production_markup) ;
--   - chaque modification est tracee (production_markup_history).
-- suggested_quantity sur les lignes d'appro trace l'ecart entre la quantite
-- suggeree par le systeme et la quantite finalement demandee (ajustement
-- manuel du caissier).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS production_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 5;

-- Override de majoration par categorie de produit (prime sur le taux global).
CREATE TABLE IF NOT EXISTS category_production_markup (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  markup_percent DECIMAL(5,2) NOT NULL CHECK (markup_percent >= 0 AND markup_percent <= 100),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Historique des modifications de majoration (global + par categorie).
CREATE TABLE IF NOT EXISTS production_markup_history (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('global', 'category')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  old_percent DECIMAL(5,2),
  new_percent DECIMAL(5,2),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markup_history_changed_at ON production_markup_history(changed_at DESC);

-- Quantite suggeree par le systeme au moment de la demande d'appro.
-- L'ecart avec requested_quantity = ajustement manuel du caissier.
ALTER TABLE replenishment_request_items
  ADD COLUMN IF NOT EXISTS suggested_quantity INTEGER;
