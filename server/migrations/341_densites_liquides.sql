-- Migration 341 : Densites des ingredients stockes en volume
-- Reprise de la mig 288 de la branche wip/travail-en-cours-2026-10-22.
--
-- POURQUOI
--   Un ingredient stocke en LITRES mais PESE en grammes dans une recette passe
--   par fn_unit_conv(g -> l), qui ne sait pas convertir un poids en volume sans
--   densite et retombe sur son facteur neutre 1 : 1 g est facture comme 1 L.
--   Depuis la mig 340, ce cas est au moins SIGNALE (conversion_ok = false,
--   badge dans l'editeur de nomenclature). Pour que le cout soit JUSTE, il faut
--   la densite. Le referentiel compte des ingredients en litres/ml sans
--   densite (lait, purees de fruits, huile, sauces) : on la pose pour tous, en
--   une fois, plutot que de laisser chaque fiche patcher les siens.
--
-- ─── VALEURS RETENUES ───
--   Densites standards a 20 °C. Les purees de fruits du commerce (10 % de sucre
--   ajoute) titrent 1,04-1,08 : on retient 1,05, l'ecart residuel sur une piece
--   se compte en centimes.
--     Lait entier                       1,030
--     Creme de cuisson                  1,010
--     Purees de fruits (7 references)   1,050
--     Huile / « Hille »                 0,920
--     Mayonnaise                        0,910
--     Sauces emulsionnees               1,000
--     Sauce soja                        1,150
--     Vinaigre blanc                    1,010
--     Trablit (extrait de cafe)         1,100
--
-- ─── CE QUE CETTE MIGRATION NE CORRIGE PAS ───
--   Une densite ne repare pas un prix absent : un ingredient a unit_cost = 0
--   coute 0 DH, silencieusement. Les references en doublon a 0 DH doivent etre
--   valorisees par le chef ou archivees au profit de leur doublon.
--
-- ─── DIFFERENCE AVEC LA MIG 288 D'ORIGINE ───
--   La 288 levait une EXCEPTION s'il restait un ingredient en volume sans
--   densite, ce qui bloque toute la chaine de migrations en production sur un
--   simple referentiel incomplet. Ici on emet un WARNING nominatif : le cout
--   de ces ingredients reste signale comme incertain par la mig 340, ce qui est
--   le bon niveau d'alerte pour une donnee de referentiel.
--
-- PORTEE
--   UPDATE sur ingredients.densite_kg_l, uniquement la ou elle est NULL (une
--   densite deja saisie par le chef n'est jamais ecrasee). Aucune recette
--   touchee : les couts sont recalcules par les vues a la lecture. Rejouable.
--
-- INVERSION
--   UPDATE ingredients SET densite_kg_l = NULL
--    WHERE name IN (<les 17 noms ci-dessous>);

UPDATE ingredients i
   SET densite_kg_l = v.densite
  FROM (VALUES
    ('Lait',                        1.030),
    ('Créme cuisson',               1.010),
    ('Framboise purée',             1.050),
    ('Purée ananas',                1.050),
    ('Purée de passion',            1.050),
    ('Purée de poire',              1.050),
    ('Purée mangue',                1.050),
    ('Purée passion',               1.050),
    ('Purée raisin',                1.050),
    ('Puree pomme',                 1.050),
    ('Hille',                       0.920),
    ('Mayonnaise bidon',            0.910),
    ('Sauce Algérienne',            1.000),
    ('Sauce Big Burger',            1.000),
    ('Sauce soja supérieure light', 1.150),
    ('Vinaigre blanc',              1.010),
    ('Trablit',                     1.100)
  ) AS v (nom, densite)
 WHERE i.name = v.nom
   AND i.densite_kg_l IS NULL;

-- Signalement nominatif (non bloquant) des ingredients en volume toujours sans
-- densite : leur cout reste marque conversion_ok = false par la mig 340.
DO $$
DECLARE n INT; restants TEXT;
BEGIN
  SELECT count(*), string_agg(name, ', ' ORDER BY name) INTO n, restants
    FROM ingredients
   WHERE lower(unit) IN ('l', 'ml') AND densite_kg_l IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'Ingredients en volume sans densite (% restant(s), cout signale incertain) : %', n, restants;
  END IF;
END $$;
