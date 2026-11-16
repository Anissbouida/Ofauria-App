-- G0-26 (plan d'action 2026-11) — conversion d'unité qui renvoie 1 en silence.
--
-- fn_unit_conv (mig 227) rend 1 pour toute conversion qu'elle ne connaît pas : pièce
-- vers kg, mètre vers gramme, poids vers volume sans densité… Le coût et les besoins
-- calculés avec ce « 1 » sont faux sans que rien ne le signale.
--
-- Cette migration NE TOUCHE PAS fn_unit_conv (la bascule de ses appelants se fera en
-- M3). Elle ajoute :
--   - fn_unit_conv_strict : même calcul, mais NULL quand la conversion est inconnue ;
--   - v_impossible_unit_conversions : lignes de fiche technique dont l'unité ne se
--     convertit pas vers l'unité de stock de la matière. Attendu : vide.
CREATE OR REPLACE FUNCTION fn_unit_conv_strict(p_from text, p_to text, p_densite numeric DEFAULT NULL)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN NULL
    WHEN lower(p_from) = lower(p_to) THEN 1::numeric
    WHEN lower(p_from) IN ('mg','g','kg') AND lower(p_to) IN ('mg','g','kg') THEN fn_unit_conv(p_from, p_to)
    WHEN lower(p_from) IN ('ml','cl','dl','l') AND lower(p_to) IN ('ml','cl','dl','l') THEN fn_unit_conv(p_from, p_to)
    -- Poids <-> volume : seulement avec la densité de la matière.
    WHEN COALESCE(p_densite, 0) > 0 AND (
           (lower(p_from) IN ('mg','g','kg') AND lower(p_to) IN ('ml','cl','dl','l'))
        OR (lower(p_from) IN ('ml','cl','dl','l') AND lower(p_to) IN ('mg','g','kg')))
      THEN fn_unit_conv(p_from, p_to, p_densite)
    ELSE NULL
  END
$$;
COMMENT ON FUNCTION fn_unit_conv_strict(text, text, numeric) IS
  'Facteur de conversion d''unité, NULL si la conversion est inconnue (fn_unit_conv rend 1). G0-26';

CREATE OR REPLACE VIEW v_impossible_unit_conversions AS
SELECT 'recipe_ingredient'::text AS source, ri.id::text AS line_id, r.id AS recipe_id, r.name AS recipe_name,
       NULL::uuid AS format_id, i.id AS ingredient_id, i.name AS ingredient_name,
       ri.unit::text AS line_unit, i.unit::text AS stock_unit, i.densite_kg_l, ri.quantity::numeric AS quantity
  FROM recipe_ingredients ri
  JOIN recipes r ON r.id = ri.recipe_id AND r.archived_at IS NULL
  JOIN ingredients i ON i.id = ri.ingredient_id
 WHERE ri.unit IS NOT NULL AND fn_unit_conv_strict(ri.unit, i.unit, i.densite_kg_l) IS NULL
UNION ALL
SELECT 'recipe_component', rc.id::text, r.id, r.name, NULL::uuid, i.id, i.name,
       rc.unite::text, i.unit::text, i.densite_kg_l, rc.quantite::numeric
  FROM recipe_components rc
  JOIN recipes r ON r.id = rc.recipe_id AND r.archived_at IS NULL
  JOIN ingredients i ON i.id = rc.source_ingredient_id
 WHERE rc.unite IS NOT NULL AND fn_unit_conv_strict(rc.unite, i.unit, i.densite_kg_l) IS NULL
UNION ALL
SELECT 'recipe_format_component', fc.id::text, r.id, r.name, f.id, i.id, i.name,
       fc.unite::text, i.unit::text, i.densite_kg_l, fc.quantite::numeric
  FROM recipe_format_components fc
  JOIN recipe_formats f ON f.id = fc.format_id AND f.is_active
  JOIN recipes r ON r.id = f.recipe_id AND r.archived_at IS NULL
  JOIN ingredients i ON i.id = fc.source_ingredient_id
 WHERE fc.unite IS NOT NULL AND fn_unit_conv_strict(fc.unite, i.unit, i.densite_kg_l) IS NULL;
COMMENT ON VIEW v_impossible_unit_conversions IS
  'Lignes de fiche technique dont l''unité ne se convertit pas vers l''unité de stock de la matière (calculées avec un facteur 1). G0-26';
