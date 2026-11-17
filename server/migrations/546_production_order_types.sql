-- M2-01 / M2-02 / M2-03 (plan d'action 2026-11) — types d'ordre de fabrication,
-- en-tête d'ordre, contrainte sur les statuts de ligne.
--
-- 1. production_order_types : ce qui distingue un parcours d'un autre.
--      requires_bon_sortie    : la confirmation génère un bon de sortie et le démarrage
--                               exige qu'il soit clôturé (parcours actuel) ; à faux, l'ordre
--                               passe de « confirmé » à « en production » et les matières
--                               sont consommées à la déclaration (comme un plan sans BSI
--                               aujourd'hui) ;
--      requires_weighing      : la préparation du bon passe par le pesage (déclaratif ; le
--                               bon peut déjà aller de « généré » à « prélèvement ») ;
--      requires_quality_check : contrôle à la déclaration (déclaratif, lu par M4-M7) ;
--      consumption_mode       : au_bon_de_sortie | a_la_declaration | manuel ;
--      sequence_doc_type      : série de numérotation (document_sequences) ;
--      default_target_role    : atelier par défaut (même valeur que production_plans.target_role).
--    Type initial « PLAN_JOUR » (Plan du jour) = exactement le parcours actuel.
--
-- 2. production_plans : of_number (numéro d'ordre — pas « order_number », nom déjà renvoyé
--    par les requêtes de plans pour la commande client jointe), order_type_id, priority (1 = urgente … 5 = basse,
--    3 par défaut), planned_start, planned_end. Les trois chemins de création existants
--    sont couverts par un déclencheur BEFORE INSERT qui pose le type par défaut, le numéro
--    (série « production_order », OF-AAAA-NNNNN) et les dates. Aucun renommage de table.
--    Rattrapage : type « Plan du jour », numéro selon la date de création, dates = date du plan.
--
-- 3. CHECK sur production_plan_items.status : pending | in_progress | produced |
--    transferred | received | cancelled (seules valeurs écrites par le code).
--
-- INVERSION :
--   ALTER TABLE production_plan_items DROP CONSTRAINT chk_production_plan_items_status;
--   DROP TRIGGER trg_production_plan_order_defaults ON production_plans;
--   DROP FUNCTION trg_fn_production_plan_order_defaults();
--   ALTER TABLE production_plans DROP COLUMN of_number, DROP COLUMN order_type_id,
--     DROP COLUMN priority, DROP COLUMN planned_start, DROP COLUMN planned_end;
--   DELETE FROM document_sequence_counters WHERE doc_type = 'production_order';
--   DELETE FROM document_sequences WHERE doc_type = 'production_order';
--   DROP TABLE production_order_types;

CREATE TABLE IF NOT EXISTS production_order_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   varchar(30) NOT NULL UNIQUE,
  label                  varchar(80) NOT NULL,
  description            text,
  requires_bon_sortie    boolean NOT NULL DEFAULT true,
  requires_weighing      boolean NOT NULL DEFAULT true,
  requires_quality_check boolean NOT NULL DEFAULT false,
  consumption_mode       varchar(20) NOT NULL DEFAULT 'au_bon_de_sortie',
  sequence_doc_type      varchar(40) NOT NULL DEFAULT 'production_order',
  default_target_role    varchar(30),
  is_default             boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  display_order          smallint NOT NULL DEFAULT 0,
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pot_consumption CHECK (consumption_mode IN ('au_bon_de_sortie', 'a_la_declaration', 'manuel')),
  -- Sans bon de sortie, rien n'est consommé au bon : le mode doit le dire.
  CONSTRAINT chk_pot_consumption_coherent CHECK (requires_bon_sortie OR consumption_mode <> 'au_bon_de_sortie'),
  -- Le pesage est une étape de la préparation du bon.
  CONSTRAINT chk_pot_weighing_needs_bon CHECK (requires_bon_sortie OR NOT requires_weighing),
  -- Le type par défaut est actif.
  CONSTRAINT chk_pot_default_active CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_order_types_default ON production_order_types ((true)) WHERE is_default;

INSERT INTO production_order_types (code, label, description, requires_bon_sortie, requires_weighing, requires_quality_check, consumption_mode, is_default, display_order)
VALUES ('PLAN_JOUR', 'Plan du jour',
        'Parcours actuel : confirmation, bon de sortie préparé et pesé par le magasinier, démarrage après clôture du bon, consommation au bon.',
        true, true, false, 'au_bon_de_sortie', true, 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('production_order', 'Ordre de fabrication', 'production', 'OF-{YYYY}-{SEQ}', 5, 'year', 'production_plans', 'of_number', false, 95)
ON CONFLICT (doc_type) DO NOTHING;

ALTER TABLE production_plans
  ADD COLUMN IF NOT EXISTS of_number     varchar(40),
  ADD COLUMN IF NOT EXISTS order_type_id uuid REFERENCES production_order_types(id),
  ADD COLUMN IF NOT EXISTS priority      smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS planned_start timestamptz,
  ADD COLUMN IF NOT EXISTS planned_end   timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_plans_priority') THEN
    ALTER TABLE production_plans ADD CONSTRAINT chk_production_plans_priority CHECK (priority BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_plans_planned_window') THEN
    ALTER TABLE production_plans ADD CONSTRAINT chk_production_plans_planned_window
      CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start);
  END IF;
END $$;

-- Rattrapage des plans existants (le déclencheur n'existe pas encore).
UPDATE production_plans SET order_type_id = (SELECT id FROM production_order_types WHERE code = 'PLAN_JOUR')
 WHERE order_type_id IS NULL;
UPDATE production_plans
   SET planned_start = COALESCE(planned_start, (plan_date::timestamp AT TIME ZONE 'Africa/Casablanca')),
       planned_end   = COALESCE(planned_end, ((plan_date + 1)::timestamp AT TIME ZONE 'Africa/Casablanca') - interval '1 second')
 WHERE planned_start IS NULL OR planned_end IS NULL;
WITH numbered AS (
  SELECT id, to_char((created_at AT TIME ZONE 'Africa/Casablanca'), 'YYYY') AS y,
         ROW_NUMBER() OVER (PARTITION BY to_char((created_at AT TIME ZONE 'Africa/Casablanca'), 'YYYY') ORDER BY created_at, id) AS n
    FROM production_plans WHERE of_number IS NULL
)
UPDATE production_plans p SET of_number = 'OF-' || numbered.y || '-' || lpad(numbered.n::text, 5, '0')
  FROM numbered WHERE numbered.id = p.id;
INSERT INTO document_sequence_counters (doc_type, period_key, last_value)
SELECT 'production_order', split_part(of_number, '-', 2), MAX(split_part(of_number, '-', 3)::bigint)
  FROM production_plans WHERE of_number ~ '^OF-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT (doc_type, period_key) DO UPDATE SET last_value = GREATEST(document_sequence_counters.last_value, EXCLUDED.last_value);

ALTER TABLE production_plans ALTER COLUMN order_type_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_plans_of_number ON production_plans (of_number);
CREATE INDEX IF NOT EXISTS idx_production_plans_order_type ON production_plans (order_type_id);

CREATE OR REPLACE FUNCTION trg_fn_production_plan_order_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seq text;
BEGIN
  IF NEW.order_type_id IS NULL THEN
    SELECT id INTO NEW.order_type_id FROM production_order_types WHERE is_default LIMIT 1;
  END IF;
  IF NEW.of_number IS NULL THEN
    SELECT sequence_doc_type INTO v_seq FROM production_order_types WHERE id = NEW.order_type_id;
    NEW.of_number := next_document_number(COALESCE(v_seq, 'production_order'), NULL);
  END IF;
  IF NEW.planned_start IS NULL THEN
    NEW.planned_start := NEW.plan_date::timestamp AT TIME ZONE 'Africa/Casablanca';
  END IF;
  IF NEW.planned_end IS NULL THEN
    NEW.planned_end := GREATEST(NEW.planned_start, ((NEW.plan_date + 1)::timestamp AT TIME ZONE 'Africa/Casablanca') - interval '1 second');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_production_plan_order_defaults ON production_plans;
CREATE TRIGGER trg_production_plan_order_defaults
  BEFORE INSERT ON production_plans
  FOR EACH ROW EXECUTE FUNCTION trg_fn_production_plan_order_defaults();

-- Statuts de ligne : seules valeurs écrites par le code.
UPDATE production_plan_items SET status = 'pending' WHERE status IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_plan_items_status') THEN
    ALTER TABLE production_plan_items ADD CONSTRAINT chk_production_plan_items_status
      CHECK (status IN ('pending', 'in_progress', 'produced', 'transferred', 'received', 'cancelled'));
  END IF;
END $$;
