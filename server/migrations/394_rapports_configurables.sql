-- 394 — Rapports configurables (générateur de rapports / tableaux de bord)
--
-- POURQUOI
--   Le gérant ne pouvait pas construire ses propres analyses : chaque rapport était
--   codé en dur. On ajoute un générateur où il choisit une source de données, des
--   dimensions, des indicateurs et des filtres, puis enregistre le rapport.
--
-- SÉCURITÉ
--   Aucune requête SQL libre n'est stockée. `config` ne contient que des CLÉS
--   (dimensions/indicateurs/filtres) validées côté serveur contre un registre de
--   sources déclarées, et des VALEURS de filtre (paramétrées à l'exécution). La
--   table ne garde qu'une définition déclarative, jamais de SQL.
--
-- INVERSION : DROP TABLE report_definitions;

CREATE TABLE IF NOT EXISTS report_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  source_key  VARCHAR(40) NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_definitions_store ON report_definitions (store_id, name);
COMMENT ON TABLE report_definitions IS 'Rapports configurables (mig 394) : définition déclarative (source + clés + filtres), jamais de SQL libre.';
