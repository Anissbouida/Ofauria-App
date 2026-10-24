-- Migration 340 : v_recipe_component_cost ignore la densite (bug de cout)
-- Reprise de la mig 289 de la branche wip/travail-en-cours-2026-10-22,
-- appliquee sur la definition courante de main (mig 265).
--
-- POURQUOI
--   fn_unit_conv existe en deux surcharges :
--     fn_unit_conv(from, to)            -> poids<->volume impossible, renvoie 1 (mig 203)
--     fn_unit_conv(from, to, densite)   -> poids<->volume via la densite   (mig 227)
--
--   La mig 227 avait mis TOUTES les vues de cout sur la version a 3 arguments.
--   Puis les mig 260 (drapeau conversion_ok) et 265 (perte_pct par ligne) ont
--   recree v_recipe_component_cost en repartant de l'ancienne expression a
--   2 arguments : regression silencieuse. Etat sur main avant cette migration :
--     v_recipe_direct_cost    (ingredients d'une recette de base)   3 args  OK
--     v_recipe_total_cost     (miroir recipe_components)            3 args  OK
--     v_recipe_component_cost (nomenclature par format)             2 args  BUG
--
--   Un ingredient stocke en LITRES et pese en GRAMMES dans un format est donc
--   facture comme si 1 g valait 1 L. Constate sur la branche wip en validant
--   les fiches techniques :
--     120 g d'huile de table (17,00 DH/l, densite 0,920)
--        -> 2 040,00 DH au lieu de 2,22 DH
--      20 g de puree de passion (97,80 DH/l)
--        -> 1 956,00 DH au lieu de 2,05 DH
--   Soit un beignet a 103 DH de matiere pour 5,50 DH de vente. Le meme
--   ingredient, dans la meme quantite, coute juste s'il est lu par le miroir
--   et faux s'il est lu par le format — alors que le miroir est la copie du format.
--
-- ─── LE PIRE : LE DRAPEAU QUALITE DIT QUE TOUT VA BIEN ───
--   conversion_ok (mig 260) tient DEJA compte de la densite : il declare la
--   conversion valide des que ing.densite_kg_l IS NOT NULL. Le cout, lui,
--   l'ignorait. bad_conversions_count = 0 sur une nomenclature fausse d'un
--   facteur ~1000 : le signal cense attraper ce cas le ratait par construction.
--   Apres cette migration, cout et drapeau reposent sur la meme information :
--     densite renseignee  -> cout juste, conversion_ok = true
--     densite absente     -> facteur 1 (inchange), conversion_ok = false,
--                            bad_conversions_count > 0, badge dans l'editeur.
--   « Renvoyer 1 en silence » n'existe plus : le 1 est toujours accompagne du
--   drapeau.
--
-- CE QUE CHANGE CETTE MIGRATION
--   Une seule expression : la branche INGREDIENT de cout_dh recoit
--   ing.densite_kg_l. La branche SOUS-RECETTE est inchangee (une recette n'a
--   pas de densite ; son yield_unit et l'unite du composant sont homogenes, et
--   fn_unit_conv_ok signale deja le cas contraire).
--
-- PORTEE
--   CREATE OR REPLACE VIEW, memes colonnes (component_id, format_id, role,
--   cout_dh, conversion_ok) : v_recipe_compose_cost, qui la consomme, reste
--   valide. Aucune donnee touchee. Rejouable.
--   Prerequis de justesse : que la densite soit renseignee (mig 341).
--
-- INVERSION
--   Rejouer la definition de la mig 265 (fn_unit_conv a 2 arguments).

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
             / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)   -- Mig 265 : perte ligne
         ELSE
           c.quantite
             * fn_unit_conv(c.unite, ing.unit::text, ing.densite_kg_l)   -- Mig 340 : densite
             * COALESCE(ing.unit_cost, 0)
             / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)   -- Mig 265 : perte ligne
       END AS cout_dh,
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
  'Cout par composant (mig 265 + 340). cout_dh integre perte_pct de la ligne et la densite de l''ingredient (poids<->volume). conversion_ok=false -> fn_unit_conv est retombe sur le facteur 1 (unites incompatibles ou densite manquante) : cout_dh est a considerer avec reserve.';
