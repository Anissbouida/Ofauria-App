-- 381 — Clôture de stock par période
--
-- Fige la VALORISATION du stock matière à une date (fin de mois) : un instantané
-- immuable des quantités restantes × coût unitaire, par article. Sert de valeur de
-- stock pour le bilan / le calcul de la variation de stocks, et de référence
-- historique (ERPNext « Stock Closing », SAP « clôture de période de stock »).
--
-- Choix v1 : l'instantané fige l'état COURANT au moment de la clôture (on clôture
-- en fin de période). Pas de reconstitution rétroactive (qui demanderait de rejouer
-- les mouvements), et pas de verrou des mouvements : c'est une photo de valeur, pas
-- un blocage comptable. Aucune écriture au grand livre à ce stade.
--
-- Rollback : DROP TABLE stock_closing_lines, stock_closings ;

CREATE TABLE IF NOT EXISTS stock_closings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label  VARCHAR(40) NOT NULL,              -- ex. « Octobre 2026 »
  closing_date  DATE NOT NULL,
  store_id      UUID REFERENCES stores(id),
  total_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
  lines_count   INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(10) NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
  notes         TEXT,
  closed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_closings_date ON stock_closings (closing_date DESC);

CREATE TABLE IF NOT EXISTS stock_closing_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id       UUID NOT NULL REFERENCES stock_closings(id) ON DELETE CASCADE,
  ingredient_id    UUID REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name  VARCHAR(200) NOT NULL,
  unit             VARCHAR(20),
  quantity         NUMERIC(14,4) NOT NULL,
  unit_cost        NUMERIC(12,4) NOT NULL,
  value            NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_closing_lines_closing ON stock_closing_lines (closing_id);
