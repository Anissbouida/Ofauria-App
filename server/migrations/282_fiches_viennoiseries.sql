-- Migration 282 : Fiches techniques VIENNOISERIES — 56 produits, 43 fiches, 8 bases familiales
--
-- POURQUOI
--   Injection des fiches techniques de toute la famille VIENNOISERIES sur le
--   modèle Opéra (mig 273/276) et les bases transversales de la mig 280.
--   Chaque produit vendu de la catégorie est couvert par un format lié à son
--   product_id ; les déclinaisons normal/mini d'un même produit sont UNE
--   recette + PLUSIEURS formats (poids de pâton différents).
--
-- ─── LECTURE : PESÉES, NET ET PERTE DE CUISSON (convention Opéra) ───
--   Les composants d'un format sont des poids NETS mis en œuvre sur la plaque :
--   pour une viennoiserie, c'est le poids du PÂTON DÉTAILLÉ (déjà net de la
--   perte de détaillage de 5 % portée par la pâte de base) + la garniture + la
--   dorure. quantite_par_format = poids cru façonné d'une pièce (somme des
--   composants / nb de pièces).
--   La perte de CUISSON de la viennoiserie (10-12 % d'évaporation au four
--   165-175 °C) intervient APRÈS l'assemblage : la pièce vendue pèse ~11 % de
--   moins que son pâton garni. Elle n'entre pas dans le coût matière (rien
--   n'est jeté) : elle est documentée ici et dans les instructions, et
--   perte_standard_pct des recettes composées reste à 0 (même convention que
--   l'Opéra classique — poser 11 % fausserait la fraction de fournée calculée
--   par v_recipe_total_cost pour les plateaux).
--
-- ─── PLATEAUX : COMPOSANTS EN 'unit', PAS EN GRAMMES ───
--   MINI PLATEAU et PLATEAU VIENNOISERIES sont des recettes composées dont les
--   composants sont les recettes de viennoiseries (role garniture). Le moteur
--   de coût (v_recipe_total_cost) divise la quantité par yield_quantity de
--   l'enfant, exprimé en 'unit' (nb de pièces du format PAR DÉFAUT) — et
--   fn_unit_conv(g -> unit) est neutre (facteur 1). Des grammes seraient donc
--   lus comme des pièces : 891 g deviendraient 59 fournées. Les quantités sont
--   donc en 'unit' = ÉQUIVALENTS-PIÈCES DU FORMAT PAR DÉFAUT :
--     Mini plateau (18 minis) : 6 mini croissants = 6 × 42 g / 96 g = 2,63 u
--       de « Croissant », 6 mini pains choc = 2,61 u, 6 mini fourrés = 2,73 u.
--     Plateau (15 pièces normales) : 5 u de chaque (pièces = format défaut).
--   quantite_par_format du plateau = poids net total en g (traçabilité pesage).
--
-- ─── DOUBLON DE CATALOGUE « Qrachel mini » / « Mini 9rachel » ───
--   Deux product_id distincts pour le même produit vendu (double saisie POS).
--   Un product_id ne peut vivre que sur UN format actif : le doublon reçoit un
--   3e format identique à contenant NULL (la contrainte UNIQUE
--   (recipe_id, contenant_id) interdit deux formats sur la même plaque).
--
-- ─── ARBITRAGE DES DOUBLONS D'INGRÉDIENTS ───
--   Pattern temp-table de la mig 273, avec un critère de plus : à usages égaux
--   on préfère la ligne en kg (les doublons dangereux sont ceux en 'unit' ou
--   'g' — « Creme de pistach » existe en unit à 140 DH ET en kg à 97,5 DH ;
--   coûter 150 g comme 150 unités donnerait 21 000 DH la fournée).
--
-- ─── CHOIX D'INGRÉDIENTS (chocolat) ───
--   Bâtons : « Bâtons boulangers 500 BTS » (kg, 92 DH) — le vrai bâton DGF du
--   labo ; « 500 batons boulangers DGF » (unit = carton) et « Batons
--   boulangers DGF 500 » (unit, coût 0) sont écartés. Pépites pains suisses /
--   torsades : « Chocolat cookies drops » (kg, 30 DH), qualité boulangère.
--   Produits « noir » : « Gouttes drops 50% DGF » (75 DH) ou bâtons.
--   « Raisins secs golden » à 300 DH/kg est un prix aberrant (marché : 35-60) :
--   on crée « Raisins secs » à 45 DH/kg plutôt que de fausser le pain raisin.
--
-- PORTEE
--   + 4 ingrédients créés si absents (prix à valider)
--   + 8 bases familiales fab28200-…-01[01-08] (PLF complète, PLF céréales,
--     PLF bicolore cacao, crème pât. chocolat, crème pât. pistache, pâte à
--     beignets, pâte à qrachel, pâte viennoise sucrée)
--   + 43 fiches produits fab28200-…-01[10-52] (mode compose)
--   + 56 recipe_formats fab28200-…-02[01-56], 1 par produit vendu (56/56)
--   + 198 recipe_format_components + miroirs recipe_components
--   + étapes et instructions sur 5 fiches phares (croissant, pain au chocolat,
--     pain suisse, flan, qrachel)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes, DELETE+INSERT sur
--   les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28200%';  -- cascade formats+composants
--   DELETE FROM ingredients WHERE name IN ('Raisins secs','Confiture de framboise',
--     'Oreillons d''abricot au sirop','Eau de fleur d''oranger (litre)')
--     AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingrédients manquants au référentiel (prix marché marocain 2026).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category, densite_kg_l)
SELECT v.name, v.unit, v.cost, v.cat, v.dens
FROM (VALUES
  ('Raisins secs',                    'kg', 45.00::numeric, 'fruits_secs', NULL::numeric), -- PRIX À VALIDER
  ('Confiture de framboise',          'kg', 40.00,          'decors',      NULL),          -- PRIX À VALIDER
  ('Oreillons d''abricot au sirop',   'kg', 28.00,          'fruits',      NULL),          -- PRIX À VALIDER
  ('Eau de fleur d''oranger (litre)', 'l',  30.00,          'epices',      1.000)          -- PRIX À VALIDER
) AS v (name, unit, cost, cat, dens)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Résolution des ingrédients (doublons : usages réels, puis kg préféré).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _v282_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Farine viennoiserie', 'Farine Fleur', 'Farine Complète', 'Mix Pain aux céréales',
  'Mélange de graines', 'Eau', 'Lait', 'Sucre semoule', 'Sucre glace',
  'Sel de table fin', 'Levure fraîche', 'Améliorant Viennoiserie', 'Beurre',
  'Oeufs entiers liquides', 'Cacao en poudre 10/12', 'Chocolat de couverture Noir 55%',
  'Bâtons boulangers 500 BTS', 'Gouttes drops 50% DGF', 'Chocolat cookies drops',
  'Creme de pistach', 'Pistache décortiquée', 'Crème citron', 'Amande effilée',
  'Raisins secs', 'Confiture de framboise', 'Oreillons d''abricot au sirop',
  'Eau de fleur d''oranger (litre)', 'Compote de pomme Valade', 'Nappage neutre',
  'Sucre grain CAL 10', 'Grains anis vert', 'Grains de sésame', 'Sésame décortiqué',
  'Fraise', 'Kiwi', 'Huile de table'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         (i.unit = 'kg') DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _v282_ing;
  IF n <> 36 THEN
    RAISE EXCEPTION 'Ingrédients introuvables : % trouvé(s) sur 36 attendus', n;
  END IF;
END $$;

-- Garde-fou : les doublons arbitrés doivent être les lignes en kg.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(t.name, ', ') INTO bad
  FROM _v282_ing t JOIN ingredients i ON i.id = t.id
  WHERE t.name IN ('Creme de pistach', 'Chocolat cookies drops', 'Kiwi',
                   'Bâtons boulangers 500 BTS', 'Beurre')
    AND i.unit <> 'kg';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Doublon mal arbitré (unité <> kg) : %', bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Garde-fou : les bases transversales (mig 280) référencées par UUID.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipes WHERE id IN (
    'fab28000-0000-4000-8000-000000000101',  -- Dorure
    'fab28000-0000-4000-8000-000000000102',  -- Sirop à 30°B
    'fab28000-0000-4000-8000-000000000103',  -- Pâte feuilletée
    'fab28000-0000-4000-8000-000000000104',  -- Pâte levée feuilletée
    'fab28000-0000-4000-8000-000000000105',  -- Pâte à brioche
    'fab28000-0000-4000-8000-000000000108',  -- Crème pâtissière
    'fab28000-0000-4000-8000-000000000109',  -- Crème d'amande
    'fab28000-0000-4000-8000-000000000110',  -- Frangipane
    'fab28000-0000-4000-8000-000000000126'   -- Appareil à flan pâtissier
  );
  IF n <> 9 THEN
    RAISE EXCEPTION 'Bases transversales mig 280 manquantes : % sur 9', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les 8 bases familiales viennoiserie (pesée CRUE + perte de transformation).
