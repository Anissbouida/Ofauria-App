-- Migration 217 : Convertir les produits à sous-recettes vers le modèle composé
--
-- POURQUOI
--   Certains produits finis sont restés en mode_cout='ratio_poids' avec des
--   recipe_sub_recipes (ex. « Trompe l'oeil de mangue »). Le modal affiche alors
--   l'ancien tableau « Préparations » au lieu du nouvel éditeur (réservé à 'compose').
--   On uniformise : ces produits passent en 'compose' avec leur composition dans
--   recipe_components, comme les produits déjà migrés (mig 202/205).
--
--   COST-NEUTRAL : on recopie chaque sous-recette en composant avec
--   quantite = s.quantity et unite = child.yield_unit. En mode composé, le frac
--   d'arête = quantite × fn_unit_conv(yield_unit, yield_unit=1) / (yield × (1-perte=0))
--   = quantity / yield_quantity = EXACTEMENT le frac ratio_poids. Le coût total
--   (v_recipe_total_cost) est donc identique.
--
-- PORTÉE
--   - Seulement les produits (is_base=false) ratio_poids AYANT des sous-recettes
--     (les produits sans compo restent ratio_poids).
--   - NON DESTRUCTIF : recipe_sub_recipes est conservé (la vue l'ignore en mode
--     composé : ses arêtes sont WHERE mode_cout<>'compose'). recipe_ingredients /
--     recipe_packaging restent comptés via v_recipe_direct_cost (own_cost). Pas de
--     double comptage : on n'insère QUE les sous-recettes en composants, pas les
--     ingrédients directs.
--   - Rôle déduit du nom (même heuristique que mig 202), défaut 'garniture'.
--
-- INVERSION
--   UPDATE recipes SET mode_cout='ratio_poids' WHERE id IN (<les produits convertis>);
--   DELETE FROM recipe_components WHERE recipe_id IN (<idem>) AND source_recipe_id IS NOT NULL;

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, quantite, unite, ordre)
SELECT s.recipe_id,
       CASE
         WHEN child.name ~* 'gla[çc]age|enrobage|pistolet|miroir|rocher'        THEN 'glacage'
         WHEN child.name ~* 'insert|confit|compot|cr[ée]meux|gel[ée]e?'         THEN 'insert'
         WHEN child.name ~* 'p[âa]te sucr|p[âa]te sabl|p[âa]te bris|fond'        THEN 'fond'
         WHEN child.name ~* 'biscuit|g[ée]noise|dacquoise|joconde|moelleux'     THEN 'biscuit'
         WHEN child.name ~* 'croustillant|streusel|nougatine|feuillet'          THEN 'croustillant'
         WHEN child.name ~* 'nappage|sirop|imbibage'                            THEN 'nappage'
         WHEN child.name ~* 'd[ée]cor|amandes? (cara|effil)'                     THEN 'decor'
         WHEN child.name ~* 'mousse|cr[èe]me|bavaroise|ganache|appareil'         THEN 'garniture'
         WHEN child.name ~* 'banane|pomme|poire|mangue|ananas|fraise|fruit'     THEN 'fruits'
         ELSE 'garniture'
       END AS role,
       s.sub_recipe_id, s.quantity, child.yield_unit,
       (row_number() OVER (PARTITION BY s.recipe_id ORDER BY s.quantity DESC) - 1)::smallint AS ordre
FROM recipe_sub_recipes s
JOIN recipes child ON child.id = s.sub_recipe_id
JOIN recipes p     ON p.id = s.recipe_id
WHERE p.is_base = false
  AND p.mode_cout = 'ratio_poids'
  AND NOT EXISTS (
    SELECT 1 FROM recipe_components c
    WHERE c.recipe_id = s.recipe_id AND c.source_recipe_id = s.sub_recipe_id
  );

UPDATE recipes p
SET mode_cout = 'compose', updated_at = NOW()
WHERE p.is_base = false
  AND p.mode_cout = 'ratio_poids'
  AND EXISTS (SELECT 1 FROM recipe_components c WHERE c.recipe_id = p.id);
