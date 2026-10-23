-- Migration 274 : Un format de production pour chaque preparation de base (option B)
--
-- POURQUOI
--   Aujourd'hui : 54 recettes produits finis sur 54 ont un format actif, 96
--   preparations de base sur 96 n'en ont aucun. Tout l'appareillage construit
--   depuis la mig 157 — contenant, rendement par contenant, cout rapporte a une
--   piece, declinaison d'une meme pate sur plusieurs moules — ne s'applique donc
--   qu'a la moitie du referentiel.
--
--   C'est un decalage de modele, pas une propriete du metier : une Joconde se
--   cuit bien sur une plaque 60x40, une pate a choux se dresse bien sur une
--   plaque, et le labo raisonne en plaques, pas en grammes abstraits. Cette
--   migration donne a chaque base le meme socle qu'un produit fini.
--
--   Le mecanisme existe deja et tourne : CAKE NATURE est en `ratio_poids` avec
--   ses ingredients au niveau recette et DEUX formats (Moule 300 x3 = 900 g,
--   Moule 600 x3 = 1800 g) ; v_recipe_format_cost repartit la fournee de 2700 g
--   au prorata et sort 6,52 DH et 12,70 DH l'unite. Aucun concept nouveau n'est
--   introduit ici : on ouvre ce mecanisme aux bases.
--
-- NEUTRALITE — le point important
--   Le format cree est volontairement NEUTRE :
--     contenant_id        = NULL  (le chef rattachera le vrai contenant depuis l'UI)
--     nb_par_defaut       = 1     (une fournee)
--     quantite_par_format = poids reel de la recette, en grammes
--     is_default          = true
--
--   Consequence sur les couts : AUCUNE.
--     - v_recipe_total_cost ne lit pas les formats pour une recette
--       `ratio_poids` (elle somme les ingredients propres et descend les
--       sous-recettes). Les 96 bases restent en ratio_poids, leur cout ne bouge
--       pas, donc le cout des recettes qui les consomment ne bouge pas non plus.
--     - v_recipe_format_cost emet desormais une ligne par base. Avec un format
--       unique, le prorata vaut 1 : cout_matiere_format = cout total. C'est
--       l'identite, pas une reponderation.
--     - v_recipe_format_summary compare le poids des formats au poids calcule
--       des ingredients. On pose donc quantite_par_format sur le poids REEL
--       (v_recipe_total_weight_kg) et non sur yield_quantity : sinon une fiche
--       dont le rendement saisi differe du poids des ingredients afficherait une
--       perte fantome des le lendemain de la migration.
--
--   Repli si le poids n'est pas calculable (fiche sans ingredient ponderable) :
--   le rendement converti en grammes, et a defaut 1000 g. Les 96 bases ont
--   actuellement un poids calculable, ce repli ne devrait servir qu'aux fiches
--   creees plus tard.
--
-- PORTEE
--   INSERT seul dans recipe_formats, une ligne par base qui n'en a pas encore.
--   Idempotent (NOT EXISTS). Aucune recette, aucun ingredient, aucun cout
--   modifie. `recipes.contenant_id` (legacy) n'est pas touche.
--
-- INVERSION
--   DELETE FROM recipe_formats f
--    USING recipes r
--    WHERE r.id = f.recipe_id AND r.is_base
--      AND f.contenant_id IS NULL
--      AND NOT EXISTS (SELECT 1 FROM recipe_format_components c WHERE c.format_id = f.id);
--   (les formats auxquels un contenant ou une composition a ete rattache entre
--    temps sont volontairement conserves : les supprimer perdrait du travail.)

INSERT INTO recipe_formats (
  recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite,
  nb_par_defaut, is_default, ordre, is_active
)
SELECT r.id,
       NULL,
       -- Poids reel des ingredients, en grammes. Repli : rendement converti,
       -- puis 1000 g. GREATEST(...) garantit la contrainte quantite > 0.
       GREATEST(
         ROUND(COALESCE(
           NULLIF(vtw.total_weight_kg, 0) * 1000,
           NULLIF(r.yield_quantity, 0) * CASE lower(r.yield_unit)
                                           WHEN 'kg' THEN 1000
                                           WHEN 'g'  THEN 1
                                           WHEN 'l'  THEN 1000
                                           WHEN 'ml' THEN 1
                                           ELSE 0            -- 'unit' : non ponderable
                                         END,
           1000
         )::numeric, 2),
         1
       ),
       'g',
       1,
       true,
       0,
       true
FROM recipes r
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
WHERE r.is_base
  AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id);

COMMENT ON TABLE recipe_formats IS
  'Formats produits par une recette — produits finis ET preparations de base (mig 274). Remplace la relation 1:1 recipes.contenant_id (toujours present mais deprecated).';
