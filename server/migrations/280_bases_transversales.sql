-- Migration 280 : Préparations de base transversales du laboratoire
--
-- POURQUOI
--   Le catalogue (365 produits) n'a de fiche technique que pour la famille
--   Opéra (mig 273/276). Les migrations 281+ montent les fiches de toutes les
--   familles sur le modèle de l'Opéra ; or une vingtaine de préparations sont
--   partagées entre familles (pâte feuilletée pour jalousies ET mille-feuilles,
--   crème pâtissière pour éclairs ET danish, dacquoise pour entremets ET
--   pâtisserie premium…). On les crée ici, une fois, pour que chaque famille
--   les référence au lieu de les dupliquer.
--
-- ─── CONVENTION RENDEMENT (identique mig 273/276) ───
--   yield_quantity = pesée CRUE, perte_standard_pct = perte de transformation
--   (cuisson, ébullition, émulsion, détaillage). Le net sort du calcul.
--
-- ─── INGRÉDIENTS CRÉÉS (PRIX À VALIDER) ───
--   Maïzena 18 DH/kg, Noisette en poudre 110 DH/kg, Sirop de glucose 25 DH/kg :
--   indispensables aux crèmes, dacquoises et caramels, absents du référentiel.
--
-- PORTEE
--   + 3 ingrédients créés si absents (garde WHERE NOT EXISTS, prix à valider)
--   + 1 UPDATE densité (Lait « lait » doublon sans densité : hors périmètre, on
--     n'y touche pas ; le Lait utilisé ici a déjà densite_kg_l = 1.030)
--   + 26 recettes de base à UUID fixes (fab28000-…-0000000001NN)
--   + recipe_ingredients + 2 liens recipe_sub_recipes (frangipane, diplomate)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID, DELETE+INSERT sur les
--   compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28000%';
--   DELETE FROM ingredients WHERE name IN ('Maïzena','Noisette en poudre','Sirop de glucose')
--     AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingrédients manquants au référentiel.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT v.name, v.unit, v.cost, v.cat
FROM (VALUES
  ('Maïzena',            'kg', 18.00::numeric, 'farines'),     -- PRIX À VALIDER
  ('Noisette en poudre', 'kg', 110.00,         'fruits_secs'), -- PRIX À VALIDER
  ('Sirop de glucose',   'kg', 25.00,          'sucres')       -- PRIX À VALIDER
) AS v (name, unit, cost, cat)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Résolution des ingrédients (doublons arbitrés par usage réel, mig 273).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _b280_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Farine Fleur', 'Farine viennoiserie', 'Eau', 'Sel de table fin',
  'Sucre semoule', 'Sucre glace', 'SUCRE CASSONADE', 'Levure fraîche',
  'Améliorant Viennoiserie', 'Beurre', 'Oeufs entiers liquides', 'Oeufs Jaune',
  'Blancs d''œufs liquides pasteurisés', 'Lait', 'Crème fraîche',
  'Amande poudre', 'Vanille poudre', 'Gélatine en feuille',
  'Trimoline sucre inverti', 'Cacao en poudre 10/12',
  'Chocolat de couverture Noir 55%', 'Chocolat de couverture Lait 33%',
  'Chocolat Blanc 30%', 'Praliné noisette 50%', 'Brisure biscuit Royaltine',
  'Maïzena', 'Noisette en poudre', 'Sirop de glucose'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _b280_ing;
  IF n <> 28 THEN
    RAISE EXCEPTION 'Ingrédients introuvables : % trouvé(s) sur 28 attendus', n;
  END IF;
END $$;

-- Le Lait retenu doit porter sa densité (pesées en g sur un stock en litres).
UPDATE ingredients SET densite_kg_l = 1.030
 WHERE id = (SELECT id FROM _b280_ing WHERE name = 'Lait') AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Les 26 préparations de base.
--    Pesée crue / perte de transformation : cf. commentaire par recette.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id::uuid, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production'), v.notes
FROM (VALUES
  -- Pâtes
  ('fab28000-0000-4000-8000-000000000101', 'Dorure',                        200::numeric,  0::numeric, 'Œufs battus tamisés + pincée de sel. J+2 max au froid.'),
  ('fab28000-0000-4000-8000-000000000102', 'Sirop à 30°B',                 1350,  5, 'Porter à ébullition, refroidir. Base des punchs (café, citron, vanille…). 1 semaine au froid.'),
  ('fab28000-0000-4000-8000-000000000103', 'Pâte feuilletée',              2350,  5, '5 tours simples, repos 30 min entre tours. Perte = rognures de détaillage. 48 h au froid, 3 mois surgelée en pâtons.'),
  ('fab28000-0000-4000-8000-000000000104', 'Pâte levée feuilletée',        2265,  5, 'Pétrissage frasage 4 min + 6 min 2e vitesse, pointage 30 min, tourage 1 double + 1 simple. Détailler à 4 mm.'),
  ('fab28000-0000-4000-8000-000000000105', 'Pâte à brioche',               2190,  3, 'Pétrir 15 min, beurre en 3 fois. Pousse contrôlée une nuit à 4 °C. Allergènes : gluten, œuf, lait.'),
  ('fab28000-0000-4000-8000-000000000106', 'Pâte sucrée',                  1160,  6, 'Sablage beurre-farine, repos 2 h minimum. Foncer à 2,5 mm. Perte = chutes de fonçage.'),
  ('fab28000-0000-4000-8000-000000000107', 'Pâte à choux',                 1470, 28, 'Dessécher la panade 2 min, œufs progressifs jusqu''au ruban. Perte = évaporation à la cuisson 180 °C.'),
  -- Crèmes
  ('fab28000-0000-4000-8000-000000000108', 'Crème pâtissière',             1560,  3, 'Cuire 2 min après ébullition, beurre à 40 °C, refroidir à +4 °C en cellule < 1 h. J+2.'),
  ('fab28000-0000-4000-8000-000000000109', 'Crème d''amande',              1855,  2, 'Beurre pommade, ne pas foisonner (elle gonflerait à la cuisson). J+3 au froid.'),
  ('fab28000-0000-4000-8000-000000000110', 'Frangipane',                   1500,  0, '2/3 crème d''amande + 1/3 crème pâtissière, lissées à la feuille.'),
  ('fab28000-0000-4000-8000-000000000111', 'Crème diplomate',              1310,  2, 'Pâtissière lissée + gélatine fondue + crème montée mousseuse. Utiliser dans l''heure.'),
  ('fab28000-0000-4000-8000-000000000112', 'Crème chantilly',              1060,  2, 'Crème et cuve très froides, serrer au sucre glace en fin. Bec ferme.'),
  ('fab28000-0000-4000-8000-000000000113', 'Crème bavaroise vanille',      1590,  3, 'Anglaise à 83 °C, gélatine, crème montée incorporée à 25 °C. Mouler aussitôt.'),
  -- Biscuits et fonds
  ('fab28000-0000-4000-8000-000000000114', 'Génoise nature',               1000, 12, 'Monter au bain-marie à 45 °C puis refroidir au batteur. Cuisson 180 °C 20-25 min.'),
  ('fab28000-0000-4000-8000-000000000115', 'Génoise cacao',                1000, 12, 'Cacao tamisé avec la farine. Cuisson 180 °C 20-25 min.'),
  ('fab28000-0000-4000-8000-000000000116', 'Biscuit cuillère',             1200, 14, 'Blancs serrés, jaunes à la maryse, dressage poche unie 10. Sucre glace ×2 avant four 190 °C.'),
  ('fab28000-0000-4000-8000-000000000117', 'Dacquoise noisette',           1150, 15, 'Blancs mi-serrés, poudres tamisées à la maryse. 170 °C 18 min, moelleuse à cœur.'),
  ('fab28000-0000-4000-8000-000000000118', 'Meringue française',            900, 30, 'Sucre semoule en 3 fois, sucre glace à la maryse. Sécher 100 °C 2 h. Perte = évaporation.'),
  ('fab28000-0000-4000-8000-000000000119', 'Streusel amande',               800,  5, 'Sablage à la feuille, grille gros trous, cru au surgélateur. Cuisson 160 °C 15 min.'),
  -- Ganaches, mousses, glaçages
  ('fab28000-0000-4000-8000-000000000120', 'Ganache chocolat au lait',     1210,  2, 'Émulsion en 3 fois, mixer sans incorporer d''air. Cristallisation 12 h à 16 °C.'),
  ('fab28000-0000-4000-8000-000000000121', 'Ganache montée ivoire',        1250,  2, 'Crème chaude sur couverture ivoire + gélatine, nuit au froid, monter souple le lendemain.'),
  ('fab28000-0000-4000-8000-000000000122', 'Mousse au chocolat noir',      2065,  3, 'Pâte à bombe 118 °C, chocolat à 45-50 °C, crème mousseuse. Mouler immédiatement.'),
  ('fab28000-0000-4000-8000-000000000123', 'Croustillant praliné feuilletine', 1000, 2, 'Couverture lait fondue dans le praliné, feuilletine en dernier. Étaler entre 2 feuilles guitare.'),
  ('fab28000-0000-4000-8000-000000000124', 'Caramel tendre',               1155, 12, 'Caramel à sec 185 °C, décuire crème chaude, beurre à 40 °C. Perte = évaporation à la décuisson.'),
  ('fab28000-0000-4000-8000-000000000125', 'Glaçage miroir cacao',         1400,  5, 'Cuire eau-sucre-glucose à 103 °C, cacao puis crème, gélatine à 60 °C. Utiliser à 32-35 °C. Mixer sans air.'),
  ('fab28000-0000-4000-8000-000000000126', 'Appareil à flan pâtissier',    1800,  8, 'Porter juste à ébullition en fouettant, couler chaud dans le fond précuit. Perte = évaporation au four.')
) AS v (id, nom, yield, perte, notes)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Compositions (DELETE + INSERT, rejouable).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28000%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid::uuid, ing.id, v.qte, 'g'
FROM (VALUES
  -- Dorure — 200 g
  ('fab28000-0000-4000-8000-000000000101', 'Oeufs entiers liquides',             160::numeric),
  ('fab28000-0000-4000-8000-000000000101', 'Oeufs Jaune',                         38),
  ('fab28000-0000-4000-8000-000000000101', 'Sel de table fin',                     2),
  -- Sirop à 30°B — 1350 g
  ('fab28000-0000-4000-8000-000000000102', 'Eau',                                750),
  ('fab28000-0000-4000-8000-000000000102', 'Sucre semoule',                      600),
  -- Pâte feuilletée — 2350 g
  ('fab28000-0000-4000-8000-000000000103', 'Farine Fleur',                      1000),
  ('fab28000-0000-4000-8000-000000000103', 'Eau',                                480),
  ('fab28000-0000-4000-8000-000000000103', 'Sel de table fin',                    20),
  ('fab28000-0000-4000-8000-000000000103', 'Beurre',                             850),
  -- Pâte levée feuilletée — 2265 g
  ('fab28000-0000-4000-8000-000000000104', 'Farine viennoiserie',               1000),
  ('fab28000-0000-4000-8000-000000000104', 'Eau',                                250),
  ('fab28000-0000-4000-8000-000000000104', 'Lait',                               250),
  ('fab28000-0000-4000-8000-000000000104', 'Sucre semoule',                      120),
  ('fab28000-0000-4000-8000-000000000104', 'Sel de table fin',                    20),
  ('fab28000-0000-4000-8000-000000000104', 'Levure fraîche',                      45),
  ('fab28000-0000-4000-8000-000000000104', 'Améliorant Viennoiserie',             10),
  ('fab28000-0000-4000-8000-000000000104', 'Beurre',                             570),
  -- Pâte à brioche — 2190 g
  ('fab28000-0000-4000-8000-000000000105', 'Farine Fleur',                      1000),
  ('fab28000-0000-4000-8000-000000000105', 'Oeufs entiers liquides',             500),
  ('fab28000-0000-4000-8000-000000000105', 'Lait',                               100),
  ('fab28000-0000-4000-8000-000000000105', 'Sucre semoule',                      130),
  ('fab28000-0000-4000-8000-000000000105', 'Sel de table fin',                    20),
  ('fab28000-0000-4000-8000-000000000105', 'Levure fraîche',                      40),
  ('fab28000-0000-4000-8000-000000000105', 'Beurre',                             400),
  -- Pâte sucrée — 1160 g
  ('fab28000-0000-4000-8000-000000000106', 'Beurre',                             300),
  ('fab28000-0000-4000-8000-000000000106', 'Sucre glace',                        190),
  ('fab28000-0000-4000-8000-000000000106', 'Amande poudre',                       60),
  ('fab28000-0000-4000-8000-000000000106', 'Oeufs entiers liquides',             105),
  ('fab28000-0000-4000-8000-000000000106', 'Farine Fleur',                       500),
  ('fab28000-0000-4000-8000-000000000106', 'Sel de table fin',                     5),
  -- Pâte à choux — 1470 g
  ('fab28000-0000-4000-8000-000000000107', 'Eau',                                250),
  ('fab28000-0000-4000-8000-000000000107', 'Lait',                               250),
  ('fab28000-0000-4000-8000-000000000107', 'Beurre',                             200),
  ('fab28000-0000-4000-8000-000000000107', 'Sel de table fin',                     5),
  ('fab28000-0000-4000-8000-000000000107', 'Sucre semoule',                       15),
  ('fab28000-0000-4000-8000-000000000107', 'Farine Fleur',                       300),
  ('fab28000-0000-4000-8000-000000000107', 'Oeufs entiers liquides',             450),
  -- Crème pâtissière — 1560 g
  ('fab28000-0000-4000-8000-000000000108', 'Lait',                              1000),
  ('fab28000-0000-4000-8000-000000000108', 'Sucre semoule',                      220),
  ('fab28000-0000-4000-8000-000000000108', 'Oeufs Jaune',                        160),
  ('fab28000-0000-4000-8000-000000000108', 'Maïzena',                             92),
  ('fab28000-0000-4000-8000-000000000108', 'Beurre',                              80),
  ('fab28000-0000-4000-8000-000000000108', 'Vanille poudre',                       8),
  -- Crème d'amande — 1855 g
  ('fab28000-0000-4000-8000-000000000109', 'Beurre',                             475),
  ('fab28000-0000-4000-8000-000000000109', 'Sucre glace',                        475),
  ('fab28000-0000-4000-8000-000000000109', 'Amande poudre',                      475),
  ('fab28000-0000-4000-8000-000000000109', 'Oeufs entiers liquides',             380),
  ('fab28000-0000-4000-8000-000000000109', 'Maïzena',                             50),
  -- Crème diplomate — 1310 g (complément : voir recipe_sub_recipes)
  ('fab28000-0000-4000-8000-000000000111', 'Crème fraîche',                      300),
  ('fab28000-0000-4000-8000-000000000111', 'Gélatine en feuille',                 10),
  -- Crème chantilly — 1060 g
  ('fab28000-0000-4000-8000-000000000112', 'Crème fraîche',                     1000),
  ('fab28000-0000-4000-8000-000000000112', 'Sucre glace',                         60),
  -- Crème bavaroise vanille — 1590 g
  ('fab28000-0000-4000-8000-000000000113', 'Lait',                               500),
  ('fab28000-0000-4000-8000-000000000113', 'Oeufs Jaune',                        120),
  ('fab28000-0000-4000-8000-000000000113', 'Sucre semoule',                      150),
  ('fab28000-0000-4000-8000-000000000113', 'Gélatine en feuille',                 14),
  ('fab28000-0000-4000-8000-000000000113', 'Crème fraîche',                      800),
  ('fab28000-0000-4000-8000-000000000113', 'Vanille poudre',                       6),
  -- Génoise nature — 1000 g
  ('fab28000-0000-4000-8000-000000000114', 'Oeufs entiers liquides',             500),
  ('fab28000-0000-4000-8000-000000000114', 'Sucre semoule',                      250),
  ('fab28000-0000-4000-8000-000000000114', 'Farine Fleur',                       250),
  -- Génoise cacao — 1000 g
  ('fab28000-0000-4000-8000-000000000115', 'Oeufs entiers liquides',             500),
  ('fab28000-0000-4000-8000-000000000115', 'Sucre semoule',                      250),
  ('fab28000-0000-4000-8000-000000000115', 'Farine Fleur',                       210),
  ('fab28000-0000-4000-8000-000000000115', 'Cacao en poudre 10/12',               40),
  -- Biscuit cuillère — 1200 g
  ('fab28000-0000-4000-8000-000000000116', 'Blancs d''œufs liquides pasteurisés', 360),
  ('fab28000-0000-4000-8000-000000000116', 'Sucre semoule',                      300),
  ('fab28000-0000-4000-8000-000000000116', 'Oeufs Jaune',                        240),
  ('fab28000-0000-4000-8000-000000000116', 'Farine Fleur',                       300),
  -- Dacquoise noisette — 1150 g
  ('fab28000-0000-4000-8000-000000000117', 'Blancs d''œufs liquides pasteurisés', 450),
  ('fab28000-0000-4000-8000-000000000117', 'Sucre semoule',                      150),
  ('fab28000-0000-4000-8000-000000000117', 'Sucre glace',                        250),
  ('fab28000-0000-4000-8000-000000000117', 'Noisette en poudre',                 300),
  -- Meringue française — 900 g
  ('fab28000-0000-4000-8000-000000000118', 'Blancs d''œufs liquides pasteurisés', 300),
  ('fab28000-0000-4000-8000-000000000118', 'Sucre semoule',                      300),
  ('fab28000-0000-4000-8000-000000000118', 'Sucre glace',                        300),
  -- Streusel amande — 800 g
  ('fab28000-0000-4000-8000-000000000119', 'Beurre',                             200),
  ('fab28000-0000-4000-8000-000000000119', 'SUCRE CASSONADE',                    200),
  ('fab28000-0000-4000-8000-000000000119', 'Farine Fleur',                       200),
  ('fab28000-0000-4000-8000-000000000119', 'Amande poudre',                      200),
  -- Ganache chocolat au lait — 1210 g
  ('fab28000-0000-4000-8000-000000000120', 'Chocolat de couverture Lait 33%',    700),
  ('fab28000-0000-4000-8000-000000000120', 'Crème fraîche',                      500),
  ('fab28000-0000-4000-8000-000000000120', 'Trimoline sucre inverti',             10),
  -- Ganache montée ivoire — 1250 g
  ('fab28000-0000-4000-8000-000000000121', 'Chocolat Blanc 30%',                 400),
  ('fab28000-0000-4000-8000-000000000121', 'Crème fraîche',                      800),
  ('fab28000-0000-4000-8000-000000000121', 'Gélatine en feuille',                  6),
  ('fab28000-0000-4000-8000-000000000121', 'Trimoline sucre inverti',             44),
  -- Mousse au chocolat noir — 2065 g
  ('fab28000-0000-4000-8000-000000000122', 'Chocolat de couverture Noir 55%',    600),
  ('fab28000-0000-4000-8000-000000000122', 'Crème fraîche',                     1000),
  ('fab28000-0000-4000-8000-000000000122', 'Oeufs Jaune',                        200),
  ('fab28000-0000-4000-8000-000000000122', 'Sucre semoule',                      200),
  ('fab28000-0000-4000-8000-000000000122', 'Eau',                                 65),
  -- Croustillant praliné feuilletine — 1000 g
  ('fab28000-0000-4000-8000-000000000123', 'Praliné noisette 50%',               500),
  ('fab28000-0000-4000-8000-000000000123', 'Chocolat de couverture Lait 33%',    200),
  ('fab28000-0000-4000-8000-000000000123', 'Brisure biscuit Royaltine',          300),
  -- Caramel tendre — 1155 g
  ('fab28000-0000-4000-8000-000000000124', 'Sucre semoule',                      500),
  ('fab28000-0000-4000-8000-000000000124', 'Sirop de glucose',                   100),
  ('fab28000-0000-4000-8000-000000000124', 'Crème fraîche',                      400),
  ('fab28000-0000-4000-8000-000000000124', 'Beurre',                             150),
  ('fab28000-0000-4000-8000-000000000124', 'Sel de table fin',                     5),
  -- Glaçage miroir cacao — 1400 g
  ('fab28000-0000-4000-8000-000000000125', 'Eau',                                300),
  ('fab28000-0000-4000-8000-000000000125', 'Sucre semoule',                      500),
  ('fab28000-0000-4000-8000-000000000125', 'Sirop de glucose',                   100),
  ('fab28000-0000-4000-8000-000000000125', 'Cacao en poudre 10/12',              180),
  ('fab28000-0000-4000-8000-000000000125', 'Crème fraîche',                      300),
  ('fab28000-0000-4000-8000-000000000125', 'Gélatine en feuille',                 20),
  -- Appareil à flan pâtissier — 1800 g
  ('fab28000-0000-4000-8000-000000000126', 'Lait',                              1000),
  ('fab28000-0000-4000-8000-000000000126', 'Crème fraîche',                      250),
  ('fab28000-0000-4000-8000-000000000126', 'Sucre semoule',                      250),
  ('fab28000-0000-4000-8000-000000000126', 'Oeufs Jaune',                        200),
  ('fab28000-0000-4000-8000-000000000126', 'Maïzena',                             92),
  ('fab28000-0000-4000-8000-000000000126', 'Vanille poudre',                       8)
) AS v (rid, ingredient, qte)
JOIN _b280_ing ing ON ing.name = v.ingredient;

-- Garde-fou : chaque ligne du VALUES doit avoir trouvé son ingrédient.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_ingredients WHERE recipe_id::text LIKE 'fab28000%';
  IF n <> 112 THEN
    RAISE EXCEPTION 'Compositions incomplètes : % ligne(s) sur 112 attendues', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bases composées de bases : frangipane et diplomate (quantity = g de pesée).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity)
VALUES
  -- Frangipane 1500 g = 1000 g crème d'amande + 500 g crème pâtissière
  ('fab28000-0000-4000-8000-000000000110', 'fab28000-0000-4000-8000-000000000109', 1000),
  ('fab28000-0000-4000-8000-000000000110', 'fab28000-0000-4000-8000-000000000108',  500),
  -- Crème diplomate 1310 g = 1000 g pâtissière + 300 g crème + 10 g gélatine
  ('fab28000-0000-4000-8000-000000000111', 'fab28000-0000-4000-8000-000000000108', 1000)
ON CONFLICT (recipe_id, sub_recipe_id) DO NOTHING;
