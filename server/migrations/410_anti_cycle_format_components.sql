-- 410 (L2) : anti-cycle au niveau base de données sur recipe_format_components.
--
-- Trou d'intégrité : recipe_format_components (la nomenclature par format, modèle
-- cible) n'avait AUCUNE protection anti-cycle. La seule garde est un CHECK d'auto-
-- référence directe sur recipe_components (miroir, mig 215) et une détection
-- applicative (detectComponentCycle) qui ne parcourt ni les formats non par défaut
-- ni les composants de format. Un cycle indirect A→B→A inséré via les composants de
-- format passait, et les vues récursives de coût le comptaient alors sur 12 niveaux.
--
-- Ce trigger rejette toute ligne (source_recipe_id) qui rendrait la nomenclature
-- cyclique, en parcourant TOUS les modèles (composants de format + miroir + ancien
-- modèle sous-recettes). Message contenant « circulaire » pour que le contrôleur le
-- traduise en erreur 400 (replace de composition).
CREATE OR REPLACE FUNCTION fn_rfc_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent_recipe uuid;
  v_source        uuid := NEW.source_recipe_id;
BEGIN
  IF v_source IS NULL THEN
    RETURN NEW;  -- composant ingrédient : pas d'arête de recette, pas de cycle possible
  END IF;

  SELECT f.recipe_id INTO v_parent_recipe FROM recipe_formats f WHERE f.id = NEW.format_id;
  IF v_parent_recipe IS NULL THEN
    RETURN NEW;
  END IF;

  -- Auto-référence directe.
  IF v_source = v_parent_recipe THEN
    RAISE EXCEPTION 'Référence circulaire : une recette ne peut pas se contenir elle-même';
  END IF;

  -- Depuis la sous-recette source, peut-on redescendre jusqu'à la recette parente ?
  -- Si oui, ajouter parent -> source fermerait un cycle. Parcours sur les arêtes
  -- EXISTANTES (le trigger est BEFORE, la nouvelle ligne n'y est pas encore).
  IF EXISTS (
    WITH RECURSIVE edges AS (
      SELECT f.recipe_id AS parent, rfc.source_recipe_id AS child
        FROM recipe_format_components rfc JOIN recipe_formats f ON f.id = rfc.format_id
       WHERE rfc.source_recipe_id IS NOT NULL
      UNION
      SELECT rc.recipe_id, rc.source_recipe_id FROM recipe_components rc WHERE rc.source_recipe_id IS NOT NULL
      UNION
      SELECT rsr.recipe_id, rsr.sub_recipe_id FROM recipe_sub_recipes rsr
    ),
    reach AS (
      SELECT v_source AS node, 0 AS depth
      UNION
      SELECT e.child, r.depth + 1
        FROM reach r JOIN edges e ON e.parent = r.node
       WHERE r.depth < 20
    )
    SELECT 1 FROM reach WHERE node = v_parent_recipe
  ) THEN
    RAISE EXCEPTION 'Référence circulaire détectée : ce composant créerait un cycle de nomenclature';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rfc_no_cycle ON recipe_format_components;
CREATE TRIGGER trg_rfc_no_cycle
  BEFORE INSERT OR UPDATE OF source_recipe_id, format_id ON recipe_format_components
  FOR EACH ROW EXECUTE FUNCTION fn_rfc_no_cycle();

COMMENT ON FUNCTION fn_rfc_no_cycle() IS
  'L2 : rejette un composant de format (sous-recette) qui rendrait la nomenclature cyclique, tous modèles confondus (mig 410).';
