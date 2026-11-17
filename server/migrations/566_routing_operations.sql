-- M5-01 — Opérations de gamme complètes.
-- Les gammes (mig 388) n'avaient qu'une durée par opération. Une opération porte
-- désormais : type (réglage, exécution, attente, contrôle), temps de réglage, temps
-- unitaires machine et main-d'œuvre pour une quantité de base, point de contrôle,
-- caractère bloquant, et les champs repris des étapes JSON (température, libellé arabe).
-- Temps prévu d'une opération pour Q unités :
--   main-d'œuvre = réglage + durée fixe + Q / quantité de base × temps unitaire MO
--   machine      = réglage + Q / quantité de base × temps unitaire machine
-- La gamme se rattache à une fiche technique (recipe_id) : c'est la gamme de la
-- nomenclature, en plus du rattachement historique au produit.

ALTER TABLE routing_operations
  ADD COLUMN IF NOT EXISTS op_type VARCHAR(12) NOT NULL DEFAULT 'execution',
  ADD COLUMN IF NOT EXISTS setup_min NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (setup_min >= 0),
  ADD COLUMN IF NOT EXISTS machine_min_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (machine_min_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS labor_min_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (labor_min_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS base_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (base_quantity > 0),
  ADD COLUMN IF NOT EXISTS control_point TEXT,
  ADD COLUMN IF NOT EXISTS is_blocking BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS operation_name_ar VARCHAR(160),
  ADD COLUMN IF NOT EXISTS instructions TEXT;
DO $$ BEGIN
  ALTER TABLE routing_operations ADD CONSTRAINT chk_routing_op_type CHECK (op_type IN ('reglage', 'execution', 'attente', 'controle'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE routings ADD COLUMN IF NOT EXISTS recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_routings_active_recipe ON routings (recipe_id) WHERE recipe_id IS NOT NULL AND is_active;

-- Temps prévus d'une opération pour une quantité (minutes).
CREATE OR REPLACE FUNCTION fn_routing_op_minutes(p_op_id UUID, p_qty NUMERIC)
RETURNS TABLE (labor_min NUMERIC, machine_min NUMERIC) LANGUAGE sql STABLE AS $$
  SELECT ROUND(o.setup_min + o.duration_min + COALESCE(p_qty, 0) / o.base_quantity * o.labor_min_per_unit, 2),
         ROUND(o.setup_min + COALESCE(p_qty, 0) / o.base_quantity * o.machine_min_per_unit, 2)
    FROM routing_operations o WHERE o.id = p_op_id
$$;
