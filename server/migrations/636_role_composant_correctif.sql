-- 636 — Correctif de la mig 634 : rôle de ligne sur recipe_components.
--
-- POURQUOI
--   fn_component_role (mig 634) sert aux deux tables de composition et lisait
--   NEW.source_packaging_id, colonne qui n'existe que sur recipe_format_components.
--   PL/pgSQL résout le champ à l'exécution : toute écriture dans recipe_components
--   (dont le miroir du format par défaut) échouait avec « record "new" has no field ».
--   Constaté par fiche-generique.db.test.ts.
--
-- CE QUI CHANGE
--   La source d'emballage est lue par to_jsonb(NEW), sans erreur quand la colonne manque.

CREATE OR REPLACE FUNCTION fn_component_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected TEXT; packaging TEXT;
BEGIN
  packaging := to_jsonb(NEW) ->> 'source_packaging_id';
  expected := CASE
    WHEN packaging IS NOT NULL THEN 'emballage'
    WHEN NEW.source_recipe_id IS NOT NULL THEN 'semi_fini'
    ELSE 'matiere' END;
  IF NEW.role IS NULL OR NEW.role = '' THEN
    NEW.role := expected;
  ELSIF NEW.role NOT IN ('matiere', 'semi_fini', 'emballage') THEN
    -- Rôles historiques de la composition (base, garniture…) : ramenés à la nature de la source.
    NEW.role := expected;
  ELSIF NEW.role <> expected THEN
    RAISE EXCEPTION 'Rôle « % » incompatible avec la source de la ligne (attendu « % »)', NEW.role, expected USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
