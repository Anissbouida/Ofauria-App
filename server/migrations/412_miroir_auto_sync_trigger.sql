-- 412 (L2) : le miroir recipe_components n'est plus maintenu À LA MAIN.
--
-- recipe_components est le MIROIR des composants du format par défaut (lu par les
-- vues de coût v_recipe_total_cost / v_rcomp_cost / v_recipe_explosion). Jusqu'ici
-- il était resynchronisé à la main dans trois endroits (replaceForFormat, restore,
-- remplacement en masse) — fragile : un oubli le désynchronisait.
--
-- Désormais un trigger le reconstruit automatiquement dès que les composants du
-- format par défaut changent (ou que le format par défaut change). Le code applicatif
-- qui le synchronisait est retiré dans le même lot. Les lecteurs (vues de coût) ne
-- changent pas : recipe_components reste une table, mais dérivée automatiquement.

-- Reconstruit le miroir d'une recette depuis les composants de son format par défaut actif.
CREATE OR REPLACE FUNCTION fn_sync_recipe_mirror(p_recipe_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM recipe_components WHERE recipe_id = p_recipe_id;
  INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct)
  SELECT f.recipe_id, fc.role, fc.source_recipe_id, fc.source_ingredient_id, fc.quantite, fc.unite, fc.ordre, COALESCE(fc.perte_pct, 0)
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id
  WHERE f.recipe_id = p_recipe_id AND f.is_default AND f.is_active;
END;
$$;

-- Trigger sur les composants de format : resync si le format touché est le défaut actif.
CREATE OR REPLACE FUNCTION trg_rfc_sync_mirror() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_recipe uuid; v_is_default boolean;
BEGIN
  SELECT f.recipe_id, (f.is_default AND f.is_active) INTO v_recipe, v_is_default
  FROM recipe_formats f WHERE f.id = COALESCE(NEW.format_id, OLD.format_id);
  IF v_is_default THEN
    PERFORM fn_sync_recipe_mirror(v_recipe);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rfc_sync_mirror ON recipe_format_components;
CREATE TRIGGER trg_rfc_sync_mirror
  AFTER INSERT OR UPDATE OR DELETE ON recipe_format_components
  FOR EACH ROW EXECUTE FUNCTION trg_rfc_sync_mirror();

-- Trigger sur les formats : un changement de format par défaut (ou d'activation)
-- doit reconstruire le miroir depuis le nouveau défaut.
CREATE OR REPLACE FUNCTION trg_rf_sync_mirror() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_sync_recipe_mirror(NEW.recipe_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rf_sync_mirror ON recipe_formats;
CREATE TRIGGER trg_rf_sync_mirror
  AFTER UPDATE OF is_default, is_active ON recipe_formats
  FOR EACH ROW
  WHEN (OLD.is_default IS DISTINCT FROM NEW.is_default OR OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION trg_rf_sync_mirror();

COMMENT ON FUNCTION fn_sync_recipe_mirror(uuid) IS
  'L2 (mig 412) : reconstruit recipe_components (miroir) depuis les composants du format par défaut. Appelé par trigger — plus de synchro à la main.';
