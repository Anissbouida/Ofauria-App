-- Migration 285 : Fiches techniques — PÂTISSERIE CLASSIQUE (20 produits) + MACARON (6 produits)
--
-- POURQUOI
--   Suite du plan de couverture du catalogue (mig 280 = bases transversales,
--   modèle mig 273/276 = Opéra). Cette migration monte les fiches des familles
--   PÂTISSERIE CLASSIQUE et MACARON : 26 produits vendus, chacun couvert par un
--   format lié à son product_id.
--
--   Structure produite :
--     12 bases familiales (coque de macaron, crème citron maison, mousselines,
--        appareils à cakes, glaçages…) qui complètent les transversales de la
--        mig 280 (pâte à choux, crème pâtissière, diplomate, pâte sucrée,
--        pâte feuilletée, crème d''amande, génoise, ganaches, sirop 30°B,
--        meringue française) — jamais recréées, référencées par nom.
--     25 produits finis (mode_cout = compose) et 26 formats :
--        le produit POS « MACARON » (générique) est porté par un 2e format de la
--        recette Macaron vanille (contenant NULL), et « MACARON 6 PS » est une
--        recette composée « Coffret 6 macarons » (assortiment, boîte).
--
-- ─── DÉCISIONS DE FICHE (chef) ───
--   * Éclairs : 65 g de pâte à choux crue pochée -> ~47 g net cuit (la perte de
--     28 % est portée par la base Pâte à choux ; le composant du format est le
--     poids NET). 20 éclairs par plaque 60x40.
--   * Mille-feuilles : 3 abaisses de feuilletage caramélisé (sucre glace,
--     200 °C sous plaque). Un lancement = 3 feuilles 60x40 -> 40 pièces.
--   * Macarons : UNE base « Coque de macaron » (meringue italienne) + une
--     recette par parfum, car les garnitures diffèrent (ganache noire, crème
--     citron maison, ganache framboise, ivoire+pistache, ivoire+vanille).
--     Tapis 70 empreintes = 70 coques = 35 macarons par fournée.
--   * Crème citron : l''ingrédient « Crème citron » (produit acheté) est ignoré
--     — vraie base maison jaunes/sucre/citron/beurre. Le citron est pesé en
--     fruit entier (jus + zestes pressés au labo).
--   * Fraisier : individuel (15 DH), cadre 60x40x4,5 -> 70 pièces, mousseline
--     vanille + fraises fraîches + pâte d''amande.
--
-- ─── SANITY COÛT (calculé sur v_recipe_total_cost avant livraison) ───
--   Tous les produits tombent dans le couloir 20-40 % du prix de vente, SAUF
--   les macarons (13-20 %), et c''est assumé : les pesées sont justes (coque de
--   12 g × 2 + 10 g de garniture = macaron de 24 g), c''est le prix de vente de
--   7,50 DH la pièce qui marge fort — c''est la norme du produit. Les parfums
--   framboise et pistache remontent naturellement (purée et pistache chères).
--   Le fraisier est ajusté à 46 g de fraises par pièce (fraise de saison à
--   15 DH/kg) : c''est le ratio d''un vrai fraisier, pas un rattrapage de coût.
--
-- ─── INGRÉDIENTS CRÉÉS (PRIX À VALIDER) ───
--   * Pâte de pistache pure 260 DH/kg — l''existant « Pâte de pistache » est
--     costé 0 (inutilisable pour un coût de revient), on n''y touche pas.
--   * Biscuits Oreo miettes 90 DH/kg — l''existant « Oreo » est un article à
--     l''unité (paquet), inadapté à une pesée en grammes.
--
-- ─── DÉPENDANCE : « Crème pâtissière chocolat » VIENT DE LA MIG 282 ───
--   Les mille-feuilles chocolat et les éclairs chocolat consomment cette crème.
--   La mig 282 (viennoiseries) la crée déjà sous
--   `fab28200-…-000000000104` (1150 g, 150 g de couverture 55 % sur 1000 g de
--   pâtissière transversale). Deux fiches identiques pollueraient la liste des
--   recettes du chef : cette migration NE la recrée PAS et la résout par nom
--   dans `_p285_rec`. Conséquence : la 282 doit être appliquée AVANT la 285
--   (l'ordre numérique des migrations le garantit), sinon le garde-fou de
--   l'étape 6 échoue avec « 23 trouvée(s) sur 24 attendues ».
--
-- ─── PIÈGE : FICHES ARCHIVÉES HOMONYMES ───
--   Le référentiel porte d'anciennes recettes archivées portant le nom des
--   bases transversales (« Crème pâtissière » 089eac36). Toute résolution par
--   nom filtre donc `archived_at IS NULL` — sans quoi le JOIN se ferait
--   silencieusement sur une fiche morte au rendement différent.
--
-- PORTEE
--   + 2 ingrédients créés si absents (WHERE NOT EXISTS)
--   + 12 bases familiales (fab28500-…-0000000001[01-13], 106 non utilisé :
--     mutualisé avec la mig 282) + 58 lignes recipe_ingredients
--     + 2 liens recipe_sub_recipes
--   + 25 produits finis (fab28500-…-0000000001[21-45]) à product_id lié
--   + 26 recipe_formats (fab28500-…-0000000002[01-26]) + 98 composants
--   + miroirs recipe_components (formats par défaut) + étapes sur 5 fiches
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes, DELETE+INSERT sur
--   les compositions, garde-fous DO $$ sur toutes les résolutions par nom.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28500%';  -- cascade formats,
--     composants, miroirs, recipe_ingredients, recipe_sub_recipes
--   DELETE FROM ingredients WHERE name IN ('Pâte de pistache pure','Biscuits Oreo miettes')
--     AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id)
--     AND NOT EXISTS (SELECT 1 FROM recipe_format_components c WHERE c.source_ingredient_id = ingredients.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Préalable. Homonymes actifs des bases du catalogue : archivage.
--   Les résolutions par nom de cette migration (et des suivantes, jusqu'à la
--   290 qui refuse tout doublon de base active) supposent UNE seule base
--   active par nom. Or la prod porte encore d'anciennes fiches « maison »
--   homonymes des bases posées par les migs 273/276/280-290 : « Crème
--   pâtissière » 089eac36 a été archivée à la main en local, mais elle était
--   toujours active en prod -> « introuvable ou ambiguë (2) » au déploiement.
--   On archive ici tout homonyme actif qui n'est PAS une base du catalogue
--   (UUID fixes fab2xxxx-… / 0be7a000-…) : l'historique de production qui le
--   référence reste intact (archivage, pas suppression), la fiche reste
--   restaurable, et la base du catalogue devient la seule cible des
--   nomenclatures. Idempotent : no-op quand il n'y a aucun homonyme.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE z TEXT;
BEGIN
  WITH cat AS (
    SELECT DISTINCT name FROM recipes
     WHERE is_base AND archived_at IS NULL
       AND (id::text LIKE 'fab2____-0000-4000-8000-%' OR id::text LIKE '0be7a000-0000-4000-8000-%')
  ), arch AS (
    UPDATE recipes r
       SET archived_at = now(), updated_at = now()
     WHERE r.is_base AND r.archived_at IS NULL
       AND r.name IN (SELECT name FROM cat)
       AND NOT (r.id::text LIKE 'fab2____-0000-4000-8000-%' OR r.id::text LIKE '0be7a000-0000-4000-8000-%')
    RETURNING r.name, r.id
  )
  SELECT string_agg(name || ' (' || left(id::text, 8) || ')', ', ' ORDER BY name) INTO z FROM arch;
  IF z IS NOT NULL THEN
    RAISE NOTICE 'Mig 285 : homonymes de bases du catalogue archivés -> %', z;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingrédients manquants au référentiel.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT v.name, v.unit, v.cost, v.cat
FROM (VALUES
  ('Pâte de pistache pure',  'kg', 260.00::numeric, 'fruits_secs'), -- PRIX À VALIDER
  ('Biscuits Oreo miettes',  'kg',  90.00,          'decors')       -- PRIX À VALIDER
) AS v (name, unit, cost, cat)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Résolution des ingrédients (doublons arbitrés par usage réel, mig 273).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _p285_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande poudre extra fine', 'Sucre glace', 'Blancs d''œufs liquides pasteurisés',
  'Sucre semoule', 'Eau', 'Oeufs Jaune', 'Citron', 'Beurre', 'Chocolat Blanc 30%',
  'Purée framboises', 'Praliné amande 50%', 'Vanille poudre',
  'Chocolat de couverture Noir 55%', 'Oeufs entiers liquides', 'Farine Fleur',
  'Trimoline sucre inverti', 'Cacao en poudre 10/12', 'Lait', 'Levure chimique',
  'Sel de table fin', 'Carotte', 'SUCRE CASSONADE', 'Huile de table',
  'Noix décortiquées', 'Cannelle moulue', 'Biscuits Oreo miettes', 'Crème cheese',
  'Chocolat de couverture Lait 33%', 'Amande concassée', 'Fondant pâtissier',
  'Colorant hydrosoluble Rouge Fraise', 'Amande effilée', 'Fraise',
  'Pâte d''amande 50%', 'Nappage neutre', 'Kiwi', 'Framboises',
  'Pâte de pistache pure', 'Pistache décortiquée'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _p285_ing;
  IF n <> 39 THEN
    RAISE EXCEPTION 'Ingrédients introuvables : % trouvé(s) sur 39 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Les 12 bases familiales.
--    yield_quantity = pesée CRUE, perte_standard_pct = perte de transformation.
--      Coque de macaron        1195 g − 15 % = 1015,8 g  (croûtage + cuisson 145 °C)
--      Crème citron maison     1250 g −  8 % = 1150,0 g  (évaporation à la cuisson)
--      Ganache framboise        550 g −  2 % =  539,0 g  (émulsion)
--      Mousseline pralinée     1350 g −  2 % = 1323,0 g  (foisonnement/parois)
--      Mousseline vanille      1354 g −  2 % = 1327,0 g
--      Biscuit roulé           1050 g − 12 % =  924,0 g  (cuisson 6 min à 210 °C)
--      Appareil cake am. choc. 1325 g − 10 % = 1192,5 g  (cuisson 160 °C 50 min)
--      Appareil cake carotte   1453 g − 10 % = 1307,7 g
--      Appareil cake Oreo      1315 g − 10 % = 1183,5 g
--      Glaçage cream cheese     752 g −  2 % =  737,0 g
--      Glaçage rocher           560 g −  2 % =  548,8 g
--      Appareil fondant choc.  1220 g −  8 % = 1122,4 g  (cuisson courte 200 °C)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id::uuid, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production'), v.notes
FROM (VALUES
  ('fab28500-0000-4000-8000-000000000101', 'Coque de macaron',               1195::numeric, 15::numeric,
   'Meringue italienne : sucre cuit à 118 °C sur les premiers blancs. Tant-pour-tant amande extra fine/sucre glace tamisé 2 fois avec les seconds blancs. Macaronnage au ruban. Croûtage 30 min, four 145 °C 13-14 min. Colorant selon parfum, ajouté dans la meringue. Coques nues : 5 jours à −18 °C. Allergènes : amande, œuf.'),
  ('fab28500-0000-4000-8000-000000000102', 'Crème citron maison',            1250,  8,
   'Jaunes + sucre blanchis, citron pressé au labo (jus + zestes, pesé en fruit entier), cuire à 83 °C en fouettant. Beurre à 40 °C au mixeur plongeant. J+3 à +4 °C, filmé au contact. Allergènes : œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000103', 'Ganache framboise',               550,  2,
   'Purée framboise à 60 °C versée en 3 fois sur l''ivoire fondu, beurre en finition. Cristallisation 12 h à 16 °C avant pochage. Allergènes : lait, soja (lécithine).'),
  ('fab28500-0000-4000-8000-000000000104', 'Crème mousseline pralinée',      1350,  2,
   'Crème pâtissière lissée à 20 °C, beurre pommade foisonné, praliné amande en dernier. Utiliser aussitôt (pochage mille-feuille). Allergènes : lait, œuf, amande, gluten.'),
  ('fab28500-0000-4000-8000-000000000105', 'Crème mousseline vanille',       1354,  2,
   'Crème pâtissière lissée + beurre pommade foisonné 5 min, vanille poudre. Tenir à 20-22 °C pour le montage (elle tranche à froid). Allergènes : lait, œuf, gluten.'),
  ('fab28500-0000-4000-8000-000000000107', 'Biscuit roulé',                  1050, 12,
   'Œufs + jaunes + sucre montés au ruban, trimoline pour la souplesse, farine à la maryse. Étaler à 5 mm sur tapis, 210 °C 6 min : le biscuit doit rester roulable. Rouler tiède dans un torchon humide. Allergènes : gluten, œuf.'),
  ('fab28500-0000-4000-8000-000000000108', 'Appareil cake américain chocolat', 1325, 10,
   'Beurre-sucre crémés, œufs un à un, poudres tamisées en alternance avec le lait. Moule chemisé, cuisson 160 °C ~50 min (lame sèche). Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000109', 'Appareil cake carotte',          1453, 10,
   'Carottes râpées fin, huile (pas de beurre : moelleux 5 jours), cassonade, noix concassées. Cuisson 160 °C ~55 min. Allergènes : gluten, œuf, noix.'),
  ('fab28500-0000-4000-8000-000000000110', 'Appareil cake Oreo',             1315, 10,
   'Appareil vanille crémé, miettes d''Oreo pliées en dernier (elles teintent si on corne trop). Cuisson 160 °C ~50 min. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000111', 'Glaçage cream cheese',            752,  2,
   'Beurre pommade + sucre glace foisonnés, crème cheese froide en 2 fois — ne pas trop battre (il se liquéfie). Pochage douille cannelée. J+3 à +4 °C. Allergènes : lait.'),
  ('fab28500-0000-4000-8000-000000000112', 'Glaçage rocher',                  560,  2,
   'Couverture lait fondue à 45 °C + huile, amandes concassées torréfiées 150 °C 15 min. Utiliser à 30-32 °C sur cake congelé. Allergènes : lait, amande, soja.'),
  ('fab28500-0000-4000-8000-000000000113', 'Appareil fondant chocolat',      1220,  8,
   'Chocolat-beurre fondus à 45 °C, œufs + sucre à peine blanchis (pas de ruban : le fondant doit rester dense), farine minimum. Cuisson 200 °C 9-10 min : cœur coulant. Allergènes : gluten, œuf, lait, soja.')
) AS v (id, nom, yield, perte, notes)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Compositions des bases (DELETE + INSERT, rejouable).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28500-0000-4000-8000-0000000001%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid::uuid, ing.id, v.qte, 'g'
FROM (VALUES
  -- Coque de macaron — 1195 g crue (meringue italienne)
  ('fab28500-0000-4000-8000-000000000101', 'Amande poudre extra fine',            300::numeric),
  ('fab28500-0000-4000-8000-000000000101', 'Sucre glace',                         300),
  ('fab28500-0000-4000-8000-000000000101', 'Blancs d''œufs liquides pasteurisés', 220),
  ('fab28500-0000-4000-8000-000000000101', 'Sucre semoule',                       300),
  ('fab28500-0000-4000-8000-000000000101', 'Eau',                                  75),
  -- Crème citron maison — 1250 g crue
  ('fab28500-0000-4000-8000-000000000102', 'Oeufs Jaune',                         300),
  ('fab28500-0000-4000-8000-000000000102', 'Sucre semoule',                       300),
  ('fab28500-0000-4000-8000-000000000102', 'Citron',                              350),
  ('fab28500-0000-4000-8000-000000000102', 'Beurre',                              300),
  -- Ganache framboise — 550 g crue
  ('fab28500-0000-4000-8000-000000000103', 'Chocolat Blanc 30%',                  300),
  ('fab28500-0000-4000-8000-000000000103', 'Purée framboises',                    220),
  ('fab28500-0000-4000-8000-000000000103', 'Beurre',                               30),
  -- Crème mousseline pralinée — 1350 g crue (complément : recipe_sub_recipes)
  ('fab28500-0000-4000-8000-000000000104', 'Beurre',                              300),
  ('fab28500-0000-4000-8000-000000000104', 'Praliné amande 50%',                  250),
  -- Crème mousseline vanille — 1354 g crue (complément : recipe_sub_recipes)
  ('fab28500-0000-4000-8000-000000000105', 'Beurre',                              350),
  ('fab28500-0000-4000-8000-000000000105', 'Vanille poudre',                        4),
  -- Biscuit roulé — 1050 g crue
  ('fab28500-0000-4000-8000-000000000107', 'Oeufs entiers liquides',              450),
  ('fab28500-0000-4000-8000-000000000107', 'Oeufs Jaune',                         100),
  ('fab28500-0000-4000-8000-000000000107', 'Sucre semoule',                       250),
  ('fab28500-0000-4000-8000-000000000107', 'Farine Fleur',                        220),
  ('fab28500-0000-4000-8000-000000000107', 'Trimoline sucre inverti',              30),
  -- Appareil cake américain chocolat — 1325 g crue
  ('fab28500-0000-4000-8000-000000000108', 'Farine Fleur',                        300),
  ('fab28500-0000-4000-8000-000000000108', 'Sucre semoule',                       320),
  ('fab28500-0000-4000-8000-000000000108', 'Cacao en poudre 10/12',                80),
  ('fab28500-0000-4000-8000-000000000108', 'Oeufs entiers liquides',              250),
  ('fab28500-0000-4000-8000-000000000108', 'Beurre',                              220),
  ('fab28500-0000-4000-8000-000000000108', 'Lait',                                140),
  ('fab28500-0000-4000-8000-000000000108', 'Levure chimique',                      12),
  ('fab28500-0000-4000-8000-000000000108', 'Sel de table fin',                      3),
  -- Appareil cake carotte — 1453 g crue
  ('fab28500-0000-4000-8000-000000000109', 'Carotte',                             350),
  ('fab28500-0000-4000-8000-000000000109', 'Farine Fleur',                        300),
  ('fab28500-0000-4000-8000-000000000109', 'SUCRE CASSONADE',                     250),
  ('fab28500-0000-4000-8000-000000000109', 'Oeufs entiers liquides',              250),
  ('fab28500-0000-4000-8000-000000000109', 'Huile de table',                      200),
  ('fab28500-0000-4000-8000-000000000109', 'Noix décortiquées',                    80),
  ('fab28500-0000-4000-8000-000000000109', 'Cannelle moulue',                       8),
  ('fab28500-0000-4000-8000-000000000109', 'Levure chimique',                      12),
  ('fab28500-0000-4000-8000-000000000109', 'Sel de table fin',                      3),
  -- Appareil cake Oreo — 1315 g crue
  ('fab28500-0000-4000-8000-000000000110', 'Farine Fleur',                        300),
  ('fab28500-0000-4000-8000-000000000110', 'Sucre semoule',                       250),
  ('fab28500-0000-4000-8000-000000000110', 'Beurre',                              220),
  ('fab28500-0000-4000-8000-000000000110', 'Oeufs entiers liquides',              250),
  ('fab28500-0000-4000-8000-000000000110', 'Lait',                                130),
  ('fab28500-0000-4000-8000-000000000110', 'Biscuits Oreo miettes',               150),
  ('fab28500-0000-4000-8000-000000000110', 'Levure chimique',                      12),
  ('fab28500-0000-4000-8000-000000000110', 'Sel de table fin',                      3),
  -- Glaçage cream cheese — 752 g crue
  ('fab28500-0000-4000-8000-000000000111', 'Crème cheese',                        400),
  ('fab28500-0000-4000-8000-000000000111', 'Beurre',                              150),
  ('fab28500-0000-4000-8000-000000000111', 'Sucre glace',                         200),
  ('fab28500-0000-4000-8000-000000000111', 'Vanille poudre',                        2),
  -- Glaçage rocher — 560 g crue
  ('fab28500-0000-4000-8000-000000000112', 'Chocolat de couverture Lait 33%',     400),
  ('fab28500-0000-4000-8000-000000000112', 'Huile de table',                       40),
  ('fab28500-0000-4000-8000-000000000112', 'Amande concassée',                    120),
  -- Appareil fondant chocolat — 1220 g crue
  ('fab28500-0000-4000-8000-000000000113', 'Chocolat de couverture Noir 55%',     250),
  ('fab28500-0000-4000-8000-000000000113', 'Beurre',                              250),
  ('fab28500-0000-4000-8000-000000000113', 'Oeufs entiers liquides',              300),
  ('fab28500-0000-4000-8000-000000000113', 'Sucre semoule',                       300),
  ('fab28500-0000-4000-8000-000000000113', 'Farine Fleur',                        120)
) AS v (rid, ingredient, qte)
JOIN _p285_ing ing ON ing.name = v.ingredient;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_ingredients
   WHERE recipe_id::text LIKE 'fab28500-0000-4000-8000-0000000001%';
  IF n <> 58 THEN
    RAISE EXCEPTION 'Compositions de bases incomplètes : % ligne(s) sur 58 attendues', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bases composées de bases : les 2 mousselines consomment la
--    Crème pâtissière transversale (mig 280, quantity = g de pesée crue).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipes WHERE name = 'Crème pâtissière' AND is_base AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Base transversale « Crème pâtissière » introuvable ou ambiguë (%)', n;
  END IF;
END $$;

INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity)
SELECT v.rid::uuid, r.id, v.qte
FROM (VALUES
  ('fab28500-0000-4000-8000-000000000104',  800::numeric),  -- Mousseline pralinée
  ('fab28500-0000-4000-8000-000000000105', 1000)            -- Mousseline vanille
) AS v (rid, qte)
JOIN recipes r ON r.name = 'Crème pâtissière' AND r.is_base AND r.archived_at IS NULL
ON CONFLICT (recipe_id, sub_recipe_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 25 produits finis (mode_cout = compose).
--    yield_quantity = nb de pièces du format par défaut.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id, instructions)
SELECT v.id::uuid, v.nom, false, 'compose', v.pieces, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'patisserie'),
       v.pid::uuid, v.notes
