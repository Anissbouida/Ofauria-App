-- ═══════════════════════════════════════════════════════════════════════
-- 582 — Gabarits d'impression du module de fabrication (M8-04)
--
--   Les impressions du module (ticket de lot, bon de sortie, fiche de production,
--   fiche technique) avaient leur titre, leurs colonnes et leurs mentions en dur
--   dans le code. Elles deviennent des modèles de document_templates (mig 332) :
--     - document_templates.category  : 'tiers' (pièces envoyées aux tiers, mig 332)
--       ou 'production' (impressions internes du module) ;
--     - document_templates.title     : titre imprimé (NULL = titre par défaut du code) ;
--     - document_templates.layout    : {"columns": [...], "signatures": [...]} choisis
--       dans le catalogue figé shared/constants/print-templates.ts ;
--     - document_template_variants   : réglage propre à un type d'ordre de fabrication
--       (mig 546), qui remplace le modèle général champ par champ (NULL = hérité).
--   Sans réglage, l'impression reste identique à l'historique.
--
-- INVERSION
--   DROP TABLE document_template_variants ;
--   DELETE FROM document_templates WHERE category = 'production' ;
--   ALTER TABLE document_templates DROP COLUMN category, DROP COLUMN title, DROP COLUMN layout.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'tiers',
  ADD COLUMN IF NOT EXISTS title    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS layout   JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE document_templates ADD CONSTRAINT chk_document_templates_category CHECK (category IN ('tiers', 'production'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE document_templates ADD CONSTRAINT chk_document_templates_layout CHECK (jsonb_typeof(layout) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN document_templates.category IS 'tiers = pièce envoyée aux tiers (mig 332) ; production = impression interne du module de fabrication (mig 582).';
COMMENT ON COLUMN document_templates.title IS 'Titre imprimé ; NULL = titre par défaut du code (mig 582).';
COMMENT ON COLUMN document_templates.layout IS 'Colonnes et signatures affichées, choisies dans le catalogue print-templates (mig 582).';

-- Modèles généraux : aucun réglage, l'impression reprend les valeurs par défaut du code.
INSERT INTO document_templates (doc_type, label, category, show_bank, show_legal_form, display_order) VALUES
  ('production_ticket',     'Ticket de lot',       'production', false, false, 110),
  ('production_bon_sortie', 'Bon de sortie',       'production', false, false, 120),
  ('production_fiche',      'Fiche de production', 'production', false, false, 130),
  ('recipe_fiche',          'Fiche technique',     'production', false, false, 140)
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS document_template_variants (
  doc_type       VARCHAR(30) NOT NULL REFERENCES document_templates(doc_type) ON DELETE CASCADE,
  order_type_id  UUID NOT NULL REFERENCES production_order_types(id) ON DELETE CASCADE,
  title          VARCHAR(120),
  layout         JSONB NOT NULL DEFAULT '{}'::jsonb,
  footer_note    TEXT,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, order_type_id),
  CHECK (jsonb_typeof(layout) = 'object'),
  CHECK (char_length(COALESCE(footer_note, '')) <= 300)
);
COMMENT ON TABLE document_template_variants IS 'Gabarit d''impression propre à un type d''ordre de fabrication ; NULL / clé absente = hérité du modèle général (mig 582).';
