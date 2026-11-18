-- M5-01 (reste) — la gamme rattachée à la version de nomenclature.
--
-- Une gamme se modifie sur place (opérations éditées) : un simple lien ne figerait rien.
-- Chaque version de nomenclature garde donc la gamme en vigueur à sa création :
--   bom_versions.routing_id       : gamme de la fiche (sinon du produit), comme à la confirmation ;
--   bom_versions.routing_snapshot : ses opérations figées (ordre, temps, poste, contrôle…).
-- Une gamme modifiée depuis la version active compte comme une modification non activée de
-- la fiche ; à la confirmation, la ligne d'ordre prend la gamme de sa version et, au lancement,
-- les opérations sont copiées depuis l'instantané figé.
-- Reprise : les versions actives reçoivent la gamme actuelle ; les versions obsolètes restent
-- sans gamme (inconnue à l'époque).
-- trg_fn_bom_version_frozen (mig 559, pas encore en production) est redéfinie pour figer aussi
-- la gamme d'une version active ou obsolète — APRÈS la reprise.
--
-- INVERSION : ALTER TABLE bom_versions DROP COLUMN routing_snapshot, DROP COLUMN routing_id;
--   DROP FUNCTION fn_routing_content(jsonb), fn_routing_snapshot(uuid), fn_recipe_routing(uuid);
--   recréer trg_fn_bom_version_frozen de la mig 559.

ALTER TABLE bom_versions
  ADD COLUMN IF NOT EXISTS routing_id uuid REFERENCES routings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_snapshot jsonb;

-- Gamme d'une fiche : gamme active de la fiche, sinon gamme active du produit lié ; avec opérations.
CREATE FUNCTION fn_recipe_routing(p_recipe uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT ro.id FROM routings ro
   WHERE ro.is_active
     AND (ro.recipe_id = p_recipe
          OR (ro.recipe_id IS NULL AND ro.product_id IS NOT NULL AND ro.product_id = (SELECT r.product_id FROM recipes r WHERE r.id = p_recipe)))
     AND EXISTS (SELECT 1 FROM routing_operations o WHERE o.routing_id = ro.id)
   ORDER BY (ro.recipe_id IS NOT NULL) DESC, ro.created_at DESC
   LIMIT 1
$$;

-- Opérations d'une gamme, dans l'ordre (operation_id gardé pour la trace).
CREATE FUNCTION fn_routing_snapshot(p_routing uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_routing IS NULL THEN NULL ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'operation_id', o.id, 'sequence', o.sequence, 'operation_name', o.operation_name, 'operation_name_ar', o.operation_name_ar,
        'op_type', o.op_type, 'work_center_id', o.work_center_id, 'duration_min', o.duration_min, 'setup_min', o.setup_min,
        'machine_min_per_unit', o.machine_min_per_unit, 'labor_min_per_unit', o.labor_min_per_unit, 'base_quantity', o.base_quantity,
        'control_point', o.control_point, 'is_blocking', o.is_blocking, 'temperature_c', o.temperature_c, 'instructions', o.instructions)
      ORDER BY o.sequence, o.id)
      FROM routing_operations o WHERE o.routing_id = p_routing), '[]'::jsonb) END
$$;

-- Contenu comparable (sans identifiants d'opération) : recréer une opération identique n'est pas une modification.
CREATE FUNCTION fn_routing_content(p_snapshot jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_snapshot IS NULL THEN NULL ELSE COALESCE(
    (SELECT jsonb_agg(e - 'operation_id' ORDER BY ord) FROM jsonb_array_elements(p_snapshot) WITH ORDINALITY x(e, ord)), '[]'::jsonb) END
$$;

UPDATE bom_versions b
   SET routing_id = fn_recipe_routing(b.recipe_id),
       routing_snapshot = fn_routing_snapshot(fn_recipe_routing(b.recipe_id))
 WHERE b.status = 'active';

CREATE OR REPLACE FUNCTION trg_fn_bom_version_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('active', 'obsolete')
     AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.version_no <> OLD.version_no OR NEW.recipe_id <> OLD.recipe_id
          OR NEW.routing_snapshot IS DISTINCT FROM OLD.routing_snapshot
          OR (OLD.status = 'obsolete' AND NEW.status <> 'obsolete')) THEN
    RAISE EXCEPTION 'VERSION_FIGEE: la version % de la fiche est figée (statut %)', OLD.version_no, OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON COLUMN bom_versions.routing_snapshot IS 'M5-01 : opérations de la gamme figées avec la version (fn_routing_snapshot).';
