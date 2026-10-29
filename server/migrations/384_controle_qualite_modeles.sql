-- 384 — Modèles de contrôle qualité paramétrables + inspections
--
-- Capacité AUTONOME, à côté des contrôles figés existants (réception :
-- température/visuel/emballage ; production : checklist d'étape). On définit des
-- modèles d'inspection réutilisables (liste de points à vérifier, point conforme
-- ou mesure dans une plage), puis on enregistre des inspections qui reprennent le
-- modèle et calculent la conformité. (ERPNext « Quality Inspection Template ».)
--
-- items   (modèle)     : [{ "label": "...", "kind": "ok"|"measure", "unit": "°C",
--                           "min": 0, "max": 4 }]
-- results (inspection) : [{ "label": "...", "kind": "...", "ok": true,
--                           "value": 3.2, "note": "..." }]
--
-- Rollback : DROP TABLE quality_inspections, quality_templates ;

CREATE TABLE IF NOT EXISTS quality_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  applies_to  VARCHAR(16) NOT NULL DEFAULT 'general'
                CHECK (applies_to IN ('general', 'reception', 'production', 'product')),
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    UUID REFERENCES quality_templates(id) ON DELETE SET NULL,
  template_name  VARCHAR(160) NOT NULL,
  title          VARCHAR(200) NOT NULL,          -- ex. « Lot farine LI-260610-00639 »
  reference_note VARCHAR(200),
  inspected_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  results        JSONB NOT NULL DEFAULT '[]'::jsonb,
  conformity     BOOLEAN NOT NULL,
  notes          TEXT,
  store_id       UUID REFERENCES stores(id),
  inspected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_date ON quality_inspections (inspected_on DESC);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_conf ON quality_inspections (conformity);
