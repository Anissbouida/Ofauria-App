-- 723 — Déboursé d'un chantier ou d'un projet (feuille de route, étape 6.1).
--
-- Le budget global (projects.budget_amount) ne dit pas où part l'argent. Le déboursé détaille
-- le budget par nature (matériaux, main-d'œuvre, engins, sous-traitance, autres), avec un
-- libellé libre (ouvrage, lot). Il est comparé au réalisé : main-d'œuvre = temps saisis ;
-- autres natures = achats (factures reçues rattachées, commandes engagées). Quand un déboursé
-- existe, son total devient le budget du projet.
CREATE TABLE IF NOT EXISTS project_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nature VARCHAR(20) NOT NULL CHECK (nature IN ('materiaux', 'main_oeuvre', 'engins', 'sous_traitance', 'autres')),
  label VARCHAR(200),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  line_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_budget_lines_project ON project_budget_lines(project_id, line_order);
