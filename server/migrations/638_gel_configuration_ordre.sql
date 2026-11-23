-- 638 — Configuration figée sur l'ordre et versions complètes (plan d'exécution
--       multi-industries, étape 4).
--
-- POURQUOI
--   Les drapeaux du type d'ordre (bon de sortie, pesée, contrôle, mode de consommation,
--   sous-traitance) et les politiques étaient relus EN DIRECT pendant l'exécution : un
--   réglage changé en cours de journée s'appliquait aux ordres déjà confirmés. Une version
--   de configuration ne contenait que le secteur, les modules, les options et les politiques.
--
-- CE QUI CHANGE
--   - production_plans.exec_snapshot : réglages d'exécution figés à la confirmation
--     ({ order_type: {...}, policies: {...} }) ; production_plans.config_version_id : version
--     de configuration en vigueur à ce moment. L'exécution lit l'instantané, avec repli sur
--     la valeur vivante pour un ordre plus ancien.
--   - Reprise : les ordres ouverts (confirmés, en attente, prêts, en cours) reçoivent un
--     instantané des valeurs du jour de la migration.
--   - config_versions.status (publiee | brouillon) et published_at : une version porte son
--     état ; les versions existantes sont publiées.

ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS exec_snapshot JSONB;
ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS config_version_id INTEGER;

ALTER TABLE config_versions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'publiee';
ALTER TABLE config_versions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE config_versions SET published_at = created_at WHERE published_at IS NULL AND status = 'publiee';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_config_versions_status') THEN
    ALTER TABLE config_versions ADD CONSTRAINT chk_config_versions_status CHECK (status IN ('publiee', 'brouillon'));
  END IF;
END $$;

-- Reprise des ordres ouverts : réglages du type d'ordre et politiques de la société à ce jour.
UPDATE production_plans pp
   SET exec_snapshot = jsonb_build_object(
         'order_type', jsonb_build_object(
           'code', t.code,
           'requires_bon_sortie', t.requires_bon_sortie,
           'requires_weighing', t.requires_weighing,
           'requires_quality_check', t.requires_quality_check,
           'consumption_mode', t.consumption_mode,
           'is_subcontracting', COALESCE(t.is_subcontracting, false)),
         'policies', COALESCE((SELECT jsonb_object_agg(v.key, v.value) FROM policy_values v
                                WHERE v.scope_type = 'company'
                                  AND v.key IN ('production.enforce_declared_steps', 'production.steps_source',
                                                'production.cost_allocation_key', 'quality.auto_release')), '{}'::jsonb),
         'frozen_by', 'reprise_mig_638'),
       config_version_id = (SELECT max(id) FROM config_versions)
  FROM production_order_types t
 WHERE t.id = COALESCE(pp.order_type_id, (SELECT id FROM production_order_types WHERE is_default LIMIT 1))
   AND pp.status IN ('confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress')
   AND pp.exec_snapshot IS NULL;
