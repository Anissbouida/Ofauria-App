-- Migration 202 : Reprise recipe_sub_recipes → recipe_format_components
--
-- POURQUOI
--   Convertir la composition existante (liens recipe_sub_recipes) en nomenclature
--   par format, sur le format par défaut créé en mig 201. On NE JETTE RIEN :
--   recipe_sub_recipes reste en place comme filet de sécurité jusqu'au drop final.
--   Rôle déduit automatiquement du nom du composant (à affiner ensuite dans l'UI),
--   défaut 'garniture' si ambigu.
--
-- PORTÉE
--   (a) Insère 1 composant par lien sous-recette, sur le format is_default du produit.
--   (b) Recale quantite_par_format_g du format placeholder = poids total réel (g).
--   (c) Bascule les produits repris en mode_cout='compose'.
--   Idempotent : garde NOT EXISTS (a) ; garde quantite=1 (b) ; set conditionnel (c).
--
-- INVERSION
--   UPDATE recipes SET mode_cout='ratio_poids'
--     WHERE id IN (SELECT recipe_id FROM recipe_formats f JOIN recipe_format_components c ON c.format_id=f.id);
--   DELETE FROM recipe_format_components;  -- (les liens recipe_sub_recipes sont intacts)

-- (a) Reprise des composants sur le format par défaut
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, ordre)
SELECT df.id,
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
       s.sub_recipe_id,
       s.quantity,
       child.yield_unit,
       (row_number() OVER (PARTITION BY df.id ORDER BY s.quantity DESC) - 1)::smallint AS ordre
FROM recipes p
JOIN recipe_sub_recipes s   ON s.recipe_id = p.id
JOIN recipes child          ON child.id = s.sub_recipe_id
JOIN recipe_formats df       ON df.recipe_id = p.id AND df.is_default
WHERE p.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM recipe_format_components c
    WHERE c.format_id = df.id AND c.source_recipe_id = s.sub_recipe_id
  );

-- (b) Recaler le poids du format placeholder = somme réelle des composants (en g)
UPDATE recipe_formats df
SET quantite_par_format_g = sub.total_g, quantite_par_format_unite = 'g'
FROM (
  SELECT c.format_id,
         SUM(c.quantite * CASE lower(c.unite)
               WHEN 'kg' THEN 1000 WHEN 'l' THEN 1000 WHEN 'dl' THEN 100
               WHEN 'cl' THEN 10   WHEN 'ml' THEN 1   WHEN 'g' THEN 1
               WHEN 'mg' THEN 0.001 ELSE 1 END) AS total_g
  FROM recipe_format_components c
  GROUP BY c.format_id
) sub
WHERE df.id = sub.format_id
  AND df.quantite_par_format_g = 1   -- uniquement les placeholders créés en mig 201
  AND sub.total_g > 0;

-- (c) Basculer les produits repris en mode composé
UPDATE recipes p
SET mode_cout = 'compose'
WHERE p.product_id IS NOT NULL
  AND p.mode_cout <> 'compose'
  AND EXISTS (
    SELECT 1 FROM recipe_formats f
    JOIN recipe_format_components c ON c.format_id = f.id
    WHERE f.recipe_id = p.id
  );
