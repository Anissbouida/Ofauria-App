-- 362 — Achats : évaluation des fournisseurs (note calculée)
--
-- La note d'un fournisseur se calcule à la demande sur une période, à partir de ce
-- que la base sait déjà : délais tenus (réception vs date attendue du BC),
-- livraisons complètes, conformité des contrôles à réception, stabilité des prix
-- (prix reçu vs prix du BC), litiges sur factures. Les poids sont un paramètre
-- métier (purchasing.supplier_score). Un instantané fige la note d'une période
-- pour suivre l'évolution et motiver une décision (référencement, déréférencement).
--
-- Rollback :
--   DROP TABLE supplier_score_snapshots ;
--   DELETE FROM module_parameters WHERE key = 'purchasing.supplier_score'.

CREATE TABLE IF NOT EXISTS supplier_score_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  score         NUMERIC(5,1),
  standing      VARCHAR(4) NOT NULL CHECK (standing IN ('A', 'B', 'C', 'D', 'new')),
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights       JSONB NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  computed_by   UUID REFERENCES users(id),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from),
  UNIQUE (supplier_id, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS idx_supplier_score_snapshots ON supplier_score_snapshots (supplier_id, period_to DESC);
COMMENT ON TABLE supplier_score_snapshots IS 'Évaluation fournisseurs (mig 362) : note figée par période, avec ses métriques et les poids du moment.';

INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.supplier_score',
   '{"on_time": 30, "fill_rate": 20, "quality": 20, "price": 20, "disputes": 10, "min_orders": 3, "months": 12, "a_min": 85, "b_min": 70, "c_min": 50}'::jsonb,
   'Évaluation fournisseurs : poids des critères (délais, livraisons complètes, conformité, prix, litiges), nombre de BC minimal pour noter, période glissante en mois, seuils A/B/C.')
ON CONFLICT (key) DO NOTHING;