--    PLF déclinées : mêmes hydratation/tourage que la PLF mère (mig 280),
--    farine substituée. Perte 5 % = rognures de détaillage.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id::uuid, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production'), v.notes
FROM (VALUES
  ('fab28200-0000-4000-8000-000000000101', 'Pâte levée feuilletée complète', 2265::numeric, 5::numeric,
   'PLF sur farine complète (60 %) : tourage identique à la PLF mère, détailler à 4 mm. La farine complète boit plus : pétrissage +2 min.'),
  ('fab28200-0000-4000-8000-000000000102', 'Pâte levée feuilletée céréales', 2325, 5,
   'PLF sur mix céréales (20 %) + graines dans la détrempe. Tourage 1 double + 1 simple, détailler à 4 mm.'),
  ('fab28200-0000-4000-8000-000000000103', 'Pâte levée feuilletée bicolore cacao', 2316, 5,
   'Détrempe nature tourée, détrempe cacao (farine + cacao 10/12 + beurre) plaquée en fine abaisse sur le dernier tour. Détailler côté cacao dessus.'),
  ('fab28200-0000-4000-8000-000000000104', 'Crème pâtissière chocolat', 1150, 2,
   'Couverture noire 55 % fondue dans la pâtissière chaude, mixer. Refroidir en cellule < 1 h. J+2 au froid.'),
  ('fab28200-0000-4000-8000-000000000105', 'Crème pâtissière pistache', 1150, 2,
   'Crème de pistache lissée dans la pâtissière tiède à la feuille. J+2 au froid.'),
  ('fab28200-0000-4000-8000-000000000106', 'Pâte à beignets', 2025, 10,
   'Pétrir 10 min, pousse 1 h à 26 °C, rompre, détailler. Friture 170 °C 2×90 s. Perte = évaporation à la friture (l''huile absorbée est comptée sur la fiche produit).'),
  ('fab28200-0000-4000-8000-000000000107', 'Pâte à qrachel', 1860, 12,
   'Brioche marocaine : anis, sésame et fleur d''oranger dans la détrempe. Pétrir 12 min, pointage 1 h. Perte = cuisson 170 °C.'),
  ('fab28200-0000-4000-8000-000000000108', 'Pâte viennoise sucrée', 1828, 12,
   'Pâte viennoise lactée (baguettes viennoises, navettes). Pétrir 12 min, pousse contrôlée possible une nuit à 4 °C. Perte = cuisson.')
) AS v (id, nom, yield, perte, notes)
ON CONFLICT (id) DO NOTHING;

DELETE FROM recipe_ingredients WHERE recipe_id::text LIKE 'fab28200%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid::uuid, ing.id, v.qte, 'g'
FROM (VALUES
  -- PLF complète — 2265 g (farine complète 60 / viennoiserie 40)
  ('fab28200-0000-4000-8000-000000000101', 'Farine Complète',                  600::numeric),
  ('fab28200-0000-4000-8000-000000000101', 'Farine viennoiserie',              400),
  ('fab28200-0000-4000-8000-000000000101', 'Eau',                              250),
  ('fab28200-0000-4000-8000-000000000101', 'Lait',                             250),
  ('fab28200-0000-4000-8000-000000000101', 'Sucre semoule',                    120),
  ('fab28200-0000-4000-8000-000000000101', 'Sel de table fin',                  20),
  ('fab28200-0000-4000-8000-000000000101', 'Levure fraîche',                    45),
  ('fab28200-0000-4000-8000-000000000101', 'Améliorant Viennoiserie',           10),
  ('fab28200-0000-4000-8000-000000000101', 'Beurre',                           570),
  -- PLF céréales — 2325 g (mix céréales 20 % + graines)
  ('fab28200-0000-4000-8000-000000000102', 'Farine viennoiserie',              800),
  ('fab28200-0000-4000-8000-000000000102', 'Mix Pain aux céréales',            200),
  ('fab28200-0000-4000-8000-000000000102', 'Mélange de graines',                60),
  ('fab28200-0000-4000-8000-000000000102', 'Eau',                              250),
  ('fab28200-0000-4000-8000-000000000102', 'Lait',                             250),
  ('fab28200-0000-4000-8000-000000000102', 'Sucre semoule',                    120),
  ('fab28200-0000-4000-8000-000000000102', 'Sel de table fin',                  20),
  ('fab28200-0000-4000-8000-000000000102', 'Levure fraîche',                    45),
  ('fab28200-0000-4000-8000-000000000102', 'Améliorant Viennoiserie',           10),
  ('fab28200-0000-4000-8000-000000000102', 'Beurre',                           570),
  -- PLF bicolore cacao — 2316 g (détrempe cacao plaquée : farine Fleur + cacao)
  ('fab28200-0000-4000-8000-000000000103', 'Farine viennoiserie',              900),
  ('fab28200-0000-4000-8000-000000000103', 'Farine Fleur',                     140),
  ('fab28200-0000-4000-8000-000000000103', 'Cacao en poudre 10/12',             35),
  ('fab28200-0000-4000-8000-000000000103', 'Eau',                              300),
  ('fab28200-0000-4000-8000-000000000103', 'Lait',                             220),
  ('fab28200-0000-4000-8000-000000000103', 'Sucre semoule',                    130),
  ('fab28200-0000-4000-8000-000000000103', 'Sel de table fin',                  20),
  ('fab28200-0000-4000-8000-000000000103', 'Levure fraîche',                    42),
  ('fab28200-0000-4000-8000-000000000103', 'Améliorant Viennoiserie',            9),
  ('fab28200-0000-4000-8000-000000000103', 'Beurre',                           520),
  -- Crème pâtissière chocolat — 1150 g (complément : recipe_sub_recipes)
  ('fab28200-0000-4000-8000-000000000104', 'Chocolat de couverture Noir 55%',  150),
  -- Crème pâtissière pistache — 1150 g (complément : recipe_sub_recipes)
  ('fab28200-0000-4000-8000-000000000105', 'Creme de pistach',                 150),
  -- Pâte à beignets — 2025 g
  ('fab28200-0000-4000-8000-000000000106', 'Farine Fleur',                    1000),
  ('fab28200-0000-4000-8000-000000000106', 'Lait',                             450),
  ('fab28200-0000-4000-8000-000000000106', 'Oeufs entiers liquides',           250),
  ('fab28200-0000-4000-8000-000000000106', 'Sucre semoule',                    120),
  ('fab28200-0000-4000-8000-000000000106', 'Beurre',                           150),
  ('fab28200-0000-4000-8000-000000000106', 'Levure fraîche',                    40),
  ('fab28200-0000-4000-8000-000000000106', 'Sel de table fin',                  15),
  -- Pâte à qrachel — 1860 g (anis, sésame, fleur d'oranger)
  ('fab28200-0000-4000-8000-000000000107', 'Farine Fleur',                    1000),
  ('fab28200-0000-4000-8000-000000000107', 'Sucre semoule',                    200),
  ('fab28200-0000-4000-8000-000000000107', 'Oeufs entiers liquides',           150),
  ('fab28200-0000-4000-8000-000000000107', 'Beurre',                           100),
  ('fab28200-0000-4000-8000-000000000107', 'Huile de table',                    80),
  ('fab28200-0000-4000-8000-000000000107', 'Lait',                             200),
  ('fab28200-0000-4000-8000-000000000107', 'Levure fraîche',                    40),
  ('fab28200-0000-4000-8000-000000000107', 'Grains anis vert',                  15),
  ('fab28200-0000-4000-8000-000000000107', 'Grains de sésame',                  30),
  ('fab28200-0000-4000-8000-000000000107', 'Eau de fleur d''oranger (litre)',   30),
  ('fab28200-0000-4000-8000-000000000107', 'Sel de table fin',                  15),
  -- Pâte viennoise sucrée — 1828 g
  ('fab28200-0000-4000-8000-000000000108', 'Farine viennoiserie',             1000),
  ('fab28200-0000-4000-8000-000000000108', 'Lait',                             450),
  ('fab28200-0000-4000-8000-000000000108', 'Sucre semoule',                    120),
  ('fab28200-0000-4000-8000-000000000108', 'Beurre',                           150),
  ('fab28200-0000-4000-8000-000000000108', 'Levure fraîche',                    40),
  ('fab28200-0000-4000-8000-000000000108', 'Sel de table fin',                  18),
  ('fab28200-0000-4000-8000-000000000108', 'Oeufs entiers liquides',            50)
) AS v (rid, ingredient, qte)
JOIN _v282_ing ing ON ing.name = v.ingredient;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_ingredients WHERE recipe_id::text LIKE 'fab28200%';
  IF n <> 56 THEN
    RAISE EXCEPTION 'Compositions de bases incomplètes : % ligne(s) sur 56 attendues', n;
  END IF;
END $$;

-- Les deux crèmes dérivées consomment la pâtissière mère (quantity = g de pesée).
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity)
VALUES
  ('fab28200-0000-4000-8000-000000000104', 'fab28000-0000-4000-8000-000000000108', 1000),
  ('fab28200-0000-4000-8000-000000000105', 'fab28000-0000-4000-8000-000000000108', 1000)
ON CONFLICT (recipe_id, sub_recipe_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 43 fiches produits (mode compose). yield_quantity = nb de pièces du
--    format par défaut. product_id posé quand la recette n'a qu'un seul
--    produit ; NULL sinon (les liens passent par les formats).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id)
SELECT v.id::uuid, v.nom, false, 'compose', v.yield, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'viennoiserie'),
       v.pid::uuid
