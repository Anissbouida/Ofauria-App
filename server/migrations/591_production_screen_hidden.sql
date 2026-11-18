-- ═══════════════════════════════════════════════════════════════════════
-- 591 — Écrans de fabrication : éléments masqués (M8-01, suite)
--
--   Le registre des panneaux (planPanelRules.ts) et des étapes de lancement (launchStepRules.ts)
--   décide de l'affichage selon l'état de l'ordre, le type d'ordre, les options et les réglages.
--   Cette table permet en plus de MASQUER un élément, pour toute la société (order_type_id NULL)
--   ou pour un type d'ordre. Une ligne = un élément masqué. Seuls les éléments masquables du
--   catalogue shared/constants/production-screens.ts sont acceptés (contrôle serveur).
--   Aucune ligne à la livraison : les écrans restent identiques.
--
-- INVERSION
--   DROP TABLE production_screen_hidden.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS production_screen_hidden (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type_id  uuid REFERENCES production_order_types(id) ON DELETE CASCADE,
  element_key    varchar(40) NOT NULL,
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_screen_hidden
  ON production_screen_hidden (COALESCE(order_type_id, '00000000-0000-0000-0000-000000000000'::uuid), element_key);
COMMENT ON TABLE production_screen_hidden IS 'Éléments des écrans de fabrication masqués, pour la société ou un type d''ordre (mig 591).';