FROM (VALUES
  ('fab28500-0000-4000-8000-000000000121', 'Éclair vanille',          20::numeric, '3fd25b91-af86-4f5e-a9c3-d0aea963621a',
   'Rendement : 20 éclairs/plaque 60x40 (65 g de pâte crue pochée -> 47 g net cuit). J+1 à +4 °C. Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000122', 'Éclair chocolat',         20, '2053637d-2ea9-4e23-a063-95537e1609c2',
   'Rendement : 20 éclairs/plaque. Fondant chocolaté à 37 °C max. J+1 à +4 °C. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000123', 'Éclair framboise',        20, '84437272-487d-48e0-b697-174d421c0935',
   'Rendement : 20 éclairs/plaque. Diplomate + cœur de purée framboise, fondant rosé. J+1 à +4 °C. Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000124', 'Mille-feuille',           40, 'ff86024e-9358-4ea8-ba00-93da15bdadd2',
   'Rendement : 3 feuilles 60x40 caramélisées -> 40 pièces 4x12 cm. Monter au plus près de la vente (croustillant 6 h). Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000125', 'Mille-feuille chocolat',  40, '73fa7fd9-fd77-4305-acf0-52f1190d0583',
   'Rendement : 40 pièces. Crème pâtissière chocolat, glaçage fondant cacao. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000126', 'Mille-feuille praliné',   40, '2915a5b1-792b-4ac6-9ed0-560895e60007',
   'Rendement : 40 pièces. Mousseline pralinée, amandes effilées torréfiées sur les flancs. Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000127', 'Fraisier',                70, 'd4a705d8-48c9-4e7a-9db4-a94cdb926832',
   'Rendement : cadre 60x40x4,5 -> 70 individuels ~142 g. Fraises de saison. J+2 à +4 °C, pas de congélation (fraise fraîche). Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000128', 'Tarte aux amandes',        1, 'a362c6b4-87b5-4722-9d4e-a3a1498cac63',
   'Tartelette Ø10, crème d''amande cuite 170 °C 18 min, amandes effilées, nappage. J+2. Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000129', 'Tarte aux fruits',         1, '945ed452-9a49-4915-90c0-91401a12ee59',
   'Tartelette Ø10, fond amande + diplomate + fruits frais (fraise, kiwi, framboise), nappage neutre. Jour même. Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000130', 'Tarte chocolat',           1, '3dc593a5-9de7-455d-a8d0-2302c9f89374',
   'Tartelette Ø8, ganache noire coulée à 35 °C, voile de cacao. J+3 à +4 °C. Allergènes : gluten, œuf, lait, soja, amande.'),
  ('fab28500-0000-4000-8000-000000000131', 'Tarte citron',             1, '3a264285-8633-475a-b79d-295f67777b2a',
   'Tartelette Ø10, crème citron maison, pointes de meringue. J+2 à +4 °C. Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000132', 'Tarte framboise',          1, 'bd4f3bde-88bf-4b96-b797-dba5248bcbcc',
   'Tartelette Ø10, fond amande cuit + framboises fraîches, nappage. Jour même. Allergènes : gluten, œuf, lait, amande.'),
  ('fab28500-0000-4000-8000-000000000133', 'Fondant chocolat',        12, '6bbf6f37-554e-44a6-824c-a924665dfa99',
   'Rendement : 12 fondants/plaque muffins. Servir tiède ou regénérer 20 s micro-ondes. J+2. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000134', 'Cake américain chocolat',  8, 'd3be1cd8-be09-45e3-8e42-c59b411bd591',
   'Rendement : moule 25 cm -> 8 tranches. Ganache noire nappée après refroidissement complet. J+5 filmé. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000135', 'Cake carotte',             8, 'fb64a82b-52ed-42f5-b75c-d75f3e3df87d',
   'Rendement : moule 25 cm -> 8 tranches. Glaçage cream cheese poché à froid, noix. J+4 à +4 °C. Allergènes : gluten, œuf, lait, noix.'),
  ('fab28500-0000-4000-8000-000000000136', 'Cake Oreo',                8, 'b3078c1b-f252-40b2-be3d-f238f6ed6b06',
   'Rendement : moule 25 cm -> 8 tranches. Ganache montée ivoire + miettes d''Oreo. J+4 à +4 °C. Allergènes : gluten, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000137', 'Cake rocher',             12, '4b0e0b05-dda3-4c4a-8913-1025b510cdd2',
   'Rendement : moule slim 30 cm -> 12 tranches. Glaçage rocher coulé à 30 °C sur cake congelé, trancher après reprise. J+5. Allergènes : gluten, œuf, lait, amande, soja.'),
  ('fab28500-0000-4000-8000-000000000138', 'Roulé citron',            16, '624ad2c3-97c1-4d1e-ae76-0760cf798fb6',
   'Rendement : 1 biscuit 60x40 roulé -> 16 tranches. Rouler le biscuit tiède, garnir froid. J+2 à +4 °C. Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000139', 'Tranche citron',          12, 'e4b47ec8-2a30-4757-9e77-5453d6b52948',
   'Rendement : cadre bande 60x10x4,5 -> 12 tranches. Génoise imbibée + crème citron maison, nappage, meringue. J+2 à +4 °C. Allergènes : gluten, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000140', 'Macaron chocolat',        35, '1c504806-f5c2-4beb-a11f-b01962db20a6',
   'Rendement : tapis 70 empreintes -> 35 macarons ~24 g. Maturation 24 h à +4 °C avant vente (obligatoire). J+5. Allergènes : amande, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000141', 'Macaron citron',          35, '7125f9be-3d33-421a-906e-b6df4dfed410',
   'Rendement : 35 macarons/tapis. Garniture ivoire + crème citron maison. Maturation 24 h. J+4. Allergènes : amande, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000142', 'Macaron framboise',       35, 'e4df4e40-1377-4369-bff5-d520f32f562b',
   'Rendement : 35 macarons/tapis. Ganache framboise. Maturation 24 h. J+4. Allergènes : amande, œuf, lait, soja.'),
  ('fab28500-0000-4000-8000-000000000143', 'Macaron pistache',        35, '4dceba95-204e-4c2f-a1db-25d43fc59533',
   'Rendement : 35 macarons/tapis. Ivoire montée + pâte de pistache pure, éclats de pistache. Maturation 24 h. J+4. Allergènes : amande, pistache, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000144', 'Macaron vanille',         35, '637ec972-7757-4e63-b006-dbab533bb8b3',
   'Rendement : 35 macarons/tapis. Ivoire montée vanille. Maturation 24 h. J+4. Le format « au comptoir » (contenant libre) porte le produit POS générique MACARON. Allergènes : amande, œuf, lait.'),
  ('fab28500-0000-4000-8000-000000000145', 'Coffret 6 macarons',       1, '41fd255a-6122-46ff-af94-fb9ff2d30ca8',
   'Boîte de 6 macarons assortis (chocolat, vanille, citron, framboise, pistache). Composé depuis les mêmes bases que les macarons à la pièce ; coût boîte porté par le format (2 DH). J+4 à +4 °C. Allergènes : amande, pistache, œuf, lait, soja.')
) AS v (id, nom, pieces, pid, notes)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Résolution des recettes sources des nomenclatures (bases transversales
--    mig 280 + famille Opéra + mig 282 + bases de cette migration), par nom.
--
--    `archived_at IS NULL` est INDISPENSABLE : le référentiel porte d'anciennes
--    fiches archivées homonymes (« Crème pâtissière » 089eac36 coexiste avec la
--    base transversale de la mig 280). Sans le filtre, le garde-fou « nom en
--    doublon » saute — ou pire, la nomenclature se rattache silencieusement à
--    une fiche morte au rendement différent, et tous les coûts dérivent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _p285_rec ON COMMIT DROP AS
SELECT r.name, r.id
FROM recipes r
WHERE r.is_base
  AND r.archived_at IS NULL
  AND r.name IN (
    -- transversales (mig 280) + Ganache chocolat noir (famille Opéra)
    'Pâte à choux', 'Crème pâtissière', 'Crème diplomate', 'Pâte sucrée',
    'Pâte feuilletée', 'Crème d''amande', 'Génoise nature', 'Sirop à 30°B',
    'Meringue française', 'Ganache chocolat noir', 'Ganache montée ivoire',
    -- mig 282 (viennoiseries) : mutualisée, PAS recréée ici
    'Crème pâtissière chocolat',
    -- bases de cette migration
    'Coque de macaron', 'Crème citron maison', 'Ganache framboise',
    'Crème mousseline pralinée', 'Crème mousseline vanille', 'Biscuit roulé',
    'Appareil cake américain chocolat', 'Appareil cake carotte',
    'Appareil cake Oreo', 'Glaçage cream cheese', 'Glaçage rocher',
    'Appareil fondant chocolat'
  );