FROM (VALUES
  -- Croissants
  ('fab28200-0000-4000-8000-000000000110', 'Croissant',                          15::numeric, NULL),
  ('fab28200-0000-4000-8000-000000000111', 'Croissant complet',                  15, NULL),
  ('fab28200-0000-4000-8000-000000000112', 'Croissant céréales',                 15, NULL),
  ('fab28200-0000-4000-8000-000000000113', 'Croissant bicolore cacao',           15, 'b63f22be-ef63-4118-9fe9-6be4ba762faa'),
  ('fab28200-0000-4000-8000-000000000114', 'Croissant au chocolat noir',         15, '9869cd64-7aab-483d-bda1-39cf5080d1c7'),
  -- Pains au chocolat
  ('fab28200-0000-4000-8000-000000000115', 'Pain au chocolat',                   15, NULL),
  ('fab28200-0000-4000-8000-000000000116', 'Pain au chocolat complet',           15, NULL),
  ('fab28200-0000-4000-8000-000000000117', 'Pain au chocolat céréales',          15, NULL),
  ('fab28200-0000-4000-8000-000000000118', 'Pain au chocolat bicolore',          15, '9936975e-08af-4349-9956-f680d5d6103c'),
  ('fab28200-0000-4000-8000-000000000119', 'Pain au chocolat noir',              15, '5e10a832-7a12-4ee0-9cb2-be7ee02e0a07'),
  ('fab28200-0000-4000-8000-000000000120', 'Pain double choco',                  15, '033e99a9-65af-4f2f-90f4-d32f9beb54dd'),
  -- Pains suisses et coques
  ('fab28200-0000-4000-8000-000000000121', 'Pain suisse',                        12, NULL),
  ('fab28200-0000-4000-8000-000000000122', 'Pain suisse céréales',               12, '184c3aed-22f5-4b0d-aaee-b7cce21e0436'),
  ('fab28200-0000-4000-8000-000000000123', 'Pain suisse pistache',               12, 'ec535742-324c-44e9-89e8-075607d05ca4'),
  ('fab28200-0000-4000-8000-000000000124', 'Pain suisse noir',                   12, '165491d6-688e-4f7b-80e5-ebf369111250'),
  ('fab28200-0000-4000-8000-000000000125', 'Coque suisse',                       15, '69840d60-9998-457e-a810-5fe9f1e8c26f'),
  -- Escargots et torsades
  ('fab28200-0000-4000-8000-000000000126', 'Pain aux raisins',                   15, NULL),
  ('fab28200-0000-4000-8000-000000000127', 'Torsade',                            15, 'e6ca6c64-0054-4f02-af57-0fb735b78d38'),
  ('fab28200-0000-4000-8000-000000000128', 'Torsade choco/crème pâtissière',     15, 'c81cbc8d-96d9-477c-8e05-e7e5c714f9fe'),
  -- Danish
  ('fab28200-0000-4000-8000-000000000129', 'Danish abricot',                     12, 'a942b3c0-5359-49a6-a2a2-2f16a4b2f0b0'),
  ('fab28200-0000-4000-8000-000000000130', 'Danish framboise/choco',             12, 'c0536fde-a2bd-4e88-b80d-6f169822709c'),
  ('fab28200-0000-4000-8000-000000000131', 'Danish chocolat',                    12, 'b6592762-7d2f-40bf-8e38-4ccd5eba4f2f'),
  ('fab28200-0000-4000-8000-000000000132', 'Danish fruits',                      12, '7452f548-65d6-40d0-a3f4-ccc6d71f424b'),
  -- Feuilletés
  ('fab28200-0000-4000-8000-000000000133', 'Chausson aux pommes',                12, 'b291ef91-58a6-4058-a6a4-c0e9363a8aa0'),
  ('fab28200-0000-4000-8000-000000000134', 'Jalousie abricot',                   15, '9ea97968-0499-455b-b0f0-7e30e3766cb9'),
  ('fab28200-0000-4000-8000-000000000135', 'Jalousie aux amandes',               15, 'd3c10e0a-5b31-417f-aa23-b07ffae11f3a'),
  ('fab28200-0000-4000-8000-000000000136', 'Jalousie aux pommes',                15, 'a37acfcd-e2d4-4860-bb0c-6537925683ed'),
  ('fab28200-0000-4000-8000-000000000137', 'Jalousie rond pomme',                15, 'a0c37c43-0903-4a8e-8474-76de2fe433df'),
  -- Fourrés
  ('fab28200-0000-4000-8000-000000000138', 'Fourré amande',                      15, NULL),
  ('fab28200-0000-4000-8000-000000000139', 'Fourré pistache',                    15, NULL),
  ('fab28200-0000-4000-8000-000000000140', 'Fourré chocolat (mini)',             40, '45e0b19d-f0de-4597-b703-d393d35ad888'),
  ('fab28200-0000-4000-8000-000000000141', 'Fourré citron (mini)',               40, '770a2b63-081a-4d78-925d-34ab31303813'),
  -- Briochés
  ('fab28200-0000-4000-8000-000000000142', 'Brioche',                            15, 'a79ae53d-b3c7-419d-a32f-77b01091bf5d'),
  ('fab28200-0000-4000-8000-000000000143', 'Bostock amande',                     12, '7449e5fc-067f-478e-ba70-e57ec3096822'),
  ('fab28200-0000-4000-8000-000000000144', 'Navette aux framboises',             15, '75162647-9bd9-44ed-9903-d181a7723a80'),
  -- Beignets
  ('fab28200-0000-4000-8000-000000000145', 'Beignet sucré',                      20, '509161ab-14f5-4825-97f4-68536c1dead8'),
  ('fab28200-0000-4000-8000-000000000146', 'Beignets fourrés choco/citron/framboise', 20, 'e9babe89-4d45-4db0-bf23-81413d3a82b2'),
  -- Divers
  ('fab28200-0000-4000-8000-000000000147', 'Flan vanille',                       12, '8bc9aa1b-f594-4980-910f-af9ab2a9caa3'),
  ('fab28200-0000-4000-8000-000000000148', 'Palmier sucré',                      20, '4f0a47e0-972b-48ac-8e1a-f0c095c2f675'),
  ('fab28200-0000-4000-8000-000000000149', 'Baguette sucrée viennoise',          12, 'c71932e5-be3b-4d27-803a-c421c91116ca'),
  ('fab28200-0000-4000-8000-000000000150', 'Qrachel',                            15, NULL),
  -- Plateaux (composés de recettes de viennoiseries)
  ('fab28200-0000-4000-8000-000000000151', 'Mini plateau viennoiseries',          1, 'e8ba8280-bed1-4996-9301-88535e2cf0c4'),
  ('fab28200-0000-4000-8000-000000000152', 'Plateau viennoiseries',               1, 'b9d96b6f-aaf9-4e36-8acb-e71e785cd0e5')
) AS v (id, nom, yield, pid)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 56 formats — un par produit vendu du catalogue VIENNOISERIES.
--    nb_par_defaut = pièces par plaque ; quantite_par_format = poids cru
--    façonné d'une pièce (somme des composants nets / nb).
-- ─────────────────────────────────────────────────────────────────────────────
-- 5a. Formats sur contenant (JOIN par nom de plaque).
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre, product_id)
SELECT v.fid::uuid, v.rid::uuid, c.id, v.qpf, 'g', v.nb, v.def, v.ordre, v.pid::uuid
FROM (VALUES
  -- Croissant : normal / mini / américain
  ('fab28200-0000-4000-8000-000000000201', 'fab28200-0000-4000-8000-000000000110', 'Plaque 60x40 viennoiseries (15)',       96.00::numeric, 15, true,  1, '734aac50-59eb-4906-a14e-e085690363e3'),
  ('fab28200-0000-4000-8000-000000000202', 'fab28200-0000-4000-8000-000000000110', 'Plaque 60x40 mini-viennoiseries (40)',  42.00, 40, false, 2, '9a975d4d-bd50-42bf-bf10-ddbfa8bd47f0'),
  ('fab28200-0000-4000-8000-000000000203', 'fab28200-0000-4000-8000-000000000110', 'Plaque 60x40 viennoiseries (12)',      122.00, 12, false, 3, 'a4df8761-d4b5-4e4d-ace7-60e3e5d15019'),
  -- Croissant complet : normal / mini
  ('fab28200-0000-4000-8000-000000000204', 'fab28200-0000-4000-8000-000000000111', 'Plaque 60x40 viennoiseries (15)',       96.00, 15, true,  1, '86c78eb4-358e-4496-a927-0689f1d141e2'),
  ('fab28200-0000-4000-8000-000000000205', 'fab28200-0000-4000-8000-000000000111', 'Plaque 60x40 mini-viennoiseries (40)',  42.00, 40, false, 2, '6c4497e9-5870-47c7-8958-bfa1c0e36d39'),
  -- Croissant céréales : normal / mini
  ('fab28200-0000-4000-8000-000000000206', 'fab28200-0000-4000-8000-000000000112', 'Plaque 60x40 viennoiseries (15)',       98.00, 15, true,  1, 'e4ba4bbc-b9e0-4657-a04d-cd4efea0ec81'),
  ('fab28200-0000-4000-8000-000000000207', 'fab28200-0000-4000-8000-000000000112', 'Plaque 60x40 mini-viennoiseries (40)',  42.00, 40, false, 2, '1a6cb8a1-4f38-4a4d-b49d-ab97ee756af9'),
  -- Croissants bicolore et chocolat noir
  ('fab28200-0000-4000-8000-000000000208', 'fab28200-0000-4000-8000-000000000113', 'Plaque 60x40 viennoiseries (15)',       94.00, 15, true,  1, 'b63f22be-ef63-4118-9fe9-6be4ba762faa'),
  ('fab28200-0000-4000-8000-000000000209', 'fab28200-0000-4000-8000-000000000114', 'Plaque 60x40 viennoiseries (15)',       99.00, 15, true,  1, '9869cd64-7aab-483d-bda1-39cf5080d1c7'),
  -- Pain au chocolat : normal / mini
  ('fab28200-0000-4000-8000-000000000210', 'fab28200-0000-4000-8000-000000000115', 'Plaque 60x40 viennoiseries (15)',      107.00, 15, true,  1, '49674a4a-f57a-4072-a753-e7c41070ffe1'),
  ('fab28200-0000-4000-8000-000000000211', 'fab28200-0000-4000-8000-000000000115', 'Plaque 60x40 mini-viennoiseries (40)',  46.50, 40, false, 2, 'c6eca0dd-8b9c-4152-857d-060d676d1d13'),
  -- Pain au chocolat complet : normal / mini
  ('fab28200-0000-4000-8000-000000000212', 'fab28200-0000-4000-8000-000000000116', 'Plaque 60x40 viennoiseries (15)',      107.00, 15, true,  1, '07ef07c2-f37d-4fbe-b8a2-2360ee4d69f1'),
  ('fab28200-0000-4000-8000-000000000213', 'fab28200-0000-4000-8000-000000000116', 'Plaque 60x40 mini-viennoiseries (40)',  46.50, 40, false, 2, '6f354018-f608-4eef-8a03-cf98ae79b8ce'),
  -- Pain au chocolat céréales : normal / mini
  ('fab28200-0000-4000-8000-000000000214', 'fab28200-0000-4000-8000-000000000117', 'Plaque 60x40 viennoiseries (15)',      109.00, 15, true,  1, 'c1301e00-566d-42c8-83eb-f146170af7cc'),
  ('fab28200-0000-4000-8000-000000000215', 'fab28200-0000-4000-8000-000000000117', 'Plaque 60x40 mini-viennoiseries (40)',  47.50, 40, false, 2, '8d34f7cb-dd48-45ce-8378-c17011b55dd0'),
  -- Pains au chocolat bicolore, noir, double choco
  ('fab28200-0000-4000-8000-000000000216', 'fab28200-0000-4000-8000-000000000118', 'Plaque 60x40 viennoiseries (15)',      106.00, 15, true,  1, '9936975e-08af-4349-9956-f680d5d6103c'),
  ('fab28200-0000-4000-8000-000000000217', 'fab28200-0000-4000-8000-000000000119', 'Plaque 60x40 viennoiseries (15)',      102.00, 15, true,  1, '5e10a832-7a12-4ee0-9cb2-be7ee02e0a07'),
  ('fab28200-0000-4000-8000-000000000218', 'fab28200-0000-4000-8000-000000000120', 'Plaque 60x40 viennoiseries (15)',      107.00, 15, true,  1, '033e99a9-65af-4f2f-90f4-d32f9beb54dd'),
  -- Pain suisse : normal / mini
  ('fab28200-0000-4000-8000-000000000219', 'fab28200-0000-4000-8000-000000000121', 'Plaque 60x40 viennoiseries (12)',      160.00, 12, true,  1, 'c3247e36-448c-49fb-af51-f7522eb01992'),
  ('fab28200-0000-4000-8000-000000000220', 'fab28200-0000-4000-8000-000000000121', 'Plaque 60x40 mini-viennoiseries (40)',  67.00, 40, false, 2, '73283d9e-891a-49e6-b391-f826a12a626b'),
  -- Pains suisses céréales / pistache / noir, coque suisse
  ('fab28200-0000-4000-8000-000000000221', 'fab28200-0000-4000-8000-000000000122', 'Plaque 60x40 viennoiseries (12)',      162.00, 12, true,  1, '184c3aed-22f5-4b0d-aaee-b7cce21e0436'),
  ('fab28200-0000-4000-8000-000000000222', 'fab28200-0000-4000-8000-000000000123', 'Plaque 60x40 viennoiseries (12)',      143.00, 12, true,  1, 'ec535742-324c-44e9-89e8-075607d05ca4'),
  ('fab28200-0000-4000-8000-000000000223', 'fab28200-0000-4000-8000-000000000124', 'Plaque 60x40 viennoiseries (12)',      151.00, 12, true,  1, '165491d6-688e-4f7b-80e5-ebf369111250'),
  ('fab28200-0000-4000-8000-000000000224', 'fab28200-0000-4000-8000-000000000125', 'Plaque 60x40 viennoiseries (15)',       88.00, 15, true,  1, '69840d60-9998-457e-a810-5fe9f1e8c26f'),
  -- Pain aux raisins : normal / mini
  ('fab28200-0000-4000-8000-000000000225', 'fab28200-0000-4000-8000-000000000126', 'Plaque 60x40 viennoiseries (15)',      140.00, 15, true,  1, '6504f54b-c94f-4c8d-b0dc-a67b4d7816da'),
  ('fab28200-0000-4000-8000-000000000226', 'fab28200-0000-4000-8000-000000000126', 'Plaque 60x40 mini-viennoiseries (40)',  63.00, 40, false, 2, '4de9f31f-2da3-4229-b24d-22c8810320ce'),
  -- Torsades
  ('fab28200-0000-4000-8000-000000000227', 'fab28200-0000-4000-8000-000000000127', 'Plaque 60x40 viennoiseries (15)',      104.00, 15, true,  1, 'e6ca6c64-0054-4f02-af57-0fb735b78d38'),
  ('fab28200-0000-4000-8000-000000000228', 'fab28200-0000-4000-8000-000000000128', 'Plaque 60x40 viennoiseries (15)',      126.00, 15, true,  1, 'c81cbc8d-96d9-477c-8e05-e7e5c714f9fe'),
  -- Danish
  ('fab28200-0000-4000-8000-000000000229', 'fab28200-0000-4000-8000-000000000129', 'Plaque 60x40 viennoiseries (12)',      151.00, 12, true,  1, 'a942b3c0-5359-49a6-a2a2-2f16a4b2f0b0'),
  ('fab28200-0000-4000-8000-000000000230', 'fab28200-0000-4000-8000-000000000130', 'Plaque 60x40 viennoiseries (12)',      133.00, 12, true,  1, 'c0536fde-a2bd-4e88-b80d-6f169822709c'),
  ('fab28200-0000-4000-8000-000000000231', 'fab28200-0000-4000-8000-000000000131', 'Plaque 60x40 viennoiseries (12)',      126.00, 12, true,  1, 'b6592762-7d2f-40bf-8e38-4ccd5eba4f2f'),
  ('fab28200-0000-4000-8000-000000000232', 'fab28200-0000-4000-8000-000000000132', 'Plaque 60x40 viennoiseries (12)',      146.00, 12, true,  1, '7452f548-65d6-40d0-a3f4-ccc6d71f424b'),
  -- Feuilletés
  ('fab28200-0000-4000-8000-000000000233', 'fab28200-0000-4000-8000-000000000133', 'Plaque 60x40 viennoiseries (12)',      126.00, 12, true,  1, 'b291ef91-58a6-4058-a6a4-c0e9363a8aa0'),
  ('fab28200-0000-4000-8000-000000000234', 'fab28200-0000-4000-8000-000000000134', 'Plaque 60x40 viennoiseries (15)',       90.00, 15, true,  1, '9ea97968-0499-455b-b0f0-7e30e3766cb9'),
  ('fab28200-0000-4000-8000-000000000235', 'fab28200-0000-4000-8000-000000000135', 'Plaque 60x40 viennoiseries (15)',      121.00, 15, true,  1, 'd3c10e0a-5b31-417f-aa23-b07ffae11f3a'),
  ('fab28200-0000-4000-8000-000000000236', 'fab28200-0000-4000-8000-000000000136', 'Plaque 60x40 viennoiseries (15)',      110.00, 15, true,  1, 'a37acfcd-e2d4-4860-bb0c-6537925683ed'),
  ('fab28200-0000-4000-8000-000000000237', 'fab28200-0000-4000-8000-000000000137', 'Plaque 60x40 viennoiseries (15)',       94.00, 15, true,  1, 'a0c37c43-0903-4a8e-8474-76de2fe433df'),
  -- Fourrés amande / pistache : normal / mini — choco et citron : mini seulement
  ('fab28200-0000-4000-8000-000000000238', 'fab28200-0000-4000-8000-000000000138', 'Plaque 60x40 viennoiseries (15)',      132.00, 15, true,  1, '12b896f6-5bf8-4712-aa3a-6623de243a52'),
  ('fab28200-0000-4000-8000-000000000239', 'fab28200-0000-4000-8000-000000000138', 'Plaque 60x40 mini-viennoiseries (40)',  60.00, 40, false, 2, 'd9aa3b83-631d-4fd3-8986-62b15aaefba2'),
  ('fab28200-0000-4000-8000-000000000240', 'fab28200-0000-4000-8000-000000000139', 'Plaque 60x40 viennoiseries (15)',      129.00, 15, true,  1, 'bbb82350-f547-4042-9f58-c7d8a88b39cc'),
  ('fab28200-0000-4000-8000-000000000241', 'fab28200-0000-4000-8000-000000000139', 'Plaque 60x40 mini-viennoiseries (40)',  58.50, 40, false, 2, '346cebd7-78e1-4063-98c1-fd5754d17e91'),
  ('fab28200-0000-4000-8000-000000000242', 'fab28200-0000-4000-8000-000000000140', 'Plaque 60x40 mini-viennoiseries (40)',  62.00, 40, true,  1, '45e0b19d-f0de-4597-b703-d393d35ad888'),
  ('fab28200-0000-4000-8000-000000000243', 'fab28200-0000-4000-8000-000000000141', 'Plaque 60x40 mini-viennoiseries (40)',  59.00, 40, true,  1, '770a2b63-081a-4d78-925d-34ab31303813'),
  -- Briochés
  ('fab28200-0000-4000-8000-000000000244', 'fab28200-0000-4000-8000-000000000142', 'Plaque 60x40 viennoiseries (15)',       69.00, 15, true,  1, 'a79ae53d-b3c7-419d-a32f-77b01091bf5d'),
  ('fab28200-0000-4000-8000-000000000245', 'fab28200-0000-4000-8000-000000000143', 'Plaque 60x40 viennoiseries (12)',       81.00, 12, true,  1, '7449e5fc-067f-478e-ba70-e57ec3096822'),
  ('fab28200-0000-4000-8000-000000000246', 'fab28200-0000-4000-8000-000000000144', 'Plaque 60x40 viennoiseries (15)',       82.00, 15, true,  1, '75162647-9bd9-44ed-9903-d181a7723a80'),
  -- Flan, palmier, baguette
  ('fab28200-0000-4000-8000-000000000249', 'fab28200-0000-4000-8000-000000000147', 'Cercle à flan Ø28 x 5 cm',             167.17, 12, true,  1, '8bc9aa1b-f594-4980-910f-af9ab2a9caa3'),
  ('fab28200-0000-4000-8000-000000000250', 'fab28200-0000-4000-8000-000000000148', 'Plaque 60x40 viennoiseries (20)',       75.00, 20, true,  1, '4f0a47e0-972b-48ac-8e1a-f0c095c2f675'),
  ('fab28200-0000-4000-8000-000000000251', 'fab28200-0000-4000-8000-000000000149', 'Plaque 60x40 viennoiseries (12)',      100.00, 12, true,  1, 'c71932e5-be3b-4d27-803a-c421c91116ca'),
  -- Qrachel : normal / mini (le doublon « Mini 9rachel » est en 5b)
  ('fab28200-0000-4000-8000-000000000252', 'fab28200-0000-4000-8000-000000000150', 'Plaque 60x40 viennoiseries (15)',       76.00, 15, true,  1, '168c21bb-35db-4005-9f1a-a67dfd8b45ba'),
  ('fab28200-0000-4000-8000-000000000253', 'fab28200-0000-4000-8000-000000000150', 'Plaque 60x40 mini-viennoiseries (40)',  33.00, 40, false, 2, '55d9a743-7762-43e6-8719-db2189f43889')
) AS v (fid, rid, contenant, qpf, nb, def, ordre, pid)
JOIN production_contenants c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- 5b. Formats sans contenant : beignets (friture), doublon qrachel, plateaux.
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre, product_id)
SELECT v.fid::uuid, v.rid::uuid, NULL, v.qpf, 'g', v.nb, v.def, v.ordre, v.pid::uuid
FROM (VALUES
  -- Beignets : friture, pas de plaque de cuisson — fournée de 20 pièces
  ('fab28200-0000-4000-8000-000000000247', 'fab28200-0000-4000-8000-000000000145',   84.00::numeric, 20, true, 1, '509161ab-14f5-4825-97f4-68536c1dead8'),
  ('fab28200-0000-4000-8000-000000000248', 'fab28200-0000-4000-8000-000000000146',  108.00, 20, true, 1, 'e9babe89-4d45-4db0-bf23-81413d3a82b2'),
  -- Doublon POS « Mini 9rachel » (voir en-tête) : même pièce que Qrachel mini
  ('fab28200-0000-4000-8000-000000000254', 'fab28200-0000-4000-8000-000000000150',   33.00, 40, false, 3, 'cab86bdb-271a-4dee-8f64-1d925a7c03b3'),
  -- Plateaux : 1 plateau par « fournée », qpf = poids net total
  ('fab28200-0000-4000-8000-000000000255', 'fab28200-0000-4000-8000-000000000151',  891.00,  1, true, 1, 'e8ba8280-bed1-4996-9301-88535e2cf0c4'),
  ('fab28200-0000-4000-8000-000000000256', 'fab28200-0000-4000-8000-000000000152', 1675.00,  1, true, 1, 'b9d96b6f-aaf9-4e36-8acb-e71e785cd0e5')
) AS v (fid, rid, qpf, nb, def, ordre, pid)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_formats WHERE id::text LIKE 'fab28200%';
  IF n <> 56 THEN
    RAISE EXCEPTION 'Formats manquants : % sur 56 (contenant introuvable ?)', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomenclatures par format — quantités NETTES pour le contenant entier
