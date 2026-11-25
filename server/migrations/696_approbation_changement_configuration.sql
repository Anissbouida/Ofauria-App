-- Lot 15 (assistant multisectoriel) : un changement de configuration sensible (modules ou
-- capacités retirés, secteur changé) passe par le moteur d'approbation avant d'être activé.

-- Jeu de changements en attente d'approbation.
ALTER TABLE config_change_sets DROP CONSTRAINT IF EXISTS config_change_sets_status_check;
ALTER TABLE config_change_sets ADD CONSTRAINT config_change_sets_status_check
  CHECK (status IN ('compiled','blocked','simulated_partial','simulated','pending_approval','applied','obsolete'));

-- Règle livrée : approbation par un administrateur. Comme pour les autres pièces, la
-- demande d'un administrateur vaut approbation sauf en séparation des tâches stricte
-- (purchasing.sod_mode = block) ; celle d'un gérant attend un administrateur.
INSERT INTO approval_rules (code, label, doc_type, condition, mode, escalate_after_hours, display_order)
SELECT 'config_change_sensitive', 'Changement de configuration sensible', 'config_change',
  '{"any": [{"op": "gt", "field": "modules_removed", "value": 0}, {"op": "gt", "field": "capabilities_removed", "value": 0}, {"op": "eq", "field": "sector_change", "value": "yes"}]}'::jsonb,
  'serial', 48, 70
WHERE NOT EXISTS (SELECT 1 FROM approval_rules WHERE code = 'config_change_sensitive');

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r
WHERE r.code = 'config_change_sensitive'
  AND NOT EXISTS (SELECT 1 FROM approval_rule_steps s WHERE s.rule_id = r.id);
