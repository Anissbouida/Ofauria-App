-- M5-02 — Opérations de gamme instanciées sur l'ordre.
-- Les opérations d'ordre réutilisent la couche d'exécution existante
-- (production_item_etapes, lue par l'Atelier : démarrer, pause, terminer, bloquante)
-- au lieu d'une table parallèle. Une étape issue d'une gamme porte l'opération
-- d'origine, ses temps prévus et les quantités déclarées (bonne / rebutée).
-- La gamme de la ligne est écrite à la confirmation (production_plan_items.routing_id,
-- colonne de la mig 396 jamais renseignée jusqu'ici).
-- Les opérations ne remplacent les étapes JSON que lorsque la politique
-- production.steps_source vaut « gamme » (M5-03) ; défaut « json » : aucun changement.

ALTER TABLE production_item_etapes
  ADD COLUMN IF NOT EXISTS routing_operation_id UUID REFERENCES routing_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS op_type VARCHAR(12),
  ADD COLUMN IF NOT EXISTS planned_setup_min NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS planned_labor_min NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS planned_machine_min NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS control_point TEXT,
  ADD COLUMN IF NOT EXISTS good_qty NUMERIC(12,3) CHECK (good_qty IS NULL OR good_qty >= 0),
  ADD COLUMN IF NOT EXISTS scrap_qty NUMERIC(12,3) CHECK (scrap_qty IS NULL OR scrap_qty >= 0),
  ADD COLUMN IF NOT EXISTS labor_logged BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_item_etapes_routing_op ON production_item_etapes (routing_operation_id) WHERE routing_operation_id IS NOT NULL;
