-- 395 — Tableaux de bord configurables (lot 2 des rapports configurables)
--
-- Un tableau de bord regroupe plusieurs tuiles. Chaque tuile est un rapport
-- (source + config déclarative, cf. mig 394) avec un type de visualisation
-- (table / barres / courbe / indicateur). Comme pour les rapports, `tiles` ne
-- contient que des définitions déclaratives (clés validées, valeurs de filtre),
-- jamais de SQL. L'exécution réutilise le moteur whitelisté de mig 394.
--
-- INVERSION : DROP TABLE report_dashboards;

CREATE TABLE IF NOT EXISTS report_dashboards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  tiles       JSONB NOT NULL DEFAULT '[]'::jsonb,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_dashboards_store ON report_dashboards (store_id, name);
COMMENT ON TABLE report_dashboards IS 'Tableaux de bord configurables (mig 395) : tuiles déclaratives réutilisant le moteur de rapports mig 394.';
