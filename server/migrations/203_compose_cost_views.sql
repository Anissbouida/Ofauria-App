-- Migration 203 : Vues de coût en mode composé (lisent recipe_format_components)
--
-- POURQUOI
--   Brancher la nomenclature par format (mig 200/202) sur le calcul de coût,
--   SANS toucher les vues live (v_recipe_total_cost / v_recipe_format_cost dont
--   l'app dépend). On ajoute des vues NEUVES, puis on valide qu'elles redonnent
--   le même coût que le legacy avant toute bascule.
--
--   Coût d'un composant :
--     - recette de base : quantite (convertie) × coût total base / rendement
--       UTILISABLE (yield × (1 - perte_standard/100)).
--     - ingrédient direct : quantite (convertie) × unit_cost.
--   fn_unit_conv : facteur de conversion (masse g/kg/mg, volume ml/cl/dl/l),
--   1 si même unité ou unités incompatibles (comportement legacy ELSE 1).
--
-- PORTÉE
--   1 fonction IMMUTABLE + 2 vues NEUVES. Aucune vue/table existante modifiée.
--   Profondeur d'imbrication : s'appuie sur v_recipe_total_cost pour le coût des
--   sous-recettes (1 niveau aujourd'hui — récursivité full = étape ultérieure).
--
-- INVERSION
--   DROP VIEW v_recipe_compose_cost; DROP VIEW v_recipe_component_cost;
--   DROP FUNCTION fn_unit_conv(text, text);

CREATE OR REPLACE FUNCTION fn_unit_conv(p_from text, p_to text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(p_from) = lower(p_to) THEN 1::numeric
    WHEN lower(p_from) IN ('g','kg','mg') AND lower(p_to) IN ('g','kg','mg') THEN
         (CASE lower(p_from) WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'mg' THEN 0.001 END)::numeric
       / (CASE lower(p_to)   WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'mg' THEN 0.001 END)::numeric
    WHEN lower(p_from) IN ('ml','cl','dl','l') AND lower(p_to) IN ('ml','cl','dl','l') THEN
         (CASE lower(p_from) WHEN 'ml' THEN 1 WHEN 'cl' THEN 10 WHEN 'dl' THEN 100 WHEN 'l' THEN 1000 END)::numeric
       / (CASE lower(p_to)   WHEN 'ml' THEN 1 WHEN 'cl' THEN 10 WHEN 'dl' THEN 100 WHEN 'l' THEN 1000 END)::numeric
    ELSE 1::numeric
  END;
$$;

-- Coût par ligne de nomenclature.
CREATE OR REPLACE VIEW v_recipe_component_cost AS
SELECT c.id        AS component_id,
       c.format_id,
       c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite
             * fn_unit_conv(c.unite, br.yield_unit)
             * COALESCE(brc.total_cost, 0)
             / NULLIF(br.yield_quantity * (1 - COALESCE(br.perte_standard_pct, 0) / 100), 0)
         ELSE
           c.quantite
             * fn_unit_conv(c.unite, ing.unit::text)
             * COALESCE(ing.unit_cost, 0)
       END AS cout_dh
FROM recipe_format_components c
LEFT JOIN recipes              br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost  brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients          ing ON ing.id = c.source_ingredient_id;

-- Coût composé par format = direct (ingrédients propres du produit) + composants + emballage.
CREATE OR REPLACE VIEW v_recipe_compose_cost AS
SELECT f.recipe_id,
       f.id          AS format_id,
       f.is_default,
       COALESCE(vdc.direct_cost, 0)
       + COALESCE(cc.sum_comp, 0)
       + f.cout_emballage_unitaire AS cout_compose_dh
FROM recipe_formats f
LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = f.recipe_id
LEFT JOIN (
  SELECT format_id, SUM(cout_dh) AS sum_comp
  FROM v_recipe_component_cost
  GROUP BY format_id
) cc ON cc.format_id = f.id;

COMMENT ON VIEW v_recipe_compose_cost IS 'Coût composé par format (lit recipe_format_components) — non encore branché aux vues live';
