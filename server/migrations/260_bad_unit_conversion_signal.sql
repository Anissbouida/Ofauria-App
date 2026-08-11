-- Migration 260 : Signal des conversions d'unités incompatibles (audit A3, P0)
--
-- POURQUOI
--   fn_unit_conv(from, to) retourne 1 en silence lorsque les unités ne sont pas
--   convertibles (ex : composant saisi en 'unit' → recette de base en 'kg').
--   Résultat : le coût de la BOM et les besoins matière sortent faux, sans
--   aucune alerte dans les vues (seul le helper TS pose déjà un drapeau pour le
--   cas poids↔volume sans densité).
--
--   On ajoute une fonction sœur `fn_unit_conv_ok(from, to)` qui distingue les
--   conversions VRAIMENT valides (unités identiques ou de la même famille
--   masse/volume) des conversions REPLIÉES sur 1 par défaut. La vue par
--   composant expose la nouvelle colonne `conversion_ok`, la vue composée
--   agrège le nombre de composants problématiques en `bad_conversions_count`.
--   Le prix pratiqué et le coût ne bougent PAS : cette migration ne fait
--   qu'ajouter un signal. La correction des recettes fautives se fait dans un
--   deuxième temps, en connaissance de cause.
--
-- PORTÉE
--   + fonction IMMUTABLE fn_unit_conv_ok(text, text) → boolean
--   + colonne `conversion_ok` sur v_recipe_component_cost
--   + colonne `bad_conversions_count` sur v_recipe_compose_cost
--   Aucune donnée modifiée, aucune vue supprimée en cascade (les vues sont
--   remplacées via CREATE OR REPLACE en respectant l'ordre des colonnes
--   existantes ; les nouvelles colonnes sont ajoutées EN FIN pour ne casser
--   aucun consommateur SQL par position).
--
-- INVERSION
--   Recréer les vues sans les nouvelles colonnes et DROP FUNCTION fn_unit_conv_ok.

-- Convention 'unit' = pièce, non convertible vers masse/volume.
-- La règle « ELSE 1 » de fn_unit_conv est conservée (compat descendante) ;
-- fn_unit_conv_ok signale simplement quand ce fallback est utilisé.
CREATE OR REPLACE FUNCTION fn_unit_conv_ok(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN true
    WHEN lower(p_from) = lower(p_to) THEN true
    WHEN lower(p_from) IN ('g','kg','mg') AND lower(p_to) IN ('g','kg','mg') THEN true
    WHEN lower(p_from) IN ('ml','cl','dl','l') AND lower(p_to) IN ('ml','cl','dl','l') THEN true
    -- poids↔volume : convertibles UNIQUEMENT si la densité est fournie ;
    -- le signal est posé au niveau de la vue (ing.densite_kg_l disponible),
    -- fn_unit_conv_ok ne connaît que les unités et considère le cas incertain.
    ELSE false
  END;
$$;

COMMENT ON FUNCTION fn_unit_conv_ok IS
  'True si (from, to) sont convertibles sans fallback silencieux de fn_unit_conv. Poids↔volume : la densité doit être testée au niveau appelant.';

-- v_recipe_component_cost : + conversion_ok (boolean).
-- v_recipe_compose_cost est vue-consommatrice → DROP CASCADE puis recréations.
DROP VIEW IF EXISTS v_recipe_compose_cost;
DROP VIEW IF EXISTS v_recipe_component_cost;

CREATE VIEW v_recipe_component_cost AS
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
       END AS cout_dh,
       -- Vraie compatibilité : mêmes familles d'unités OU densité renseignée
       -- pour un croisement poids↔volume sur un ingrédient. Pour un composant
       -- « recette de base », la densité n'est pas modélisée : masse↔volume
       -- reste non validé.
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           fn_unit_conv_ok(c.unite, br.yield_unit)
         ELSE
           fn_unit_conv_ok(c.unite, ing.unit::text)
             OR (
               ((lower(c.unite) IN ('g','kg','mg')      AND lower(ing.unit::text) IN ('ml','cl','dl','l'))
                OR (lower(c.unite) IN ('ml','cl','dl','l') AND lower(ing.unit::text) IN ('g','kg','mg')))
               AND ing.densite_kg_l IS NOT NULL
             )
       END AS conversion_ok
FROM recipe_format_components c
LEFT JOIN recipes              br  ON br.id  = c.source_recipe_id
LEFT JOIN v_recipe_total_cost  brc ON brc.id = c.source_recipe_id
LEFT JOIN ingredients          ing ON ing.id = c.source_ingredient_id;

COMMENT ON VIEW v_recipe_component_cost IS
  'Coût par composant. conversion_ok=false → fn_unit_conv est retombé sur le fallback 1 (unités incompatibles ou densité manquante), le cout_dh est probablement faux.';

CREATE VIEW v_recipe_compose_cost AS
SELECT f.recipe_id,
       f.id          AS format_id,
       f.is_default,
       COALESCE(vdc.direct_cost, 0)
       + COALESCE(cc.sum_comp, 0)
       + f.cout_emballage_unitaire AS cout_compose_dh,
       COALESCE(cc.bad_conversions_count, 0) AS bad_conversions_count
FROM recipe_formats f
LEFT JOIN v_recipe_direct_cost vdc ON vdc.id = f.recipe_id
LEFT JOIN (
  SELECT format_id,
         SUM(cout_dh) AS sum_comp,
         COUNT(*) FILTER (WHERE conversion_ok = false) AS bad_conversions_count
  FROM v_recipe_component_cost
  GROUP BY format_id
) cc ON cc.format_id = f.id;

COMMENT ON VIEW v_recipe_compose_cost IS
  'Coût composé par format. bad_conversions_count > 0 → au moins un composant est mal converti, cout_compose_dh est à considérer avec réserve.';