DO $$
DECLARE n INT; dup INT;
BEGIN
  SELECT count(*) INTO n FROM _p285_rec;
  IF n <> 24 THEN
    RAISE EXCEPTION 'Recettes sources introuvables : % trouvée(s) sur 24 attendues', n;
  END IF;
  SELECT count(*) INTO dup FROM (SELECT name FROM _p285_rec GROUP BY name HAVING count(*) > 1) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Recettes sources ambiguës : % nom(s) en doublon', dup;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Les 26 formats. nb_par_defaut = pièces vendables du contenant,
--    quantite_par_format = poids NET d''une pièce (somme composants / nb).
--    Le produit POS « MACARON » (générique) et le coffret 6 pièces sont des
--    formats sans contenant (vente au comptoir / boîte).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id, cout_emballage_unitaire)
SELECT v.fid::uuid, v.rid::uuid, c.id, v.qpf, 'g', v.nb, v.def, v.ordre,
       v.pid::uuid, v.emb
FROM (VALUES
  ('fab28500-0000-4000-8000-000000000201', 'fab28500-0000-4000-8000-000000000121', 'Plaque de cuisson plate 60x40',      157.00::numeric, 20, true,  1, '3fd25b91-af86-4f5e-a9c3-d0aea963621a', 0::numeric),
  ('fab28500-0000-4000-8000-000000000202', 'fab28500-0000-4000-8000-000000000122', 'Plaque de cuisson plate 60x40',      157.00, 20, true,  1, '2053637d-2ea9-4e23-a063-95537e1609c2', 0),
  ('fab28500-0000-4000-8000-000000000203', 'fab28500-0000-4000-8000-000000000123', 'Plaque de cuisson plate 60x40',      156.60, 20, true,  1, '84437272-487d-48e0-b697-174d421c0935', 0),
  ('fab28500-0000-4000-8000-000000000204', 'fab28500-0000-4000-8000-000000000124', 'Plaque de cuisson plate 60x40',      158.50, 40, true,  1, 'ff86024e-9358-4ea8-ba00-93da15bdadd2', 0),
  ('fab28500-0000-4000-8000-000000000205', 'fab28500-0000-4000-8000-000000000125', 'Plaque de cuisson plate 60x40',      158.50, 40, true,  1, '73fa7fd9-fd77-4305-acf0-52f1190d0583', 0),
  ('fab28500-0000-4000-8000-000000000206', 'fab28500-0000-4000-8000-000000000126', 'Plaque de cuisson plate 60x40',      158.50, 40, true,  1, '2915a5b1-792b-4ac6-9ed0-560895e60007', 0),
  ('fab28500-0000-4000-8000-000000000207', 'fab28500-0000-4000-8000-000000000127', 'Cadre entremets 60x40x4,5 cm',       142.29, 70, true,  1, 'd4a705d8-48c9-4e7a-9db4-a94cdb926832', 0),
  ('fab28500-0000-4000-8000-000000000208', 'fab28500-0000-4000-8000-000000000128', 'Cercle à tartelette Ø10 cm',          95.00,  1, true,  1, 'a362c6b4-87b5-4722-9d4e-a3a1498cac63', 0),
  ('fab28500-0000-4000-8000-000000000209', 'fab28500-0000-4000-8000-000000000129', 'Cercle à tartelette Ø10 cm',         149.00,  1, true,  1, '945ed452-9a49-4915-90c0-91401a12ee59', 0),
  ('fab28500-0000-4000-8000-000000000210', 'fab28500-0000-4000-8000-000000000130', 'Cercle à tartelette Ø8 cm',           79.00,  1, true,  1, '3dc593a5-9de7-455d-a8d0-2302c9f89374', 0),
  ('fab28500-0000-4000-8000-000000000211', 'fab28500-0000-4000-8000-000000000131', 'Cercle à tartelette Ø10 cm',         117.00,  1, true,  1, '3a264285-8633-475a-b79d-295f67777b2a', 0),
  ('fab28500-0000-4000-8000-000000000212', 'fab28500-0000-4000-8000-000000000132', 'Cercle à tartelette Ø10 cm',          93.00,  1, true,  1, 'bd4f3bde-88bf-4b96-b797-dba5248bcbcc', 0),
  ('fab28500-0000-4000-8000-000000000213', 'fab28500-0000-4000-8000-000000000133', 'Plaque à muffins gros (12)',          91.00, 12, true,  1, '6bbf6f37-554e-44a6-824c-a924665dfa99', 0),
  ('fab28500-0000-4000-8000-000000000214', 'fab28500-0000-4000-8000-000000000134', 'Moule à cake 25 cm',                 167.50,  8, true,  1, 'd3be1cd8-be09-45e3-8e42-c59b411bd591', 0),
  ('fab28500-0000-4000-8000-000000000215', 'fab28500-0000-4000-8000-000000000135', 'Moule à cake 25 cm',                 178.75,  8, true,  1, 'fb64a82b-52ed-42f5-b75c-d75f3e3df87d', 0),
  ('fab28500-0000-4000-8000-000000000216', 'fab28500-0000-4000-8000-000000000136', 'Moule à cake 25 cm',                 173.75,  8, true,  1, 'b3078c1b-f252-40b2-be3d-f238f6ed6b06', 0),
  ('fab28500-0000-4000-8000-000000000217', 'fab28500-0000-4000-8000-000000000137', 'Moule à cake slim 30 cm',             60.00, 12, true,  1, '4b0e0b05-dda3-4c4a-8913-1025b510cdd2', 0),
  ('fab28500-0000-4000-8000-000000000218', 'fab28500-0000-4000-8000-000000000138', 'Plaque de cuisson plate 60x40',      107.50, 16, true,  1, '624ad2c3-97c1-4d1e-ae76-0760cf798fb6', 0),
  ('fab28500-0000-4000-8000-000000000219', 'fab28500-0000-4000-8000-000000000139', 'Cadre bande 60x10x4,5 cm',           155.00, 12, true,  1, 'e4b47ec8-2a30-4757-9e77-5453d6b52948', 0),
  ('fab28500-0000-4000-8000-000000000220', 'fab28500-0000-4000-8000-000000000140', 'Tapis silicone macarons 60x40 (70)',  24.00, 35, true,  1, '1c504806-f5c2-4beb-a11f-b01962db20a6', 0),
  ('fab28500-0000-4000-8000-000000000221', 'fab28500-0000-4000-8000-000000000141', 'Tapis silicone macarons 60x40 (70)',  24.00, 35, true,  1, '7125f9be-3d33-421a-906e-b6df4dfed410', 0),
  ('fab28500-0000-4000-8000-000000000222', 'fab28500-0000-4000-8000-000000000142', 'Tapis silicone macarons 60x40 (70)',  24.00, 35, true,  1, 'e4df4e40-1377-4369-bff5-d520f32f562b', 0),
  ('fab28500-0000-4000-8000-000000000223', 'fab28500-0000-4000-8000-000000000143', 'Tapis silicone macarons 60x40 (70)',  24.43, 35, true,  1, '4dceba95-204e-4c2f-a1db-25d43fc59533', 0),
  ('fab28500-0000-4000-8000-000000000224', 'fab28500-0000-4000-8000-000000000144', 'Tapis silicone macarons 60x40 (70)',  23.86, 35, true,  1, '637ec972-7757-4e63-b006-dbab533bb8b3', 0),
  ('fab28500-0000-4000-8000-000000000225', 'fab28500-0000-4000-8000-000000000144', NULL,                                  23.86, 35, false, 2, '7fb7c69f-f6af-449d-8fee-6ff30fe007bb', 0),
  ('fab28500-0000-4000-8000-000000000226', 'fab28500-0000-4000-8000-000000000145', NULL,                                 194.00,  1, true,  1, '41fd255a-6122-46ff-af94-fb9ff2d30ca8', 2.00)
) AS v (fid, rid, contenant, qpf, nb, def, ordre, pid, emb)
LEFT JOIN production_contenants c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- Garde-fou : un contenant nommé mais introuvable donnerait un format « au
-- poids » silencieux au lieu d''échouer.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_formats
   WHERE id::text LIKE 'fab28500-0000-4000-8000-0000000002%' AND contenant_id IS NOT NULL;
  IF n <> 24 THEN
    RAISE EXCEPTION 'Contenants introuvables : % format(s) avec contenant sur 24 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Nomenclatures par format — quantités NETTES pour TOUT le contenant.
