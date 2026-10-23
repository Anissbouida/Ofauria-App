-- Migration 288 : Densites des ingredients stockes en volume
--
-- POURQUOI
--   Piege documente en mig 273 et 276, jamais traite en dehors des deux
--   ingredients de l'Opera : un ingredient stocke en LITRES mais PESE en grammes
--   dans une recette passe par fn_unit_conv(g -> l), qui ne sait pas convertir un
--   poids en volume sans densite et retombe sur son facteur neutre 1.
--   Consequence : 1 g est facture comme 1 L.
--
--   Constate en validant les fiches des mig 282 et 286 :
--     120 g d'huile de table  ->  2 040,00 DH   au lieu de ~2,20 DH
--      20 g de puree passion  ->  1 956,00 DH   au lieu de ~2,05 DH
--   Soit un beignet a 103 DH de matiere pour 5,50 DH de vente, et un entremets
--   Eclat passion a 331 DH la piece. Le calcul de cout n'echoue pas : il ment.
--
--   Le referentiel compte 17 ingredients en litres/ml sans densite. Les fiches
--   techniques des mig 281-287 en consomment plusieurs (lait, purees de fruits,
--   huile, sauces). On pose donc la densite pour tous, en une fois, plutot que de
--   laisser chaque migration de famille patcher les siens.
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
--   Quatre de ces references ont un unit_cost a 0,00 DH : « Puree pomme »,
--   « Puree de poire », « Puree passion », et elles coexistent avec des doublons
--   correctement valorises. Une densite ne repare pas un prix absent : un
--   ingredient a 0 DH coute 0 DH, silencieusement. Ces fiches doivent etre soit
--   valorisees par le chef, soit archivees au profit de leur doublon. Les
--   migrations de fiches les evitent par le pattern de resolution
--   (ORDER BY usages DESC, unit_cost > 0 DESC).
--
-- PORTEE
--   17 UPDATE sur ingredients.densite_kg_l, uniquement la ou elle est NULL
--   (une densite deja saisie par le chef n'est jamais ecrasee). Aucune recette
--   touchee : les couts sont recalcules par les vues a la lecture.
--   Rejouable.
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

-- Garde-fou : plus aucun ingredient en volume sans densite. Si le referentiel
-- en gagne un nouveau, cette migration echoue et force sa prise en compte
-- plutot que de laisser un cout faux passer en production.
DO $$
DECLARE n INT; restants TEXT;
BEGIN
  SELECT count(*), string_agg(name, ', ' ORDER BY name) INTO n, restants
    FROM ingredients
   WHERE lower(unit) IN ('l', 'ml') AND densite_kg_l IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Ingredients en volume sans densite (% restant(s)) : %', n, restants;
  END IF;
END $$;
