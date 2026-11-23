-- 635 — Miroir de composition : lignes d'emballage et pourcentage (étape 2 bis, suite de 634).
--
-- POURQUOI
--   fn_sync_recipe_mirror (mig 412) recopie les lignes du format par défaut dans
--   recipe_components, lu par les vues de coût. Une ligne d'EMBALLAGE (mig 634) n'a ni
--   recette ni matière : la recopier violait chk_rc_one_source et faisait échouer
--   l'enregistrement de la nomenclature. Le pourcentage saisi n'était pas recopié.
--
-- CE QUI CHANGE
--   - recipe_format_components.pct (même règle que sur recipe_components) ;
--   - le miroir ignore les lignes d'emballage (leur coût passe par cout_emballage_unitaire,
--     mig 634) et recopie le pourcentage.

ALTER TABLE recipe_format_components ADD COLUMN IF NOT EXISTS pct NUMERIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rfc_pct') THEN
    ALTER TABLE recipe_format_components ADD CONSTRAINT chk_rfc_pct CHECK (pct IS NULL OR (pct > 0 AND pct <= 100));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_sync_recipe_mirror(p_recipe_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM recipe_components WHERE recipe_id = p_recipe_id;
  INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct, pct)
  SELECT f.recipe_id, fc.role, fc.source_recipe_id, fc.source_ingredient_id, fc.quantite, fc.unite, fc.ordre, COALESCE(fc.perte_pct, 0), fc.pct
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id
  WHERE f.recipe_id = p_recipe_id AND f.is_default AND f.is_active
    AND fc.source_packaging_id IS NULL;
END;
$function$;
