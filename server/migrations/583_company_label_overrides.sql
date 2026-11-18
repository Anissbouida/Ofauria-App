-- ═══════════════════════════════════════════════════════════════════════
-- 583 — Vocabulaire propre à la société (M8-03)
--
--   Les termes métier viennent du secteur (sector_labels, mig 514/580, hérités du
--   secteur de base). La société peut maintenant en renommer un sans toucher au
--   préréglage du secteur : company_label_overrides est appliquée en dernier.
--   Revenir au terme du secteur = supprimer la ligne. Clés limitées au catalogue
--   shared/constants/vocabulary.ts (contrôlé par le serveur).
--
-- INVERSION
--   DROP TABLE company_label_overrides.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS company_label_overrides (
  label_key    VARCHAR(60) PRIMARY KEY,
  label_value  VARCHAR(80) NOT NULL CHECK (char_length(btrim(label_value)) > 0),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE company_label_overrides IS 'Termes renommés par la société, appliqués après ceux du secteur (mig 583).';
