-- Migration 289 : v_recipe_component_cost ignore la densite (bug de coût)
--
-- POURQUOI
--   Le moteur de cout convertit les unites avec fn_unit_conv, qui existe en deux
--   surcharges :
--     fn_unit_conv(from, to)            -> poids<->volume impossible, renvoie 1
--     fn_unit_conv(from, to, densite)   -> poids<->volume via la densite (mig 227)
--
--   Deux des trois vues de cout appellent la version a 3 arguments :
--     v_recipe_direct_cost   (ingredients d'une recette de base)   OK
--     v_recipe_total_cost    (miroir recipe_components)            OK
--   La troisieme appelle la version a 2 arguments :
--     v_recipe_component_cost (nomenclature par format)            BUG
--
--   Un ingredient stocke en LITRES et pese en GRAMMES dans un format est donc
--   facture comme si 1 g valait 1 L. Constate en validant les fiches 282/286 :
--     120 g d'huile de table (17,00 DH/l, densite 0,920)
--        -> 2 040,00 DH au lieu de 2,22 DH
--      20 g de puree de passion (97,80 DH/l)
--        -> 1 956,00 DH au lieu de 2,05 DH
--   Soit un beignet a 103 DH de matiere pour 5,50 DH de vente.
--
--   Le meme ingredient, dans la meme quantite, coute donc juste s'il est lu par
--   le miroir et faux s'il est lu par le format — alors que le miroir est cense
--   etre la copie du format.
--
-- ─── LE PIRE : LE DRAPEAU QUALITE DIT QUE TOUT VA BIEN ───
--   La colonne conversion_ok de cette meme vue tient DEJA compte de la densite :
--   elle declare la conversion valide des lors que ing.densite_kg_l IS NOT NULL.
--   Le cout, lui, l'ignore. Resultat : bad_conversions_count = 0 sur une
--   nomenclature dont le cout est faux d'un facteur ~1000. Le signal cense
--   attraper ce cas precis (mig 260, audit A3) le rate par construction.
--
-- CE QUE CHANGE CETTE MIGRATION
--   Une seule expression : le calcul du cout des composants qui pointent un
--   INGREDIENT recoit ing.densite_kg_l. Les composants qui pointent une
--   SOUS-RECETTE ne sont pas concernes (une recette n'a pas de densite ; son
--   yield_unit et l'unite du composant sont homogenes, cf. mig 273).
--   conversion_ok est inchange : il etait deja correct.
--
-- EFFET
--   Baisse mecanique du cout de toute nomenclature qui pese en grammes un
--   ingredient stocke en litres (huiles, laits, purees, sirops). Les fiches
--   concernees voyaient un cout absurde : aucune n'etait exploitable, il n'y a
--   donc pas de reference historique a preserver.
--   Prerequis de justesse : que la densite soit renseignee (mig 288).
--
-- PORTEE
--   CREATE OR REPLACE VIEW, aucune donnee touchee. Rejouable.
--
-- INVERSION
--   Rejouer la definition precedente en remplacant
--   fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l)
--   par fn_unit_conv(c.unite::text, ing.unit::text).

CREATE OR REPLACE VIEW v_recipe_component_cost AS
SELECT c.id AS component_id,
       c.format_id,
       c.role,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN
           c.quantite
           * fn_unit_conv(c.unite::text, br.yield_unit::text)
           * COALESCE(brc.total_cost, 0::numeric)
           / NULLIF(br.yield_quantity * (1::numeric - COALESCE(br.perte_standard_pct, 0::numeric) / 100::numeric), 0::numeric)
           / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
         ELSE
           -- ─── LE CORRECTIF : densite passee a fn_unit_conv ───
           c.quantite
           * fn_unit_conv(c.unite::text, ing.unit::text, ing.densite_kg_l)
           * COALESCE(ing.unit_cost, 0::numeric)
           / NULLIF(1::numeric - COALESCE(c.perte_pct, 0::numeric) / 100::numeric, 0::numeric)
       END AS cout_dh,
       CASE
         WHEN c.source_recipe_id IS NOT NULL THEN fn_unit_conv_ok(c.unite::text, br.yield_unit::text)
         ELSE fn_unit_conv_ok(c.unite::text, ing.unit::text)
              OR ((lower(c.unite::text) = ANY (ARRAY['g'::text, 'kg'::text, 'mg'::text]))
                  AND (lower(ing.unit::text) = ANY (ARRAY['ml'::text, 'cl'::text, 'dl'::text, 'l'::text]))
                  OR (lower(c.unite::text) = ANY (ARRAY['ml'::text, 'cl'::text, 'dl'::text, 'l'::text]))
                  AND (lower(ing.unit::text) = ANY (ARRAY['g'::text, 'kg'::text, 'mg'::text])))
                 AND ing.densite_kg_l IS NOT NULL
       END AS conversion_ok
  FROM recipe_format_components c
  LEFT JOIN recipes br ON br.id = c.source_recipe_id
  LEFT JOIN v_recipe_total_cost brc ON brc.id = c.source_recipe_id
  LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id;