--    perte_pct = perte de mise en œuvre (crèmes pochées 3 %, glaçages 5 %,
--    ganaches 2 %, sinon 0), distincte de la perte de transformation des bases.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id::text LIKE 'fab28500-0000-4000-8000-0000000002%';

-- 8a. Composants sous-recettes (60 lignes).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, rec.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Éclair vanille — plaque 20 pcs : 47 g choux + 85 g crème + 25 g fondant
  ('fab28500-0000-4000-8000-000000000201', 'fond',      'Pâte à choux',                     940::numeric, 0::numeric, 1::smallint),
  ('fab28500-0000-4000-8000-000000000201', 'garniture', 'Crème pâtissière',                1700, 3, 2),
  -- Éclair chocolat — plaque 20 pcs
  ('fab28500-0000-4000-8000-000000000202', 'fond',      'Pâte à choux',                     940, 0, 1),
  ('fab28500-0000-4000-8000-000000000202', 'garniture', 'Crème pâtissière chocolat',       1700, 3, 2),
  -- Éclair framboise — plaque 20 pcs
  ('fab28500-0000-4000-8000-000000000203', 'fond',      'Pâte à choux',                     940, 0, 1),
  ('fab28500-0000-4000-8000-000000000203', 'garniture', 'Crème diplomate',                 1500, 3, 2),
  -- Mille-feuille — 3 feuilles 60x40 -> 40 pcs
  ('fab28500-0000-4000-8000-000000000204', 'fond',      'Pâte feuilletée',                 2400, 0, 1),
  ('fab28500-0000-4000-8000-000000000204', 'garniture', 'Crème diplomate',                 3200, 3, 3),
  -- Mille-feuille chocolat
  ('fab28500-0000-4000-8000-000000000205', 'fond',      'Pâte feuilletée',                 2400, 0, 1),
  ('fab28500-0000-4000-8000-000000000205', 'garniture', 'Crème pâtissière chocolat',       3200, 3, 3),
  -- Mille-feuille praliné
  ('fab28500-0000-4000-8000-000000000206', 'fond',      'Pâte feuilletée',                 2400, 0, 1),
  ('fab28500-0000-4000-8000-000000000206', 'garniture', 'Crème mousseline pralinée',       3200, 3, 3),
  -- Fraisier — cadre 60x40x4,5 -> 70 pcs (9 960 g, dont 46 g de fraises/pièce)
  ('fab28500-0000-4000-8000-000000000207', 'biscuit',   'Génoise nature',                  1760, 0, 1),
  ('fab28500-0000-4000-8000-000000000207', 'imbibage',  'Sirop à 30°B',                     800, 0, 2),
  ('fab28500-0000-4000-8000-000000000207', 'garniture', 'Crème mousseline vanille',        3600, 3, 3),
  -- Tarte aux amandes — Ø10
  ('fab28500-0000-4000-8000-000000000208', 'fond',      'Pâte sucrée',                       35, 0, 1),
  ('fab28500-0000-4000-8000-000000000208', 'garniture', 'Crème d''amande',                   50, 3, 2),
  -- Tarte aux fruits — Ø10
  ('fab28500-0000-4000-8000-000000000209', 'fond',      'Pâte sucrée',                       35, 0, 1),
  ('fab28500-0000-4000-8000-000000000209', 'garniture', 'Crème d''amande',                   35, 3, 2),
  ('fab28500-0000-4000-8000-000000000209', 'garniture', 'Crème diplomate',                   25, 3, 3),
  -- Tarte chocolat — Ø8
  ('fab28500-0000-4000-8000-000000000210', 'fond',      'Pâte sucrée',                       28, 0, 1),
  ('fab28500-0000-4000-8000-000000000210', 'garniture', 'Ganache chocolat noir',             50, 2, 2),
  -- Tarte citron — Ø10
  ('fab28500-0000-4000-8000-000000000211', 'fond',      'Pâte sucrée',                       35, 0, 1),
  ('fab28500-0000-4000-8000-000000000211', 'garniture', 'Crème citron maison',               65, 3, 2),
  ('fab28500-0000-4000-8000-000000000211', 'decor',     'Meringue française',                12, 0, 3),
  -- Tarte framboise — Ø10
  ('fab28500-0000-4000-8000-000000000212', 'fond',      'Pâte sucrée',                       35, 0, 1),
  ('fab28500-0000-4000-8000-000000000212', 'garniture', 'Crème d''amande',                   35, 3, 2),
  -- Fondant chocolat — plaque muffins 12 pcs
  ('fab28500-0000-4000-8000-000000000213', 'garniture', 'Appareil fondant chocolat',       1080, 0, 1),
  -- Cake américain chocolat — moule 25 cm, 8 tranches
  ('fab28500-0000-4000-8000-000000000214', 'biscuit',   'Appareil cake américain chocolat', 1100, 0, 1),
  ('fab28500-0000-4000-8000-000000000214', 'glacage',   'Ganache chocolat noir',            240, 2, 2),
  -- Cake carotte — moule 25 cm, 8 tranches
  ('fab28500-0000-4000-8000-000000000215', 'biscuit',   'Appareil cake carotte',           1100, 0, 1),
  ('fab28500-0000-4000-8000-000000000215', 'glacage',   'Glaçage cream cheese',             300, 5, 2),
  -- Cake Oreo — moule 25 cm, 8 tranches
  ('fab28500-0000-4000-8000-000000000216', 'biscuit',   'Appareil cake Oreo',              1100, 0, 1),
  ('fab28500-0000-4000-8000-000000000216', 'glacage',   'Ganache montée ivoire',            250, 2, 2),
  -- Cake rocher — moule slim 30 cm, 12 tranches
  ('fab28500-0000-4000-8000-000000000217', 'biscuit',   'Appareil cake américain chocolat',  620, 0, 1),
  ('fab28500-0000-4000-8000-000000000217', 'glacage',   'Glaçage rocher',                   100, 5, 2),
  -- Roulé citron — biscuit 60x40 -> 16 tranches
  ('fab28500-0000-4000-8000-000000000218', 'biscuit',   'Biscuit roulé',                    900, 0, 1),
  ('fab28500-0000-4000-8000-000000000218', 'garniture', 'Crème citron maison',              800, 3, 2),
  -- Tranche citron — cadre bande 60x10x4,5 -> 12 tranches
  ('fab28500-0000-4000-8000-000000000219', 'biscuit',   'Génoise nature',                   400, 0, 1),
  ('fab28500-0000-4000-8000-000000000219', 'imbibage',  'Sirop à 30°B',                     200, 0, 2),
  ('fab28500-0000-4000-8000-000000000219', 'garniture', 'Crème citron maison',             1100, 3, 3),
  ('fab28500-0000-4000-8000-000000000219', 'decor',     'Meringue française',                60, 0, 5),
  -- Macaron chocolat — tapis 70 coques -> 35 macarons
  ('fab28500-0000-4000-8000-000000000220', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000220', 'garniture', 'Ganache chocolat noir',            350, 2, 2),
  -- Macaron citron
  ('fab28500-0000-4000-8000-000000000221', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000221', 'garniture', 'Ganache montée ivoire',            200, 2, 2),
  ('fab28500-0000-4000-8000-000000000221', 'garniture', 'Crème citron maison',              150, 3, 3),
  -- Macaron framboise
  ('fab28500-0000-4000-8000-000000000222', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000222', 'garniture', 'Ganache framboise',                350, 2, 2),
  -- Macaron pistache
  ('fab28500-0000-4000-8000-000000000223', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000223', 'garniture', 'Ganache montée ivoire',            300, 2, 2),
  -- Macaron vanille (format tapis, par défaut)
  ('fab28500-0000-4000-8000-000000000224', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000224', 'garniture', 'Ganache montée ivoire',            340, 2, 2),
  -- Macaron générique (2e format de Macaron vanille, comptoir)
  ('fab28500-0000-4000-8000-000000000225', 'biscuit',   'Coque de macaron',                 490, 0, 1),
  ('fab28500-0000-4000-8000-000000000225', 'garniture', 'Ganache montée ivoire',            340, 2, 2),
  -- Coffret 6 macarons — 12 coques + garnitures assorties
  ('fab28500-0000-4000-8000-000000000226', 'biscuit',   'Coque de macaron',                  84, 0, 1),
  ('fab28500-0000-4000-8000-000000000226', 'garniture', 'Ganache chocolat noir',             25, 2, 2),
  ('fab28500-0000-4000-8000-000000000226', 'garniture', 'Ganache montée ivoire',             40, 2, 3),
  ('fab28500-0000-4000-8000-000000000226', 'garniture', 'Crème citron maison',               20, 3, 5),
  ('fab28500-0000-4000-8000-000000000226', 'garniture', 'Ganache framboise',                 20, 2, 6)
) AS v (fid, role, source, qte, perte, ordre)
JOIN _p285_rec rec ON rec.name = v.source;

-- 8b. Composants ingrédients directs (38 lignes).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, ing.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Éclairs : glaçage fondant (25 g/pièce, tempéré à 37 °C)
  ('fab28500-0000-4000-8000-000000000201', 'glacage', 'Fondant pâtissier',                   500::numeric, 5::numeric, 3::smallint),
  ('fab28500-0000-4000-8000-000000000202', 'glacage', 'Fondant pâtissier',                   470, 5, 3),
  ('fab28500-0000-4000-8000-000000000202', 'glacage', 'Chocolat de couverture Noir 55%',      30, 5, 4),
  ('fab28500-0000-4000-8000-000000000203', 'fruits',  'Purée framboises',                    200, 0, 3),
  ('fab28500-0000-4000-8000-000000000203', 'glacage', 'Fondant pâtissier',                   490, 5, 4),
  ('fab28500-0000-4000-8000-000000000203', 'glacage', 'Colorant hydrosoluble Rouge Fraise',    2, 0, 5),
  -- Mille-feuilles : caramélisation + glaçage marbré / décors
  ('fab28500-0000-4000-8000-000000000204', 'croustillant', 'Sucre glace',                    100, 0, 2),
  ('fab28500-0000-4000-8000-000000000204', 'glacage',      'Fondant pâtissier',              600, 5, 4),
  ('fab28500-0000-4000-8000-000000000204', 'decor',        'Chocolat de couverture Noir 55%', 40, 5, 5),
  ('fab28500-0000-4000-8000-000000000205', 'croustillant', 'Sucre glace',                    100, 0, 2),
  ('fab28500-0000-4000-8000-000000000205', 'glacage',      'Fondant pâtissier',              560, 5, 4),
  ('fab28500-0000-4000-8000-000000000205', 'decor',        'Cacao en poudre 10/12',           80, 5, 5),
  ('fab28500-0000-4000-8000-000000000206', 'croustillant', 'Sucre glace',                    100, 0, 2),
  ('fab28500-0000-4000-8000-000000000206', 'glacage',      'Fondant pâtissier',              500, 5, 4),
  ('fab28500-0000-4000-8000-000000000206', 'decor',        'Amande effilée',                 140, 0, 5),
  -- Fraisier : fraises fraîches, pâte d''amande, nappage
  ('fab28500-0000-4000-8000-000000000207', 'fruits',  'Fraise',                             3200, 0, 4),
  ('fab28500-0000-4000-8000-000000000207', 'decor',   'Pâte d''amande 50%',                  400, 0, 5),
  ('fab28500-0000-4000-8000-000000000207', 'nappage', 'Nappage neutre',                      200, 0, 6),
  -- Tartes
  ('fab28500-0000-4000-8000-000000000208', 'decor',   'Amande effilée',                        6, 0, 3),
  ('fab28500-0000-4000-8000-000000000208', 'nappage', 'Nappage neutre',                        4, 0, 4),
  ('fab28500-0000-4000-8000-000000000209', 'fruits',  'Fraise',                               25, 0, 4),
  ('fab28500-0000-4000-8000-000000000209', 'fruits',  'Kiwi',                                 15, 0, 5),
  ('fab28500-0000-4000-8000-000000000209', 'fruits',  'Framboises',                            8, 0, 6),
  ('fab28500-0000-4000-8000-000000000209', 'nappage', 'Nappage neutre',                        6, 0, 7),
  ('fab28500-0000-4000-8000-000000000210', 'decor',   'Cacao en poudre 10/12',                 1, 0, 3),
  ('fab28500-0000-4000-8000-000000000211', 'nappage', 'Nappage neutre',                        5, 0, 4),
  ('fab28500-0000-4000-8000-000000000212', 'fruits',  'Framboises',                           18, 0, 3),
  ('fab28500-0000-4000-8000-000000000212', 'nappage', 'Nappage neutre',                        5, 0, 4),
  -- Fondant, cakes, roulé, tranche
  ('fab28500-0000-4000-8000-000000000213', 'decor',   'Sucre glace',                          12, 0, 2),
  ('fab28500-0000-4000-8000-000000000215', 'decor',   'Noix décortiquées',                    30, 0, 3),
  ('fab28500-0000-4000-8000-000000000216', 'decor',   'Biscuits Oreo miettes',                40, 0, 3),
  ('fab28500-0000-4000-8000-000000000218', 'decor',   'Sucre glace',                          20, 0, 3),
  ('fab28500-0000-4000-8000-000000000219', 'nappage', 'Nappage neutre',                      100, 0, 4),
  -- Macarons pistache / vanille
  ('fab28500-0000-4000-8000-000000000223', 'garniture', 'Pâte de pistache pure',              50, 0, 3),
  ('fab28500-0000-4000-8000-000000000223', 'decor',     'Pistache décortiquée',               15, 0, 4),
  ('fab28500-0000-4000-8000-000000000224', 'garniture', 'Vanille poudre',                      5, 0, 3),
  ('fab28500-0000-4000-8000-000000000225', 'garniture', 'Vanille poudre',                      5, 0, 3),
  -- Coffret : part pistache
  ('fab28500-0000-4000-8000-000000000226', 'garniture', 'Pâte de pistache pure',               5, 0, 4)
) AS v (fid, role, ingredient, qte, perte, ordre)
JOIN _p285_ing ing ON ing.name = v.ingredient;

-- Garde-fou : 60 lignes sous-recettes + 38 lignes ingrédients = 98.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_format_components
   WHERE format_id::text LIKE 'fab28500-0000-4000-8000-0000000002%';
  IF n <> 98 THEN
    RAISE EXCEPTION 'Nomenclatures incomplètes : % ligne(s) sur 98 attendues', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Miroir recipe_components = nomenclature du format PAR DÉFAUT (mig 205/218).
--    v_recipe_total_cost passe par ce miroir pour les recettes composées :
--    sans lui, ces 25 produits coûteraient 0.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id::text LIKE 'fab28500-0000-4000-8000-0000000001%';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
WHERE f.id::text LIKE 'fab28500-0000-4000-8000-0000000002%'
  AND f.is_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Étapes de production des 5 fiches phares.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pâte à choux et pochage","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dessécher la panade 2 min : elle doit napper le fond de la casserole",
     "Œufs incorporés progressivement jusqu''au ruban qui retombe en V",
     "Pochage à la douille cannelée 14 mm, bandes de 13 cm — 65 g de pâte crue",
     "La cannelure évite le craquèlement à la cuisson : ne jamais pocher à la douille unie",
     "Cuisson 180 °C, 35 min, tirage fermé — NE PAS OUVRIR le four avant 30 min"]},
  {"ordre":2,"nom":"Garnissage","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Coques parfaitement froides (une coque tiède fait trancher la crème)",
     "3 trous dessous à la douille unie 6 mm",
     "Crème pâtissière lissée au fouet avant pochage — 85 g par éclair",
     "L''éclair doit peser lourd en main : garnir jusqu''au refus"]},
  {"ordre":3,"nom":"Glaçage au fondant","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Fondant à 37 °C MAX (au-delà il perd son brillant), détendu au sirop",
     "Tremper le dessus, lisser au doigt, aucune coulure sur les flancs",
     "Stockage +4 °C, vente J+1 maximum"]}
]'::jsonb
WHERE id = 'fab28500-0000-4000-8000-000000000121';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Feuilletage caramélisé","duree_estimee_min":50,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "Abaisse à 2 mm, piquée au rouleau pique-vite, détente 30 min au froid",
     "Cuisson 170 °C 25 min ENTRE DEUX PLAQUES : le feuilletage monte droit",
     "Saupoudrer de sucre glace, retour four 200 °C 5-6 min sous plaque : caramélisation uniforme, brillante",
     "La feuille doit casser net, sans plier"]},
  {"ordre":2,"nom":"Montage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Diplomate pochée à la douille unie 12 mm en boudins serrés, 3 abaisses par pièce",
     "Presser légèrement avec une plaque entre les couches : planéité de découpe",
     "Découpe au couteau-scie SANS appuyer, mouvement de scie seul"]},
  {"ordre":3,"nom":"Glaçage marbré","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Fondant à 37 °C sur la face supérieure, cornet de chocolat noir en lignes parallèles",
     "Marbrer à la pointe du couteau AVANT que le fondant fige",
     "Monter au plus près de la vente : croustillant garanti 6 h"]}
]'::jsonb
WHERE id = 'fab28500-0000-4000-8000-000000000124';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Fonçage et cuisson à blanc","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâte sucrée abaissée à 2,5 mm, fonçage angles droits, repos 30 min au froid AVANT cuisson",
     "Cuisson à blanc 160 °C 18-20 min, blond uniforme jusqu''au centre",
     "Dorure jaune d''œuf au pinceau, retour four 2 min : imperméabilise le fond"]},
  {"ordre":2,"nom":"Crème citron","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cuire jaunes-sucre-citron à 83 °C en fouettant sans arrêt (au-delà, ça granule)",
     "Beurre incorporé à 40 °C au mixeur plongeant : émulsion brillante",
     "Couler tiède dans les fonds, lisser à ras à la palette"]},
  {"ordre":3,"nom":"Finition","duree_estimee_min":15,"est_bloquante":false,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Prise 1 h à +4 °C avant décor",
     "Pointes de meringue à la douille unie, chalumeau rapide sans brûler",
     "Nappage neutre au pinceau sur la crème nue"]}
]'::jsonb
WHERE id = 'fab28500-0000-4000-8000-000000000131';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Coques : meringue italienne et macaronnage","duree_estimee_min":40,"est_bloquante":true,
   "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Tant-pour-tant amande extra fine/sucre glace tamisé DEUX fois",
     "Sucre cuit à 118 °C versé en filet sur les blancs mi-montés",
     "Meringue redescendue à 40 °C avant l''appareil",
     "Macaronnage à la corne : l''appareil retombe en ruban qui s''efface en 20 s — pas plus"]},
  {"ordre":2,"nom":"Pochage, croûtage, cuisson","duree_estimee_min":60,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pochage douille unie 10 mm sur le tapis 70 empreintes, taper la plaque 2 fois",
     "Croûtage 30 min à l''air libre : la coque ne colle plus au doigt",
     "Four 145 °C, 13-14 min, tirage ouvert — la collerette monte droite et ne rétracte pas",
     "Décoller UNIQUEMENT à froid complet"]},
  {"ordre":3,"nom":"Garnissage et maturation","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ganache ivoire montée souple + vanille, pochée au centre, coques appairées par taille",
     "Fermer en vissant légèrement, la garniture affleure sans déborder",
     "MATURATION 24 h à +4 °C en boîte fermée : c''est elle qui fait le moelleux — jamais de vente jour J"]}
]'::jsonb
WHERE id = 'fab28500-0000-4000-8000-000000000144';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Génoise et mousseline","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Génoise montée au bain-marie à 45 °C puis refroidie au batteur, 2 feuilles 60x40",
     "Mousseline : pâtissière et beurre TOUS DEUX à 20 °C sinon elle tranche",
     "Foisonner 5 min : couleur ivoire clair, texture pommade"]},
  {"ordre":2,"nom":"Montage en cadre","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Fraises calibrées coupées en deux, faces coupées PLAQUÉES contre le rhodoïd",
     "Génoise imbibée au pinceau, mousseline entre et sur les fraises sans bulle d''air",
     "Deuxième génoise pressée à la plaque, prise 2 h à +4 °C"]},
  {"ordre":3,"nom":"Finition et découpe","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâte d''amande étalée à 1,5 mm posée au rouleau, nappage neutre",
     "Découpe 70 parts à la lame chaude essuyée à chaque coupe",
     "Une demi-fraise debout par part, face coupée visible en vitrine"]}
]'::jsonb
WHERE id = 'fab28500-0000-4000-8000-000000000127';
