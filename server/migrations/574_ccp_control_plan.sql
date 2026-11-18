-- M7-03 — Le CCP comme cas particulier du plan de contrôle.
-- Un point critique est une ligne du plan de contrôle à l'étape « en cours », rattachée à
-- un type d'étape (step_type_code) plutôt qu'à un article, de type mesure, BLOQUANTE ; ses
-- bornes sont la consigne ± la tolérance saisies au relevé de procédé (mig 422), d'où
-- l'absence de min / max sur la ligne. Les CCP actuels (types d'étape metadata.ccp) y sont
-- déclarés ; les relevés existants ne sont pas migrés ; la garde de clôture reste la même.
-- Les contraintes recréées ici datent de la mig 573 (même lot, jamais déployée).

ALTER TABLE quality_control_plan_lines
  ADD COLUMN IF NOT EXISTS step_type_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS reading_param VARCHAR(40);

ALTER TABLE quality_control_plan_lines DROP CONSTRAINT IF EXISTS chk_qcp_target;
ALTER TABLE quality_control_plan_lines ADD CONSTRAINT chk_qcp_target CHECK (
  (stage = 'reception' AND (ingredient_id IS NOT NULL OR ingredient_category_id IS NOT NULL))
  OR (stage <> 'reception' AND (product_id IS NOT NULL OR product_category_id IS NOT NULL))
  OR (stage = 'en_cours' AND step_type_code IS NOT NULL));
ALTER TABLE quality_control_plan_lines DROP CONSTRAINT IF EXISTS chk_qcp_measure;
ALTER TABLE quality_control_plan_lines ADD CONSTRAINT chk_qcp_measure CHECK (
  char_type <> 'mesure' OR min_value IS NOT NULL OR max_value IS NOT NULL OR step_type_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_qcp_step_type ON quality_control_plan_lines (step_type_code) WHERE is_active AND step_type_code IS NOT NULL;

INSERT INTO quality_control_plan_lines (stage, step_type_code, reading_param, characteristic, char_type, frequency, is_blocking)
SELECT 'en_cours', e.code, e.metadata->>'default_param',
       'CCP — ' || e.label || COALESCE(' (' || p.label || ')', ''), 'mesure', 'chaque_lot', true
  FROM ref_entries e
  LEFT JOIN ref_entries p ON p.table_id = 'process_reading_params' AND p.code = e.metadata->>'default_param'
 WHERE e.table_id = 'production_step_types' AND (e.metadata->>'ccp')::boolean IS TRUE
   AND NOT EXISTS (SELECT 1 FROM quality_control_plan_lines l WHERE l.step_type_code = e.code AND l.is_active);
