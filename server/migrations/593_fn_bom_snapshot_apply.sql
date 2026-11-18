-- M4-02 (reste) — besoins d'un ordre calculés sur la version de nomenclature en vigueur.
--
-- Une fiche modifiée sans nouvelle version active est une copie de travail : l'ordre doit
-- suivre la version active (bom_versions.snapshot, mig 559), pas la fiche courante.
-- Plutôt que de recoder l'explosion de nomenclature sur le JSON (risque de deux calculs
-- divergents), la confirmation rejoue l'instantané dans les tables de la fiche à
-- l'intérieur d'un POINT DE SAUVEGARDE, calcule les besoins avec le helper habituel, puis
-- revient au point de sauvegarde : la fiche courante n'est jamais modifiée, et les
-- déclencheurs (journal d'audit, miroirs, unités) sont annulés avec le reste.
--
-- fn_bom_snapshot_apply(fiche, instantané) : rend false sans rien écrire si un format de
-- l'instantané n'existe plus (l'appelant garde alors la fiche courante et le signale).
-- Les emballages ne sont pas rejoués : ils ne font pas partie des besoins en matières.
-- NE JAMAIS appeler hors d'un point de sauvegarde annulé ensuite.
--
-- INVERSION : DROP FUNCTION fn_bom_snapshot_apply(uuid, jsonb);
CREATE FUNCTION fn_bom_snapshot_apply(p_recipe uuid, p_snap jsonb) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  h jsonb := p_snap->'header';
  f jsonb;
BEGIN
  IF p_snap IS NULL OR h IS NULL THEN RETURN false; END IF;
  -- Un format de la version supprimé depuis : impossible de rejouer fidèlement.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) x
              WHERE NOT EXISTS (SELECT 1 FROM recipe_formats rf WHERE rf.id = (x->>'format_id')::uuid AND rf.recipe_id = p_recipe)) THEN
    RETURN false;
  END IF;

  UPDATE recipes SET
    is_base = (h->>'is_base')::boolean,
    yield_quantity = (h->>'yield_quantity')::numeric,
    yield_unit = h->>'yield_unit',
    mode_cout = h->>'mode_cout',
    perte_standard_pct = (h->>'perte_standard_pct')::numeric,
    piece_weight_kg = (h->>'piece_weight_kg')::numeric,
    pieces_par_fournee = (h->>'pieces_par_fournee')::integer,
    compo_par_piece = (h->>'compo_par_piece')::boolean,
    contenant_id = (h->>'contenant_id')::uuid,
    etapes = h->'etapes',
    instructions = h->>'instructions'
  WHERE id = p_recipe;

  DELETE FROM recipe_ingredients WHERE recipe_id = p_recipe;
  INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
  SELECT p_recipe, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit'
    FROM jsonb_array_elements(COALESCE(p_snap->'ingredients', '[]'::jsonb)) x;

  DELETE FROM recipe_sub_recipes WHERE recipe_id = p_recipe;
  INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity)
  SELECT p_recipe, (x->>'sub_recipe_id')::uuid, (x->>'quantity')::numeric
    FROM jsonb_array_elements(COALESCE(p_snap->'sub_recipes', '[]'::jsonb)) x;

  -- Formats : d'abord aucun par défaut (index partiel), puis les valeurs de la version.
  UPDATE recipe_formats SET is_default = false WHERE recipe_id = p_recipe AND is_default;
  FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) LOOP
    UPDATE recipe_formats SET
      contenant_id = (f->>'contenant_id')::uuid,
      quantite_par_format = (f->>'quantite_par_format')::numeric,
      quantite_par_format_unite = f->>'quantite_par_format_unite',
      nb_par_defaut = (f->>'nb_par_defaut')::integer,
      nb_parts = (f->>'nb_parts')::integer,
      is_active = (f->>'is_active')::boolean,
      poids_cru_g = (f->>'poids_cru_g')::numeric,
      poids_cuit_g = (f->>'poids_cuit_g')::numeric
    WHERE id = (f->>'format_id')::uuid;
    DELETE FROM recipe_format_components WHERE format_id = (f->>'format_id')::uuid;
    INSERT INTO recipe_format_components (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, perte_pct, ordre)
    SELECT (f->>'format_id')::uuid, c->>'role', (c->>'source_recipe_id')::uuid, (c->>'source_ingredient_id')::uuid,
           (c->>'quantite')::numeric, COALESCE(c->>'unite', 'g'), COALESCE((c->>'perte_pct')::numeric, 0), COALESCE((c->>'ordre')::smallint, 0)
      FROM jsonb_array_elements(COALESCE(f->'components', '[]'::jsonb)) c;
  END LOOP;
  UPDATE recipe_formats rf SET is_default = true
    FROM jsonb_array_elements(COALESCE(p_snap->'formats', '[]'::jsonb)) x
   WHERE rf.id = (x->>'format_id')::uuid AND (x->>'is_default')::boolean;

  -- Composants de la fiche en dernier : les miroirs des formats ont pu les réécrire.
  DELETE FROM recipe_components WHERE recipe_id = p_recipe;
  INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, perte_pct, ordre)
  SELECT p_recipe, x->>'role', (x->>'source_recipe_id')::uuid, (x->>'source_ingredient_id')::uuid,
         (x->>'quantite')::numeric, COALESCE(x->>'unite', 'g'), COALESCE((x->>'perte_pct')::numeric, 0), COALESCE((x->>'ordre')::smallint, 0)
    FROM jsonb_array_elements(COALESCE(p_snap->'components', '[]'::jsonb)) x;

  RETURN true;
END
$$;

COMMENT ON FUNCTION fn_bom_snapshot_apply(uuid, jsonb) IS 'M4-02 : rejoue un instantané de nomenclature dans la fiche — uniquement dans un point de sauvegarde annulé ensuite.';