--    (poids par pièce × nb de pièces). perte_pct = perte de mise en œuvre
--    (crèmes pochées 3 %, sinon 0).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id IN (SELECT id FROM recipe_formats WHERE id::text LIKE 'fab28200%');

-- 6a. Composants sous-recettes (en grammes).
--     Bases mig 280 : DOR=…0101 S30=…0102 PF=…0103 PLF=…0104 PB=…0105
--                     CP=…0108 CA=…0109 FR=…0110 FLAN=…0126
--     Bases mig 282 : PLFC=…0101 PLFK=…0102 BIC=…0103 CPC=…0104 CPP=…0105
--                     BEIG=…0106 QRA=…0107 VIEN=…0108
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, v.src::uuid, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Croissant — normal 15 × (90 PLF + 6 dorure)
  ('fab28200-0000-4000-8000-000000000201', 'fond',  'fab28000-0000-4000-8000-000000000104', 1350::numeric, 0::numeric, 1::smallint),
  ('fab28200-0000-4000-8000-000000000201', 'decor', 'fab28000-0000-4000-8000-000000000101',   90, 0, 2),
  -- Croissant — mini 40 × (38 + 4)
  ('fab28200-0000-4000-8000-000000000202', 'fond',  'fab28000-0000-4000-8000-000000000104', 1520, 0, 1),
  ('fab28200-0000-4000-8000-000000000202', 'decor', 'fab28000-0000-4000-8000-000000000101',  160, 0, 2),
  -- Croissant — américain 12 × (115 + 7)
  ('fab28200-0000-4000-8000-000000000203', 'fond',  'fab28000-0000-4000-8000-000000000104', 1380, 0, 1),
  ('fab28200-0000-4000-8000-000000000203', 'decor', 'fab28000-0000-4000-8000-000000000101',   84, 0, 2),
  -- Croissant complet — normal / mini
  ('fab28200-0000-4000-8000-000000000204', 'fond',  'fab28200-0000-4000-8000-000000000101', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000204', 'decor', 'fab28000-0000-4000-8000-000000000101',   90, 0, 2),
  ('fab28200-0000-4000-8000-000000000205', 'fond',  'fab28200-0000-4000-8000-000000000101', 1520, 0, 1),
  ('fab28200-0000-4000-8000-000000000205', 'decor', 'fab28000-0000-4000-8000-000000000101',  160, 0, 2),
  -- Croissant céréales — normal / mini (graines topping en 6b)
  ('fab28200-0000-4000-8000-000000000206', 'fond',  'fab28200-0000-4000-8000-000000000102', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000206', 'decor', 'fab28000-0000-4000-8000-000000000101',   90, 0, 2),
  ('fab28200-0000-4000-8000-000000000207', 'fond',  'fab28200-0000-4000-8000-000000000102', 1520, 0, 1),
  ('fab28200-0000-4000-8000-000000000207', 'decor', 'fab28000-0000-4000-8000-000000000101',  120, 0, 2),
  -- Croissant bicolore — 15 × (90 + 4 sirop brillance à la sortie du four)
  ('fab28200-0000-4000-8000-000000000208', 'fond',    'fab28200-0000-4000-8000-000000000103', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000208', 'nappage', 'fab28000-0000-4000-8000-000000000102',   60, 0, 2),
  -- Croissant au chocolat noir — 15 × (85 + 6) + gouttes en 6b
  ('fab28200-0000-4000-8000-000000000209', 'fond',  'fab28000-0000-4000-8000-000000000104', 1275, 0, 1),
  ('fab28200-0000-4000-8000-000000000209', 'decor', 'fab28000-0000-4000-8000-000000000101',   90, 0, 3),
  -- Pain au chocolat — normal 15 × (95 + 5), bâtons en 6b
  ('fab28200-0000-4000-8000-000000000210', 'fond',  'fab28000-0000-4000-8000-000000000104', 1425, 0, 1),
  ('fab28200-0000-4000-8000-000000000210', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 3),
  -- Pain au chocolat — mini 40 × (40 + 3)
  ('fab28200-0000-4000-8000-000000000211', 'fond',  'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000211', 'decor', 'fab28000-0000-4000-8000-000000000101',  120, 0, 3),
  -- Pain au chocolat complet — normal / mini
  ('fab28200-0000-4000-8000-000000000212', 'fond',  'fab28200-0000-4000-8000-000000000101', 1425, 0, 1),
  ('fab28200-0000-4000-8000-000000000212', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 3),
  ('fab28200-0000-4000-8000-000000000213', 'fond',  'fab28200-0000-4000-8000-000000000101', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000213', 'decor', 'fab28000-0000-4000-8000-000000000101',  120, 0, 3),
  -- Pain au chocolat céréales — normal / mini
  ('fab28200-0000-4000-8000-000000000214', 'fond',  'fab28200-0000-4000-8000-000000000102', 1425, 0, 1),
  ('fab28200-0000-4000-8000-000000000214', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 3),
  ('fab28200-0000-4000-8000-000000000215', 'fond',  'fab28200-0000-4000-8000-000000000102', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000215', 'decor', 'fab28000-0000-4000-8000-000000000101',  120, 0, 3),
  -- Pain au chocolat bicolore — 15 × (95 + 4 sirop)
  ('fab28200-0000-4000-8000-000000000216', 'fond',    'fab28200-0000-4000-8000-000000000103', 1425, 0, 1),
  ('fab28200-0000-4000-8000-000000000216', 'nappage', 'fab28000-0000-4000-8000-000000000102',   60, 0, 3),
  -- Pain au chocolat noir — 15 × (90 + 5)
  ('fab28200-0000-4000-8000-000000000217', 'fond',  'fab28000-0000-4000-8000-000000000104', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000217', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 3),
  -- Pain double choco — 15 × (90 bicolore + 4 sirop), bâtons + drops en 6b
  ('fab28200-0000-4000-8000-000000000218', 'fond',    'fab28200-0000-4000-8000-000000000103', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000218', 'nappage', 'fab28000-0000-4000-8000-000000000102',   60, 0, 4),
  -- Pain suisse — normal 12 × (100 PLF + 40 crème + 5 dorure), pépites en 6b
  ('fab28200-0000-4000-8000-000000000219', 'fond',      'fab28000-0000-4000-8000-000000000104', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000219', 'garniture', 'fab28000-0000-4000-8000-000000000108',  480, 3, 2),
  ('fab28200-0000-4000-8000-000000000219', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Pain suisse — mini 40 × (40 + 18 + 3)
  ('fab28200-0000-4000-8000-000000000220', 'fond',      'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000220', 'garniture', 'fab28000-0000-4000-8000-000000000108',  720, 3, 2),
  ('fab28200-0000-4000-8000-000000000220', 'decor',     'fab28000-0000-4000-8000-000000000101',  120, 0, 4),
  -- Pain suisse céréales — 12 × (100 + 40 + 5)
  ('fab28200-0000-4000-8000-000000000221', 'fond',      'fab28200-0000-4000-8000-000000000102', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000221', 'garniture', 'fab28000-0000-4000-8000-000000000108',  480, 3, 2),
  ('fab28200-0000-4000-8000-000000000221', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Pain suisse pistache — 12 × (100 + 35 crème pistache + 5)
  ('fab28200-0000-4000-8000-000000000222', 'fond',      'fab28000-0000-4000-8000-000000000104', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000222', 'garniture', 'fab28200-0000-4000-8000-000000000105',  420, 3, 2),
  ('fab28200-0000-4000-8000-000000000222', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Pain suisse noir — 12 × (100 bicolore + 35 crème + 4 sirop)
  ('fab28200-0000-4000-8000-000000000223', 'fond',      'fab28200-0000-4000-8000-000000000103', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000223', 'garniture', 'fab28000-0000-4000-8000-000000000108',  420, 3, 2),
  ('fab28200-0000-4000-8000-000000000223', 'nappage',   'fab28000-0000-4000-8000-000000000102',   48, 0, 4),
  -- Coque suisse — 15 × (55 brioche + 25 crème + 4 dorure), sucre grain en 6b
  ('fab28200-0000-4000-8000-000000000224', 'fond',      'fab28000-0000-4000-8000-000000000105',  825, 0, 1),
  ('fab28200-0000-4000-8000-000000000224', 'garniture', 'fab28000-0000-4000-8000-000000000108',  375, 3, 2),
  ('fab28200-0000-4000-8000-000000000224', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Pain aux raisins — normal 15 × (90 + 30 crème + 5 sirop), raisins en 6b
  ('fab28200-0000-4000-8000-000000000225', 'fond',      'fab28000-0000-4000-8000-000000000104', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000225', 'garniture', 'fab28000-0000-4000-8000-000000000108',  450, 3, 2),
  ('fab28200-0000-4000-8000-000000000225', 'nappage',   'fab28000-0000-4000-8000-000000000102',   75, 0, 4),
  -- Pain aux raisins — mini 40 × (40 + 14 + 2)
  ('fab28200-0000-4000-8000-000000000226', 'fond',      'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000226', 'garniture', 'fab28000-0000-4000-8000-000000000108',  560, 3, 2),
  ('fab28200-0000-4000-8000-000000000226', 'nappage',   'fab28000-0000-4000-8000-000000000102',   80, 0, 4),
  -- Torsade — 15 × (80 + 20 + 4)
  ('fab28200-0000-4000-8000-000000000227', 'fond',      'fab28000-0000-4000-8000-000000000104', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000227', 'garniture', 'fab28000-0000-4000-8000-000000000108',  300, 3, 2),
  ('fab28200-0000-4000-8000-000000000227', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 3),
  -- Torsade choco — 15 × (85 + 25 + 4), pépites en 6b
  ('fab28200-0000-4000-8000-000000000228', 'fond',      'fab28000-0000-4000-8000-000000000104', 1275, 0, 1),
  ('fab28200-0000-4000-8000-000000000228', 'garniture', 'fab28000-0000-4000-8000-000000000108',  375, 3, 2),
  ('fab28200-0000-4000-8000-000000000228', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Danish abricot — 12 × (85 + 25 + 5), oreillons + nappage en 6b
  ('fab28200-0000-4000-8000-000000000229', 'fond',      'fab28000-0000-4000-8000-000000000104', 1020, 0, 1),
  ('fab28200-0000-4000-8000-000000000229', 'garniture', 'fab28000-0000-4000-8000-000000000108',  300, 3, 2),
  ('fab28200-0000-4000-8000-000000000229', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 5),
  -- Danish framboise/choco — 12 × (85 + 20 + 5)
  ('fab28200-0000-4000-8000-000000000230', 'fond',      'fab28000-0000-4000-8000-000000000104', 1020, 0, 1),
  ('fab28200-0000-4000-8000-000000000230', 'garniture', 'fab28000-0000-4000-8000-000000000108',  240, 3, 2),
  ('fab28200-0000-4000-8000-000000000230', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 5),
  -- Danish chocolat — 12 × (85 + 30 crème choco + 5)
  ('fab28200-0000-4000-8000-000000000231', 'fond',      'fab28000-0000-4000-8000-000000000104', 1020, 0, 1),
  ('fab28200-0000-4000-8000-000000000231', 'garniture', 'fab28200-0000-4000-8000-000000000104',  360, 3, 2),
  ('fab28200-0000-4000-8000-000000000231', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 4),
  -- Danish fruits — 12 × (85 + 25 + 5), fruits + nappage en 6b
  ('fab28200-0000-4000-8000-000000000232', 'fond',      'fab28000-0000-4000-8000-000000000104', 1020, 0, 1),
  ('fab28200-0000-4000-8000-000000000232', 'garniture', 'fab28000-0000-4000-8000-000000000108',  300, 3, 2),
  ('fab28200-0000-4000-8000-000000000232', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 6),
  -- Chausson aux pommes — 12 × (80 feuilletée + 6 dorure), compote en 6b
  ('fab28200-0000-4000-8000-000000000233', 'fond',  'fab28000-0000-4000-8000-000000000103',  960, 0, 1),
  ('fab28200-0000-4000-8000-000000000233', 'decor', 'fab28000-0000-4000-8000-000000000101',   72, 0, 3),
  -- Jalousie abricot — 15 × (55 + 12 crème + 4 dorure)
  ('fab28200-0000-4000-8000-000000000234', 'fond',      'fab28000-0000-4000-8000-000000000103',  825, 0, 1),
  ('fab28200-0000-4000-8000-000000000234', 'garniture', 'fab28000-0000-4000-8000-000000000108',  180, 3, 2),
  ('fab28200-0000-4000-8000-000000000234', 'decor',     'fab28000-0000-4000-8000-000000000101',   60, 0, 5),
  -- Jalousie aux amandes — 15 × (75 + 35 frangipane + 5 dorure)
  ('fab28200-0000-4000-8000-000000000235', 'fond',      'fab28000-0000-4000-8000-000000000103', 1125, 0, 1),
  ('fab28200-0000-4000-8000-000000000235', 'garniture', 'fab28000-0000-4000-8000-000000000110',  525, 3, 2),
  ('fab28200-0000-4000-8000-000000000235', 'decor',     'fab28000-0000-4000-8000-000000000101',   75, 0, 5),
  -- Jalousie aux pommes — 15 × (75 + 5 dorure)
  ('fab28200-0000-4000-8000-000000000236', 'fond',  'fab28000-0000-4000-8000-000000000103', 1125, 0, 1),
  ('fab28200-0000-4000-8000-000000000236', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 3),
  -- Jalousie rond pomme — 15 × (65 + 4 dorure)
  ('fab28200-0000-4000-8000-000000000237', 'fond',  'fab28000-0000-4000-8000-000000000103',  975, 0, 1),
  ('fab28200-0000-4000-8000-000000000237', 'decor', 'fab28000-0000-4000-8000-000000000101',   60, 0, 3),
  -- Fourré amande — normal 15 × (90 + 30 frangipane + 5 dorure)
  ('fab28200-0000-4000-8000-000000000238', 'fond',      'fab28000-0000-4000-8000-000000000104', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000238', 'garniture', 'fab28000-0000-4000-8000-000000000110',  450, 3, 2),
  ('fab28200-0000-4000-8000-000000000238', 'decor',     'fab28000-0000-4000-8000-000000000101',   75, 0, 5),
  -- Fourré amande — mini 40 × (40 + 14 + 3)
  ('fab28200-0000-4000-8000-000000000239', 'fond',      'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000239', 'garniture', 'fab28000-0000-4000-8000-000000000110',  560, 3, 2),
  ('fab28200-0000-4000-8000-000000000239', 'decor',     'fab28000-0000-4000-8000-000000000101',  120, 0, 5),
  -- Fourré pistache — normal 15 × (90 + 30 crème pistache + 5)
  ('fab28200-0000-4000-8000-000000000240', 'fond',      'fab28000-0000-4000-8000-000000000104', 1350, 0, 1),
  ('fab28200-0000-4000-8000-000000000240', 'garniture', 'fab28200-0000-4000-8000-000000000105',  450, 3, 2),
  ('fab28200-0000-4000-8000-000000000240', 'decor',     'fab28000-0000-4000-8000-000000000101',   75, 0, 4),
  -- Fourré pistache — mini 40 × (40 + 14 + 3)
  ('fab28200-0000-4000-8000-000000000241', 'fond',      'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000241', 'garniture', 'fab28200-0000-4000-8000-000000000105',  560, 3, 2),
  ('fab28200-0000-4000-8000-000000000241', 'decor',     'fab28000-0000-4000-8000-000000000101',  120, 0, 4),
  -- Fourré chocolat mini — 40 × (40 + 15 crème choco + 3)
  ('fab28200-0000-4000-8000-000000000242', 'fond',      'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000242', 'garniture', 'fab28200-0000-4000-8000-000000000104',  600, 3, 2),
  ('fab28200-0000-4000-8000-000000000242', 'decor',     'fab28000-0000-4000-8000-000000000101',  120, 0, 4),
  -- Fourré citron mini — 40 × (40 + 3), crème citron (ingrédient) en 6b
  ('fab28200-0000-4000-8000-000000000243', 'fond',  'fab28000-0000-4000-8000-000000000104', 1600, 0, 1),
  ('fab28200-0000-4000-8000-000000000243', 'decor', 'fab28000-0000-4000-8000-000000000101',  120, 0, 4),
  -- Brioche — 15 × (60 + 5 dorure), sucre grain en 6b
  ('fab28200-0000-4000-8000-000000000244', 'fond',  'fab28000-0000-4000-8000-000000000105',  900, 0, 1),
  ('fab28200-0000-4000-8000-000000000244', 'decor', 'fab28000-0000-4000-8000-000000000101',   75, 0, 2),
  -- Bostock amande — 12 × (40 brioche + 15 sirop + 20 crème amande)
  ('fab28200-0000-4000-8000-000000000245', 'fond',      'fab28000-0000-4000-8000-000000000105',  480, 0, 1),
  ('fab28200-0000-4000-8000-000000000245', 'imbibage',  'fab28000-0000-4000-8000-000000000102',  180, 0, 2),
  ('fab28200-0000-4000-8000-000000000245', 'garniture', 'fab28000-0000-4000-8000-000000000109',  240, 3, 3),
  -- Navette aux framboises — 15 × (60 viennoise), confiture en 6b
  ('fab28200-0000-4000-8000-000000000246', 'fond', 'fab28200-0000-4000-8000-000000000108',  900, 0, 1),
  -- Beignet sucré — 20 × (70 pâte)
  ('fab28200-0000-4000-8000-000000000247', 'fond', 'fab28200-0000-4000-8000-000000000106', 1400, 0, 1),
  -- Beignets fourrés — 20 × (70 pâte + 8 crème choco)
  ('fab28200-0000-4000-8000-000000000248', 'fond',      'fab28200-0000-4000-8000-000000000106', 1400, 0, 1),
  ('fab28200-0000-4000-8000-000000000248', 'garniture', 'fab28200-0000-4000-8000-000000000104',  160, 3, 2),
  -- Flan vanille — cercle Ø28 : 350 g feuilletée + 1656 g d'appareil (net)
  ('fab28200-0000-4000-8000-000000000249', 'fond',      'fab28000-0000-4000-8000-000000000103',  350, 0, 1),
  ('fab28200-0000-4000-8000-000000000249', 'garniture', 'fab28000-0000-4000-8000-000000000126', 1656, 0, 2),
  -- Palmier — 20 × (60 feuilletée), sucre en 6b
  ('fab28200-0000-4000-8000-000000000250', 'fond', 'fab28000-0000-4000-8000-000000000103', 1200, 0, 1),
  -- Baguette sucrée — 12 × (90 viennoise + 4 dorure)
  ('fab28200-0000-4000-8000-000000000251', 'fond',  'fab28200-0000-4000-8000-000000000108', 1080, 0, 1),
  ('fab28200-0000-4000-8000-000000000251', 'decor', 'fab28000-0000-4000-8000-000000000101',   48, 0, 3),
  -- Qrachel — normal 15 × (70 + 4 dorure)
  ('fab28200-0000-4000-8000-000000000252', 'fond',  'fab28200-0000-4000-8000-000000000107', 1050, 0, 1),
  ('fab28200-0000-4000-8000-000000000252', 'decor', 'fab28000-0000-4000-8000-000000000101',   60, 0, 3),
  -- Qrachel — mini 40 × (30 + 2) et doublon POS identique
  ('fab28200-0000-4000-8000-000000000253', 'fond',  'fab28200-0000-4000-8000-000000000107', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000253', 'decor', 'fab28000-0000-4000-8000-000000000101',   80, 0, 3),
  ('fab28200-0000-4000-8000-000000000254', 'fond',  'fab28200-0000-4000-8000-000000000107', 1200, 0, 1),
  ('fab28200-0000-4000-8000-000000000254', 'decor', 'fab28000-0000-4000-8000-000000000101',   80, 0, 3)
) AS v (fid, role, src, qte, perte, ordre);

-- 6b. Composants ingrédients (en grammes), résolus par la temp table.
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, ing.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Graines topping des céréales (2 g/pièce normale, 1 g/mini)
  ('fab28200-0000-4000-8000-000000000206', 'decor', 'Mélange de graines',                 30::numeric, 0::numeric, 3::smallint),
  ('fab28200-0000-4000-8000-000000000207', 'decor', 'Mélange de graines',                 40, 0, 3),
  ('fab28200-0000-4000-8000-000000000214', 'decor', 'Mélange de graines',                 30, 0, 4),
  ('fab28200-0000-4000-8000-000000000215', 'decor', 'Mélange de graines',                 40, 0, 4),
  ('fab28200-0000-4000-8000-000000000221', 'decor', 'Mélange de graines',                 24, 0, 5),
  -- Gouttes noir 50 % (croissant au chocolat noir : 8 g/pièce)
  ('fab28200-0000-4000-8000-000000000209', 'garniture', 'Gouttes drops 50% DGF',         120, 0, 2),
  -- Bâtons boulangers : 2 bâtons (7 g) par pièce normale, 1 bâton (3,5 g) par mini
  ('fab28200-0000-4000-8000-000000000210', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  ('fab28200-0000-4000-8000-000000000211', 'garniture', 'Bâtons boulangers 500 BTS',     140, 0, 2),
  ('fab28200-0000-4000-8000-000000000212', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  ('fab28200-0000-4000-8000-000000000213', 'garniture', 'Bâtons boulangers 500 BTS',     140, 0, 2),
  ('fab28200-0000-4000-8000-000000000214', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  ('fab28200-0000-4000-8000-000000000215', 'garniture', 'Bâtons boulangers 500 BTS',     140, 0, 2),
  ('fab28200-0000-4000-8000-000000000216', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  ('fab28200-0000-4000-8000-000000000217', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  ('fab28200-0000-4000-8000-000000000218', 'garniture', 'Bâtons boulangers 500 BTS',     105, 0, 2),
  -- Pépites boulangères (pains suisses, torsade choco, double choco, fourré choco)
  ('fab28200-0000-4000-8000-000000000218', 'garniture', 'Chocolat cookies drops',         90, 0, 3),
  ('fab28200-0000-4000-8000-000000000219', 'garniture', 'Chocolat cookies drops',        180, 0, 3),
  ('fab28200-0000-4000-8000-000000000220', 'garniture', 'Chocolat cookies drops',        240, 0, 3),
  ('fab28200-0000-4000-8000-000000000221', 'garniture', 'Chocolat cookies drops',        180, 0, 3),
  ('fab28200-0000-4000-8000-000000000223', 'garniture', 'Chocolat cookies drops',        144, 0, 3),
  ('fab28200-0000-4000-8000-000000000228', 'garniture', 'Chocolat cookies drops',        180, 0, 3),
  ('fab28200-0000-4000-8000-000000000230', 'garniture', 'Chocolat cookies drops',         96, 0, 4),
  ('fab28200-0000-4000-8000-000000000231', 'garniture', 'Chocolat cookies drops',         72, 0, 3),
  ('fab28200-0000-4000-8000-000000000242', 'garniture', 'Chocolat cookies drops',        160, 0, 3),
  -- Pistaches concassées (pain suisse et fourrés pistache)
  ('fab28200-0000-4000-8000-000000000222', 'decor', 'Pistache décortiquée',               36, 0, 3),
  ('fab28200-0000-4000-8000-000000000240', 'decor', 'Pistache décortiquée',               60, 0, 3),
  ('fab28200-0000-4000-8000-000000000241', 'decor', 'Pistache décortiquée',               60, 0, 3),
  -- Sucre grain (coque suisse, brioche, baguette sucrée)
  ('fab28200-0000-4000-8000-000000000224', 'decor', 'Sucre grain CAL 10',                 60, 0, 3),
  ('fab28200-0000-4000-8000-000000000244', 'decor', 'Sucre grain CAL 10',                 60, 0, 3),
  ('fab28200-0000-4000-8000-000000000251', 'decor', 'Sucre grain CAL 10',                 72, 0, 2),
  -- Raisins secs (pains aux raisins : 15 g/pièce, 7 g/mini)
  ('fab28200-0000-4000-8000-000000000225', 'fruits', 'Raisins secs',                     225, 0, 3),
  ('fab28200-0000-4000-8000-000000000226', 'fruits', 'Raisins secs',                     280, 0, 3),
  -- Oreillons d'abricot (danish et jalousie abricot)
  ('fab28200-0000-4000-8000-000000000229', 'fruits', 'Oreillons d''abricot au sirop',    360, 0, 3),
  ('fab28200-0000-4000-8000-000000000234', 'fruits', 'Oreillons d''abricot au sirop',    225, 0, 3),
  -- Nappage neutre (brillance des danish et jalousies fruitées)
  ('fab28200-0000-4000-8000-000000000229', 'nappage', 'Nappage neutre',                   72, 2, 4),
  ('fab28200-0000-4000-8000-000000000232', 'nappage', 'Nappage neutre',                   72, 2, 5),
  ('fab28200-0000-4000-8000-000000000234', 'nappage', 'Nappage neutre',                   60, 2, 4),
  -- Confiture de framboise (danish, navette, beignets fourrés)
  ('fab28200-0000-4000-8000-000000000230', 'fruits', 'Confiture de framboise',           180, 0, 3),
  ('fab28200-0000-4000-8000-000000000246', 'fruits', 'Confiture de framboise',           300, 0, 2),
  ('fab28200-0000-4000-8000-000000000248', 'fruits', 'Confiture de framboise',           160, 0, 4),
  -- Fruits frais du danish fruits
  ('fab28200-0000-4000-8000-000000000232', 'fruits', 'Fraise',                           180, 0, 3),
  ('fab28200-0000-4000-8000-000000000232', 'fruits', 'Kiwi',                             120, 0, 4),
  -- Compote de pomme (chausson et jalousies pommes)
  ('fab28200-0000-4000-8000-000000000233', 'fruits', 'Compote de pomme Valade',          480, 0, 2),
  ('fab28200-0000-4000-8000-000000000236', 'fruits', 'Compote de pomme Valade',          450, 0, 2),
  ('fab28200-0000-4000-8000-000000000237', 'fruits', 'Compote de pomme Valade',          375, 0, 2),
  -- Amandes effilées (jalousie et fourré amande, bostock)
  ('fab28200-0000-4000-8000-000000000235', 'decor', 'Amande effilée',                     60, 0, 3),
  ('fab28200-0000-4000-8000-000000000238', 'decor', 'Amande effilée',                     75, 0, 3),
  ('fab28200-0000-4000-8000-000000000239', 'decor', 'Amande effilée',                     80, 0, 3),
  ('fab28200-0000-4000-8000-000000000245', 'decor', 'Amande effilée',                     48, 0, 4),
  -- Sucre glace de finition
  ('fab28200-0000-4000-8000-000000000235', 'decor', 'Sucre glace',                        30, 0, 4),
  ('fab28200-0000-4000-8000-000000000238', 'decor', 'Sucre glace',                        30, 0, 4),
  ('fab28200-0000-4000-8000-000000000239', 'decor', 'Sucre glace',                        40, 0, 4),
  ('fab28200-0000-4000-8000-000000000243', 'decor', 'Sucre glace',                        40, 0, 3),
  ('fab28200-0000-4000-8000-000000000245', 'decor', 'Sucre glace',                        24, 0, 5),
  ('fab28200-0000-4000-8000-000000000246', 'decor', 'Sucre glace',                        30, 0, 3),
  -- Crème citron industrielle (fourré citron mini, beignets fourrés)
  ('fab28200-0000-4000-8000-000000000243', 'garniture', 'Crème citron',                  600, 3, 2),
  ('fab28200-0000-4000-8000-000000000248', 'garniture', 'Crème citron',                  160, 3, 3),
  -- Sucre semoule d'enrobage (beignets, palmier)
  ('fab28200-0000-4000-8000-000000000247', 'decor', 'Sucre semoule',                     160, 0, 2),
  ('fab28200-0000-4000-8000-000000000248', 'decor', 'Sucre semoule',                     160, 0, 5),
  ('fab28200-0000-4000-8000-000000000250', 'decor', 'Sucre semoule',                     300, 0, 2),
  -- Huile absorbée à la friture des beignets (~6 g/pièce)
  ('fab28200-0000-4000-8000-000000000247', 'imbibage', 'Huile de table',                 120, 0, 3),
  ('fab28200-0000-4000-8000-000000000248', 'imbibage', 'Huile de table',                 120, 0, 6),
  -- Sésame de surface des qrachels
  ('fab28200-0000-4000-8000-000000000252', 'decor', 'Sésame décortiqué',                  30, 0, 2),
  ('fab28200-0000-4000-8000-000000000253', 'decor', 'Sésame décortiqué',                  40, 0, 2),
  ('fab28200-0000-4000-8000-000000000254', 'decor', 'Sésame décortiqué',                  40, 0, 2)
) AS v (fid, role, ingredient, qte, perte, ordre)
JOIN _v282_ing ing ON ing.name = v.ingredient;

-- 6c. Plateaux : composants en 'unit' = équivalents-pièces du format par défaut
--     du composant (voir l'en-tête — des grammes seraient mal convertis).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES
  -- Mini plateau — 18 minis : 6 croissants (6×42/96), 6 pains choc (6×46,5/107),
  -- 6 fourrés amande (6×60/132)
  ('fab28200-0000-4000-8000-000000000255', 'garniture', 'fab28200-0000-4000-8000-000000000110', 2.63, 'unit', 0, 1),
  ('fab28200-0000-4000-8000-000000000255', 'garniture', 'fab28200-0000-4000-8000-000000000115', 2.61, 'unit', 0, 2),
  ('fab28200-0000-4000-8000-000000000255', 'garniture', 'fab28200-0000-4000-8000-000000000138', 2.73, 'unit', 0, 3),
  -- Plateau — 15 pièces normales : 5 croissants + 5 pains choc + 5 fourrés amande
  ('fab28200-0000-4000-8000-000000000256', 'garniture', 'fab28200-0000-4000-8000-000000000110', 5, 'unit', 0, 1),
  ('fab28200-0000-4000-8000-000000000256', 'garniture', 'fab28200-0000-4000-8000-000000000115', 5, 'unit', 0, 2),
  ('fab28200-0000-4000-8000-000000000256', 'garniture', 'fab28200-0000-4000-8000-000000000138', 5, 'unit', 0, 3);

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
  FROM recipe_format_components c
  WHERE c.format_id IN (SELECT id FROM recipe_formats WHERE id::text LIKE 'fab28200%');
  IF n <> 198 THEN
    RAISE EXCEPTION 'Nomenclatures incomplètes : % ligne(s) sur 198 attendues', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DÉFAUT (mig 205/218).
--    v_recipe_total_cost lit ce miroir pour les recettes composées : sans lui,
--    tout coûterait 0.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components WHERE recipe_id::text LIKE 'fab28200%';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
WHERE f.id::text LIKE 'fab28200%' AND f.is_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Étapes et instructions des 5 fiches phares.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Détaillage et façonnage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Abaisse PLF à 4 mm, pâte à 4-6 °C — si elle colle, retour au froid 15 min",
     "Triangles base 9 cm : 90 g pièce, 38 g mini, 115 g américain — peser 1 pâton sur 5",
     "Rouler sans serrer, pointe DESSOUS, sans écraser le feuilletage",
     "Pas de farine entre les couches : elle empêche la soudure"]},
  {"ordre":2,"nom":"Apprêt","duree_estimee_min":120,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-28 °C, jamais plus de 28 °C : le beurre de tourage fondrait",
     "2 h : le croissant tremble comme une gelée quand on secoue la plaque",
     "Hygrométrie 75-80 % — sans étuve, couvrir d''un plastique sans contact"]},
  {"ordre":3,"nom":"Dorure","duree_estimee_min":10,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure en 2 passes fines au pinceau souple, jamais sur la tranche du feuilletage",
     "6 g par pièce, 4 g par mini"]},
  {"ordre":4,"nom":"Cuisson","duree_estimee_min":18,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four ventilé 170 °C : 16-18 min pièce, 10-12 min mini",
     "Oura ouvert les 3 dernières minutes pour sécher le feuilletage",
     "Couleur ambre profond, dessous doré — perte de cuisson attendue 10-12 %",
     "Ressuage sur grille, JAMAIS sur plaque pleine (condensation)"]}
]'::jsonb,
instructions = 'Pâton 90 g cru (mini 38 g, américain 115 g), pièce cuite ~80 g après 10-12 % de perte au four.
Apprêt 26-28 °C / 2 h. Cuisson 170 °C ventilé 16-18 min.
Conservation : jour même ; pâtons façonnés crus 48 h à 4 °C ou 1 mois surgelés (apprêt au retour).
Allergènes : gluten, œuf (dorure), lait et beurre.',
updated_at = NOW()
WHERE id = 'fab28200-0000-4000-8000-000000000110';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Détaillage et façonnage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Rectangles 8 × 12 cm : 95 g pièce, 40 g mini",
     "2 bâtons boulangers par pièce (1 par mini), posés à 1 cm des bords",
     "Rouler serré, clé de soudure DESSOUS et bien centrée",
     "Aligner les clés sur la plaque : une clé sur le côté = pain qui s''ouvre au four"]},
  {"ordre":2,"nom":"Apprêt","duree_estimee_min":120,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-28 °C, 2 h : volume × 2, tremblant à la secousse",
     "Jamais plus de 28 °C (beurre de tourage)"]},
  {"ordre":3,"nom":"Dorure et cuisson","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure fine en 2 passes, sans couler sur les strates",
     "Four ventilé 170 °C : 16-18 min pièce, 10-12 min mini",
     "Le chocolat ne doit pas percer : s''il fuit, bâtons trop près du bord au façonnage",
     "Ressuage sur grille 20 min avant vente"]}
]'::jsonb,
instructions = 'Pâton 95 g + 2 bâtons boulangers (mini : 40 g + 1 bâton). Perte de cuisson 10-12 %.
Apprêt 26-28 °C / 2 h. Cuisson 170 °C ventilé.
Conservation : jour même. Allergènes : gluten, œuf, lait et beurre, soja (lécithine du chocolat).',
updated_at = NOW()
WHERE id = 'fab28200-0000-4000-8000-000000000115';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Garnissage et façonnage","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Abaisse PLF 4 mm en bande de 30 cm de haut",
     "Crème pâtissière LISSÉE au fouet puis étalée à la palette : 40 g par pièce, sur la moitié basse",
     "Pépites réparties sur la crème (15 g/pièce), rabattre, souder au rouleau",
     "Détailler des rectangles de 4 cm au couteau de tour — coupe franche, sans scier"]},
  {"ordre":2,"nom":"Apprêt","duree_estimee_min":110,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-28 °C, 1 h 45 : la crème ne doit pas croûter (couvrir si besoin)"]},
  {"ordre":3,"nom":"Dorure et cuisson","duree_estimee_min":22,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure sur la pâte seulement, jamais sur la crème (elle brûlerait)",
     "Four ventilé 165-170 °C, 18 min : la crème doit rester crémeuse, pas soufflée",
     "Refroidissement complet sur grille avant mise en rayon (crème = froid rapide)"]}
]'::jsonb,
instructions = 'Pièce : 100 g PLF + 40 g crème pâtissière + 15 g pépites (mini : 40 + 18 + 6). Perte de cuisson ~10 %.
Produit à crème : refroidir vite, vitrine réfrigérée, J+1 maximum à +4 °C.
Allergènes : gluten, œuf, lait et beurre, soja.',
updated_at = NOW()
WHERE id = 'fab28200-0000-4000-8000-000000000121';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Fonçage du cercle","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Feuilletée abaissée à 2,5 mm, foncer le cercle Ø28 beurré SANS étirer la pâte",
     "Bords à hauteur du cercle (5 cm), piquer le fond à la fourchette",
     "Repos 30 min au froid avant de couler : le fond ne se rétracte plus"]},
  {"ordre":2,"nom":"Appareil et coulage","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Appareil porté juste à ébullition en fouettant, couler CHAUD dans le fond froid",
     "Remplir à 5 mm du bord, lisser à la palette"]},
  {"ordre":3,"nom":"Cuisson","duree_estimee_min":50,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four sole 180 °C, 45-50 min : surface caramel foncé taché de brun, c''est la signature du flan",
     "Le centre doit encore trembler à la sortie : il fige au refroidissement",
     "JAMAIS démouler chaud"]},
  {"ordre":4,"nom":"Refroidissement et découpe","duree_estimee_min":240,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "4 h à +4 °C minimum avant découpe",
     "12 parts au couteau trempé dans l''eau chaude et essuyé à chaque coupe"]}
]'::jsonb,
instructions = 'Cercle Ø28 x 5 cm : 350 g de feuilletée + 1 656 g d''appareil vanille (une fournée d''appareil nette = 1 cercle). 12 parts.
Conservation : 48 h à +4 °C. Allergènes : gluten, œuf, lait.',
updated_at = NOW()
WHERE id = 'fab28200-0000-4000-8000-000000000147';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Façonnage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Boules de 70 g (mini 30 g), boulées serrées puis aplaties à 1,5 cm",
     "La pâte sent l''anis et la fleur d''oranger : sinon, pétrissage à revoir"]},
  {"ordre":2,"nom":"Apprêt et dorure","duree_estimee_min":75,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pousse 1 h à 27 °C",
     "Dorure + sésame décortiqué en surface, rayures en croisillon à la lame"]},
  {"ordre":3,"nom":"Cuisson","duree_estimee_min":18,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four ventilé 170 °C : 15-16 min pièce, 10 min mini, blond doré uniforme",
     "Ressuage sur grille : la mie doit rester moelleuse, c''est un produit du goûter"]}
]'::jsonb,
instructions = 'Brioche marocaine à l''anis, au sésame et à la fleur d''oranger. Pâton 70 g (mini 30 g), perte de cuisson ~12 %.
Conservation : 48 h en sachet. Allergènes : gluten, œuf, lait, sésame.',
updated_at = NOW()
WHERE id = 'fab28200-0000-4000-8000-000000000150';
