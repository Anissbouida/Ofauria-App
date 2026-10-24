-- Migration 281 : Fiches techniques boulangerie — baguettes, traditions, pains ronds
--
-- POURQUOI
--   Injection des fiches techniques de la gamme pain (32 produits vendus :
--   9 BAGUETTE, 9 BAGUETTE TRADITION, 14 PAIN ROND) sur le modele de l'Opera
--   (migs 273/276) : bases familiales petries au kg de farine, produits finis
--   composes, un format par produit vendu (recipe_formats.product_id).
--
--   Structure produite :
--     11 bases (is_base = true, mode_cout = ratio_poids, categorie base_production)
--        Levain liquide + 10 pates : courante, tradition (autolyse + levain),
--        complete, complete sans sel, semoule, orge, mais, sandwich,
--        choufane (avoine), pain maison.
--     24 produits finis (mode_cout = compose, categorie boulangerie)
--     32 formats, chacun lie a son product_id (verifie en aval).
--
-- ─── CONVENTION PATON (choisie et appliquee PARTOUT dans ce fichier) ───
--   Le composant 'pate' d'un format = poids NET CUIT total pour le contenant,
--   et la perte de cuisson + ressuage est portee par perte_pct DE LA LIGNE :
--     consommation de pate crue = quantite / (1 - perte_pct/100)
--     (c'est la formule de v_recipe_component_cost, mig 265).
--   Pertes retenues : baguettes 20 %, pains ronds 18 %, pains sandwich
--   et petits pains moelleux 15 %.
--   Les BASES pate ont perte_standard_pct = 0 : yield_quantity = pesee CRUE
--   au petrin ; toute la perte de transformation est sur le produit fini.
--   quantite_par_format = poids NET d'UNE piece finie (pate cuite + garnitures),
--   donc somme(composants) = nb_par_defaut x quantite_par_format, exactement.
--   poids_cru_g = paton cru + garnitures d'une piece ; poids_cuit_g = le net.
--
-- ─── SANITE PRIX (pain a prix cadre) ───
--   Farine boulangerie = 3,40 DH/kg en base (farine nationale, coherent).
--   Pate courante ~ 2,48 DH/kg petrie ; une baguette normale (paton 350 g,
--   cuite 280 g) sort a ~0,87 DH de matiere pour 1,50 DH de vente : dans le
--   couloir demande 0,8 - 1,3 DH. Le ratio 20-40 % ne s'applique pas aux pains
--   cadres (baguette 1,25 DH...) ; les pains speciaux restent coherents.
--
-- ─── HYPOTHESES A VALIDER PAR LE CHEF ───
--   1. « Flocons d'avoine / graines floconnees » etait a unit_cost = 0 : pose a
--      0,015 DH/g (15 DH/kg). -- PRIX A VALIDER
--   2. Pains sandwich a 1 DH : un paton de 550-600 g couterait ~1,8-2 DH de
--      matiere, invendable a 1 DH. Retenu : petit pain sandwich paton 141 g
--      (120 g cuit), l'usage marocain pour ce prix. Le filet (6) reste le
--      contenant de cuisson.
--   3. Referentiel : doublons a prix 0 (« Olives noires », « Son de ble ») —
--      la resolution ci-dessous prefere la ligne a prix non nul.
--
-- PORTEE
--   + 1 role de composant ('pate') au referentiel component_roles
--   + 1 UPDATE ingredients (prix des flocons d'avoine)
--   + 35 recettes creees a UUID fixes (11 bases + 24 produits finis)
--   + 3 liens recipe_sub_recipes (levain dans tradition/choufane/maison)
--   + 32 recipe_formats (bloc 02xx), 53 recipe_format_components,
--     miroir recipe_components des formats par defaut
--   + etapes + instructions sur 3 fiches phares (baguette a l'ancienne,
--     baguette normale, pain maison)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes, DELETE + INSERT
--   sur les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28100%';
--     -- cascade : recipe_ingredients, recipe_sub_recipes, recipe_formats,
--     --           recipe_format_components, recipe_components
--   UPDATE ingredients SET unit_cost = 0
--    WHERE name = 'Flocons d’avoine / graines floconnées' AND unit = 'g';
--   DELETE FROM ref_entries WHERE table_id = 'component_roles' AND code = 'pate';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Role de composant 'pate' : le paton de pain n'est ni un biscuit ni un
--    fond ; on l'ajoute au referentiel comme la mig 276 l'a fait pour
--    imbibage/chablonnage.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('component_roles', 'pate', 'Pâte', 'Pâton de pâte façonné, avant cuisson', 27, true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Prix des flocons d'avoine (unite = g, donc prix AU GRAMME). -- PRIX A VALIDER
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ingredients
   SET unit_cost = 0.015
 WHERE name = 'Flocons d’avoine / graines floconnées'
   AND unit = 'g'
   AND (unit_cost IS NULL OR unit_cost = 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Resolution des ingredients. Meme pattern que la mig 273, avec une
--    preference supplementaire : a usage egal, prendre la ligne dont le prix
--    est renseigne (le referentiel porte des doublons a unit_cost = 0 qui
--    couteraient silencieusement 0 : « Olives noires », « Son de blé »).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _b_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Farine boulangerie', 'Farine Complète', 'Farine d''orge', 'Farine de maïs',
  'Semoule fine', 'Semoule de mais', 'Son de blé', 'Eau', 'Levure fraîche',
  'Sel de table fin', 'Améliorant Pain Perfect', 'Sucre semoule',
  'Huile de table', 'Grains de sésame', 'Pavot bleu', 'Olives noires',
  'Mélange de graines', 'Flocons d’avoine / graines floconnées'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         (COALESCE(i.unit_cost, 0) > 0) DESC,
         i.created_at;

-- Garde-fou : echouer plutot qu'inserer des fiches amputees au cout faux.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _b_ing;
  IF n <> 18 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 18 attendus', n;
  END IF;
END $$;

-- Meme garde-fou sur les 4 contenants de cuisson utilises.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM production_contenants
   WHERE nom IN ('Filet de cuisson baguettes (5)', 'Filet de cuisson pains sandwich (6)',
                 'Plaque de cuisson plate 60x40', 'Plaque de cuisson plate 40x30')
     AND is_active;
  IF n <> 4 THEN
    RAISE EXCEPTION 'Contenants introuvables : % trouve(s) sur 4 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les 11 bases familiales. Chaque pate est petrie sur 1 kg de farine
--    (le total farines = 1000 g), yield = pesee crue au petrin, perte 0
--    (cf. convention paton en tete). Hydratations de metier :
--      courante 62 % (petrissage ameliore), tradition 68 % + 15 % de levain
--      (autolyse), complete 65 % sur farine complete + son, semoule 60 %,
--      orge 64 %, mais 62 %, sandwich 56 % (mie serree, sucre + huile),
--      choufane 62 % sur 15 % de flocons, maison 66 % + 20 % de levain.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct, category_id)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', 0,
       (SELECT id FROM recipe_categories WHERE code = 'base_production')
FROM (VALUES
  ('fab28100-0000-4000-8000-000000000101'::uuid, 'Levain liquide',            1000::numeric),
  ('fab28100-0000-4000-8000-000000000102', 'Pâte à baguette courante',        1668),
  ('fab28100-0000-4000-8000-000000000103', 'Pâte à baguette tradition',       1856),
  ('fab28100-0000-4000-8000-000000000104', 'Pâte complète',                   1748),
  ('fab28100-0000-4000-8000-000000000105', 'Pâte complète sans sel',          1730),
  ('fab28100-0000-4000-8000-000000000106', 'Pâte semoule',                    1648),
  ('fab28100-0000-4000-8000-000000000107', 'Pâte d''orge',                    1678),
  ('fab28100-0000-4000-8000-000000000108', 'Pâte maïs',                       1678),
  ('fab28100-0000-4000-8000-000000000109', 'Pâte à pain sandwich',            1683),
  ('fab28100-0000-4000-8000-000000000110', 'Pâte choufane (avoine)',          1753),
  ('fab28100-0000-4000-8000-000000000111', 'Pâte de pain maison',             1888)
) AS v (id, nom, yield)
ON CONFLICT (id) DO NOTHING;

DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28100-0000-4000-8000-0000000001%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette_id, ing.id, v.qte, 'g'
FROM (VALUES
  -- Levain liquide — 1000 g : chef entretenu, hydratation 100 %
  ('fab28100-0000-4000-8000-000000000101'::uuid, 'Farine boulangerie',        500::numeric),
  ('fab28100-0000-4000-8000-000000000101', 'Eau',                             500),
  -- Pate a baguette courante — 1668 g
  ('fab28100-0000-4000-8000-000000000102', 'Farine boulangerie',             1000),
  ('fab28100-0000-4000-8000-000000000102', 'Eau',                             620),
  ('fab28100-0000-4000-8000-000000000102', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000102', 'Sel de table fin',                 18),
  ('fab28100-0000-4000-8000-000000000102', 'Améliorant Pain Perfect',          10),
  -- Pate a baguette tradition — 1856 g (+ 150 g de levain en sous-recette)
  ('fab28100-0000-4000-8000-000000000103', 'Farine boulangerie',             1000),
  ('fab28100-0000-4000-8000-000000000103', 'Eau',                             680),
  ('fab28100-0000-4000-8000-000000000103', 'Levure fraîche',                    8),
  ('fab28100-0000-4000-8000-000000000103', 'Sel de table fin',                 18),
  -- Pate complete — 1748 g
  ('fab28100-0000-4000-8000-000000000104', 'Farine Complète',                 700),
  ('fab28100-0000-4000-8000-000000000104', 'Farine boulangerie',              300),
  ('fab28100-0000-4000-8000-000000000104', 'Son de blé',                       50),
  ('fab28100-0000-4000-8000-000000000104', 'Eau',                             650),
  ('fab28100-0000-4000-8000-000000000104', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000104', 'Sel de table fin',                 18),
  ('fab28100-0000-4000-8000-000000000104', 'Améliorant Pain Perfect',          10),
  -- Pate complete sans sel — 1730 g (regime sans sel, meme process)
  ('fab28100-0000-4000-8000-000000000105', 'Farine Complète',                 700),
  ('fab28100-0000-4000-8000-000000000105', 'Farine boulangerie',              300),
  ('fab28100-0000-4000-8000-000000000105', 'Son de blé',                       50),
  ('fab28100-0000-4000-8000-000000000105', 'Eau',                             650),
  ('fab28100-0000-4000-8000-000000000105', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000105', 'Améliorant Pain Perfect',          10),
  -- Pate semoule — 1648 g
  ('fab28100-0000-4000-8000-000000000106', 'Semoule fine',                    600),
  ('fab28100-0000-4000-8000-000000000106', 'Farine boulangerie',              400),
  ('fab28100-0000-4000-8000-000000000106', 'Eau',                             600),
  ('fab28100-0000-4000-8000-000000000106', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000106', 'Sel de table fin',                 18),
  ('fab28100-0000-4000-8000-000000000106', 'Améliorant Pain Perfect',          10),
  -- Pate d'orge — 1678 g (50 % orge : au-dela, la mie ne tient pas sans gluten)
  ('fab28100-0000-4000-8000-000000000107', 'Farine d''orge',                  500),
  ('fab28100-0000-4000-8000-000000000107', 'Farine boulangerie',              500),
  ('fab28100-0000-4000-8000-000000000107', 'Eau',                             640),
  ('fab28100-0000-4000-8000-000000000107', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000107', 'Sel de table fin',                 18),
  -- Pate mais — 1678 g (30 % mais, une pointe de sucre pour la couleur)
  ('fab28100-0000-4000-8000-000000000108', 'Farine de maïs',                  300),
  ('fab28100-0000-4000-8000-000000000108', 'Farine boulangerie',              700),
  ('fab28100-0000-4000-8000-000000000108', 'Eau',                             620),
  ('fab28100-0000-4000-8000-000000000108', 'Sucre semoule',                    20),
  ('fab28100-0000-4000-8000-000000000108', 'Levure fraîche',                   20),
  ('fab28100-0000-4000-8000-000000000108', 'Sel de table fin',                 18),
  -- Pate a pain sandwich — 1683 g (mie souple : sucre + huile)
  ('fab28100-0000-4000-8000-000000000109', 'Farine boulangerie',             1000),
  ('fab28100-0000-4000-8000-000000000109', 'Eau',                             560),
  ('fab28100-0000-4000-8000-000000000109', 'Sucre semoule',                    40),
  ('fab28100-0000-4000-8000-000000000109', 'Huile de table',                   30),
  ('fab28100-0000-4000-8000-000000000109', 'Levure fraîche',                   25),
  ('fab28100-0000-4000-8000-000000000109', 'Sel de table fin',                 18),
  ('fab28100-0000-4000-8000-000000000109', 'Améliorant Pain Perfect',          10),
  -- Pate choufane — 1753 g (15 % de flocons d'avoine + 100 g de levain)
  ('fab28100-0000-4000-8000-000000000110', 'Farine boulangerie',              850),
  ('fab28100-0000-4000-8000-000000000110', 'Flocons d’avoine / graines floconnées', 150),
  ('fab28100-0000-4000-8000-000000000110', 'Eau',                             620),
  ('fab28100-0000-4000-8000-000000000110', 'Levure fraîche',                   15),
  ('fab28100-0000-4000-8000-000000000110', 'Sel de table fin',                 18),
  -- Pate de pain maison — 1888 g (20 % complete + 200 g de levain)
  ('fab28100-0000-4000-8000-000000000111', 'Farine boulangerie',              800),
  ('fab28100-0000-4000-8000-000000000111', 'Farine Complète',                 200),
  ('fab28100-0000-4000-8000-000000000111', 'Eau',                             660),
  ('fab28100-0000-4000-8000-000000000111', 'Levure fraîche',                   10),
  ('fab28100-0000-4000-8000-000000000111', 'Sel de table fin',                 18)
) AS v (recette_id, ingredient, qte)
JOIN _b_ing ing ON ing.name = v.ingredient;

-- Le levain liquide dans les 3 pates au levain (quantity = g de pesee).
DELETE FROM recipe_sub_recipes
 WHERE recipe_id::text LIKE 'fab28100-0000-4000-8000-0000000001%';

INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES
  ('fab28100-0000-4000-8000-000000000103', 'fab28100-0000-4000-8000-000000000101', 150),
  ('fab28100-0000-4000-8000-000000000110', 'fab28100-0000-4000-8000-000000000101', 100),
  ('fab28100-0000-4000-8000-000000000111', 'fab28100-0000-4000-8000-000000000101', 200);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 24 produits finis (mode_cout = compose, categorie boulangerie).
--    yield_quantity = nb de pieces du format par defaut.
--    recipes.product_id pose seulement quand la recette n'a qu'UN produit ;
--    les recettes multi-formats passent par recipe_formats.product_id.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct, category_id, product_id)
SELECT v.id, v.nom, false, 'compose', v.pieces, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'boulangerie'),
       v.product_id
FROM (VALUES
  -- Baguettes courantes
  ('fab28100-0000-4000-8000-000000000121'::uuid, 'Baguette normale',            5::numeric, NULL::uuid),
  ('fab28100-0000-4000-8000-000000000122', 'Baguette farinée',                  5, NULL),
  ('fab28100-0000-4000-8000-000000000123', 'Baguette sésame',                   5, '89f05273-7085-41bc-9da0-83a8fd55cbe4'),
  ('fab28100-0000-4000-8000-000000000124', 'Baguette de graines',               5, NULL),
  ('fab28100-0000-4000-8000-000000000125', 'Baguette complète',                 5, 'd2563f09-3c24-41ca-ac59-b7f38a8e8105'),
  ('fab28100-0000-4000-8000-000000000126', 'Baguette semoule',                  5, '71492ff1-6207-4005-9ecd-960e6359f40d'),
  -- Traditions
  ('fab28100-0000-4000-8000-000000000127', 'Baguette tradition sésame',         5, 'ffb8bfc2-e76f-4b47-ae19-f239c854f41e'),
  ('fab28100-0000-4000-8000-000000000128', 'Baguette tradition pavot',          5, '9e04bbae-2be9-472f-b460-aeee1d984d26'),
  ('fab28100-0000-4000-8000-000000000129', 'Baguette tradition aux olives',     5, '349ef9be-c409-47ca-869c-143f2b847b8f'),
  ('fab28100-0000-4000-8000-000000000130', 'Baguette tradition céréales',       5, '855689df-4cbd-4a99-882e-8c6e4c590068'),
  ('fab28100-0000-4000-8000-000000000131', 'Baguette à l''ancienne',            5, NULL),
  ('fab28100-0000-4000-8000-000000000132', 'Pain choufane',                     5, NULL),
  ('fab28100-0000-4000-8000-000000000133', 'Pain copain',                       8, '104f60e5-7105-4993-8a7c-20de54f18a76'),
  -- Pains ronds
  ('fab28100-0000-4000-8000-000000000134', 'Pain maison',                       8, NULL),
  ('fab28100-0000-4000-8000-000000000135', 'Pain Ô fauria',                     8, NULL),
  ('fab28100-0000-4000-8000-000000000136', 'Pain complet',                     10, 'c0e7723b-440f-4959-8bd8-fd5734d56b1d'),
  ('fab28100-0000-4000-8000-000000000137', 'Pain complet sans sel',            10, '60a659dd-7169-4e8a-8567-372d4efda0f9'),
  ('fab28100-0000-4000-8000-000000000138', 'Pain d''orge mini',                12, '8ad29259-a7c8-42a4-b491-c4389335a9a8'),
  ('fab28100-0000-4000-8000-000000000139', 'Pain nature',                      10, '1030d600-3b1a-4dd6-94ba-f6d8bc72267d'),
  ('fab28100-0000-4000-8000-000000000140', 'Pain sandwich',                     6, NULL),
  ('fab28100-0000-4000-8000-000000000141', 'Pain sandwich complet',             6, '90fc1870-bc6b-4da0-9a80-ab7de086dd83'),
  ('fab28100-0000-4000-8000-000000000142', 'Sandwich tradition',                6, '7faf5128-1986-4652-894d-fc95113bd6fc'),
  ('fab28100-0000-4000-8000-000000000143', 'Pain semoule',                     10, 'b35df49b-7a69-4979-b524-f01634de02c1'),
  ('fab28100-0000-4000-8000-000000000144', 'Pain maïs',                        10, 'bcbb5e73-60ef-4b72-bc02-c4b2198ece03')
) AS v (id, nom, pieces, product_id)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 32 formats — un par produit vendu.
--    nb_par_defaut = pieces par fournee du contenant (filet baguettes = 5,
--    filet sandwich = 6, plaque 60x40 = 8 gros / 10 moyens, plaque 40x30 =
--    12 minis). contenant NULL = deuxieme reference de vente du meme pain,
--    cuite dans le meme contenant que le format par defaut : la contrainte
--    UNIQUE (recipe_id, contenant_id) interdit de le repeter.
--    quantite_par_format = poids net d'une piece (pate cuite + garnitures).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id, poids_cru_g, poids_cuit_g)
SELECT v.id, v.recette_id, c.id, v.qpf, 'g', v.nb, v.is_default, v.ordre,
       v.product_id, v.cru, v.qpf
FROM (VALUES
  -- ── Baguette normale : BAG NORMAL (1,50 DH) + Baguette normale 1,25
  ('fab28100-0000-4000-8000-000000000201'::uuid, 'fab28100-0000-4000-8000-000000000121'::uuid,
   'Filet de cuisson baguettes (5)', 280::numeric,  5, true,  1, '0b78ea7a-d9e7-45b1-a8c1-9753051fa842'::uuid, 350::numeric),
  ('fab28100-0000-4000-8000-000000000202', 'fab28100-0000-4000-8000-000000000121',
   NULL,                             240,  5, false, 2, '9293ebba-3f15-48c4-82f4-15719e15a4ab', 300),
  -- ── Baguette farinee : BAG NORM FARINE (1,50) + Baguette farine (3,00, grosse piece)
  ('fab28100-0000-4000-8000-000000000203', 'fab28100-0000-4000-8000-000000000122',
   'Filet de cuisson baguettes (5)', 283,  5, true,  1, '296eb59a-91c1-4698-bfb3-830a6bd6bb7e', 353),
  ('fab28100-0000-4000-8000-000000000204', 'fab28100-0000-4000-8000-000000000122',
   NULL,                             404,  5, false, 2, '2615b137-d9c8-4eee-aa3a-53b5b016f98d', 504),
  -- ── Baguette sesame : BAG NORM SESAME (2,00)
  ('fab28100-0000-4000-8000-000000000205', 'fab28100-0000-4000-8000-000000000123',
   'Filet de cuisson baguettes (5)', 286,  5, true,  1, '89f05273-7085-41bc-9da0-83a8fd55cbe4', 356),
  -- ── Baguette de graines (4,00) + Sandwich de graines (2,00)
  ('fab28100-0000-4000-8000-000000000206', 'fab28100-0000-4000-8000-000000000124',
   'Filet de cuisson baguettes (5)', 310,  5, true,  1, '93601f04-025b-478b-bd53-9a2a4d827636', 380),
  ('fab28100-0000-4000-8000-000000000207', 'fab28100-0000-4000-8000-000000000124',
   'Filet de cuisson pains sandwich (6)', 140, 6, false, 2, '28960418-9554-42d5-b4ab-24487b36d2f3', 163),
  -- ── BAG COMPLET (3,00)
  ('fab28100-0000-4000-8000-000000000208', 'fab28100-0000-4000-8000-000000000125',
   'Filet de cuisson baguettes (5)', 280,  5, true,  1, 'd2563f09-3c24-41ca-ac59-b7f38a8e8105', 350),
  -- ── BAG SEMOULE (3,00)
  ('fab28100-0000-4000-8000-000000000209', 'fab28100-0000-4000-8000-000000000126',
   'Filet de cuisson baguettes (5)', 283,  5, true,  1, '71492ff1-6207-4005-9ecd-960e6359f40d', 353),
  -- ── BAG TRADITION SESAME (6,00)
  ('fab28100-0000-4000-8000-000000000210', 'fab28100-0000-4000-8000-000000000127',
   'Filet de cuisson baguettes (5)', 288,  5, true,  1, 'ffb8bfc2-e76f-4b47-ae19-f239c854f41e', 358),
  -- ── BAG TRADITION PAVOT (6,00)
  ('fab28100-0000-4000-8000-000000000211', 'fab28100-0000-4000-8000-000000000128',
   'Filet de cuisson baguettes (5)', 286,  5, true,  1, '9e04bbae-2be9-472f-b460-aeee1d984d26', 356),
  -- ── BAG TRADITION OLIVE (6,00)
  ('fab28100-0000-4000-8000-000000000212', 'fab28100-0000-4000-8000-000000000129',
   'Filet de cuisson baguettes (5)', 320,  5, true,  1, '349ef9be-c409-47ca-869c-143f2b847b8f', 390),
  -- ── BAG TRADITION CEREALE (6,00)
  ('fab28100-0000-4000-8000-000000000213', 'fab28100-0000-4000-8000-000000000130',
   'Filet de cuisson baguettes (5)', 313,  5, true,  1, '855689df-4cbd-4a99-882e-8c6e4c590068', 383),
  -- ── BAG A L'ANCIENNE (5,00) + Pain long (6,00)
  ('fab28100-0000-4000-8000-000000000214', 'fab28100-0000-4000-8000-000000000131',
   'Filet de cuisson baguettes (5)', 280,  5, true,  1, '8916fa64-5f59-41e8-b6ee-3dcf601eb9ab', 350),
  ('fab28100-0000-4000-8000-000000000215', 'fab28100-0000-4000-8000-000000000131',
   'Plaque de cuisson plate 60x40',  400,  8, false, 2, '5284bf21-f1f8-4605-82e7-ff15c2135719', 500),
  -- ── BAGUETTE CHOFANE (6,00) + PAIN CHOUFANE (6,00)
  ('fab28100-0000-4000-8000-000000000216', 'fab28100-0000-4000-8000-000000000132',
   'Filet de cuisson baguettes (5)', 288,  5, true,  1, '50323c09-4fa0-4c32-b33e-6f1cd8f94004', 358),
  ('fab28100-0000-4000-8000-000000000217', 'fab28100-0000-4000-8000-000000000132',
   'Plaque de cuisson plate 60x40',  370, 10, false, 2, '9aceb1d9-3678-48c1-b554-bd95679b26a9', 449),
  -- ── Pain copain (6,00) — pain de campagne sur pate tradition
  ('fab28100-0000-4000-8000-000000000218', 'fab28100-0000-4000-8000-000000000133',
   'Plaque de cuisson plate 60x40',  453,  8, true,  1, '104f60e5-7105-4993-8a7c-20de54f18a76', 552),
  -- ── PAIN MAISON (3,00) + MINI PAIN MAISON (2,00)
  ('fab28100-0000-4000-8000-000000000219', 'fab28100-0000-4000-8000-000000000134',
   'Plaque de cuisson plate 60x40',  363,  8, true,  1, 'dce3bf1f-ac14-472c-9cc8-fefff672f46d', 442),
  ('fab28100-0000-4000-8000-000000000220', 'fab28100-0000-4000-8000-000000000134',
   'Plaque de cuisson plate 40x30',  127, 12, false, 2, '12e3bdbe-dece-459c-8c91-7a4ab039fb46', 154),
  -- ── Pain o fauria (3,00) + mini (2,00) — signature graines
  ('fab28100-0000-4000-8000-000000000221', 'fab28100-0000-4000-8000-000000000135',
   'Plaque de cuisson plate 60x40',  368,  8, true,  1, '0ad5dec7-af30-4e4f-9436-71843ccd5a4f', 447),
  ('fab28100-0000-4000-8000-000000000222', 'fab28100-0000-4000-8000-000000000135',
   'Plaque de cuisson plate 40x30',  129, 12, false, 2, '33ab9019-8888-48be-846c-5d67e7c76752', 156),
  -- ── PAIN COMPLET (2,00)
  ('fab28100-0000-4000-8000-000000000223', 'fab28100-0000-4000-8000-000000000136',
   'Plaque de cuisson plate 60x40',  300, 10, true,  1, 'c0e7723b-440f-4959-8bd8-fd5734d56b1d', 366),
  -- ── PAIN COMPLET SANS SEL (2,00)
  ('fab28100-0000-4000-8000-000000000224', 'fab28100-0000-4000-8000-000000000137',
   'Plaque de cuisson plate 60x40',  300, 10, true,  1, '60a659dd-7169-4e8a-8567-372d4efda0f9', 366),
  -- ── PAIN D'ORGE MINI (2,00)
  ('fab28100-0000-4000-8000-000000000225', 'fab28100-0000-4000-8000-000000000138',
   'Plaque de cuisson plate 40x30',  127, 12, true,  1, '8ad29259-a7c8-42a4-b491-c4389335a9a8', 154),
  -- ── PAIN NATURE (1,50)
  ('fab28100-0000-4000-8000-000000000226', 'fab28100-0000-4000-8000-000000000139',
   'Plaque de cuisson plate 60x40',  260, 10, true,  1, '1030d600-3b1a-4dd6-94ba-f6d8bc72267d', 317),
  -- ── PAIN SANDWICH NORMALE (1,00) + SANDWICH NATURE (1,00)
  ('fab28100-0000-4000-8000-000000000227', 'fab28100-0000-4000-8000-000000000140',
   'Filet de cuisson pains sandwich (6)', 120, 6, true, 1, '0bf49706-c1d2-4ba2-a6b7-2f68ea606c53', 141),
  ('fab28100-0000-4000-8000-000000000228', 'fab28100-0000-4000-8000-000000000140',
   NULL,                             120,  6, false, 2, '22dfea5f-4719-4510-85c9-cd82fe7a4fb5', 141),
  -- ── PAIN SANDWICH COMPLET (1,50)
  ('fab28100-0000-4000-8000-000000000229', 'fab28100-0000-4000-8000-000000000141',
   'Filet de cuisson pains sandwich (6)', 120, 6, true, 1, '90fc1870-bc6b-4da0-9a80-ab7de086dd83', 141),
  -- ── Sandwich tradition (2,00)
  ('fab28100-0000-4000-8000-000000000230', 'fab28100-0000-4000-8000-000000000142',
   'Filet de cuisson pains sandwich (6)', 130, 6, true, 1, '7faf5128-1986-4652-894d-fc95113bd6fc', 153),
  -- ── PAIN SEMOULE (2,00)
  ('fab28100-0000-4000-8000-000000000231', 'fab28100-0000-4000-8000-000000000143',
   'Plaque de cuisson plate 60x40',  263, 10, true,  1, 'b35df49b-7a69-4979-b524-f01634de02c1', 320),
  -- ── Pain Mais (2,00)
  ('fab28100-0000-4000-8000-000000000232', 'fab28100-0000-4000-8000-000000000144',
   'Plaque de cuisson plate 60x40',  265, 10, true,  1, 'bcbb5e73-60ef-4b72-bc02-c4b2198ece03', 322)
) AS v (id, recette_id, contenant, qpf, nb, is_default, ordre, product_id, cru)
LEFT JOIN production_contenants c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomenclature par format. Ligne 'pate' = poids NET CUIT pour tout le
--    contenant, perte_pct = perte cuisson + ressuage (cf. convention en tete) ;
--    garnitures incorporees en 'garniture', toppings de croute en 'decor'
--    (les graines ne perdent rien : perte 0).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id::text LIKE 'fab28100-0000-4000-8000-0000000002%';

-- 6a. Les patons (source = base pate).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, 'pate', v.pate_id, v.qte, 'g', v.perte, 1
FROM (VALUES
  -- Baguettes courantes (perte 20 %)
  ('fab28100-0000-4000-8000-000000000201'::uuid, 'fab28100-0000-4000-8000-000000000102'::uuid, 1400::numeric, 20::numeric),
  ('fab28100-0000-4000-8000-000000000202', 'fab28100-0000-4000-8000-000000000102', 1200, 20),
  ('fab28100-0000-4000-8000-000000000203', 'fab28100-0000-4000-8000-000000000102', 1400, 20),
  ('fab28100-0000-4000-8000-000000000204', 'fab28100-0000-4000-8000-000000000102', 2000, 20),
  ('fab28100-0000-4000-8000-000000000205', 'fab28100-0000-4000-8000-000000000102', 1400, 20),
  ('fab28100-0000-4000-8000-000000000206', 'fab28100-0000-4000-8000-000000000102', 1400, 20),
  ('fab28100-0000-4000-8000-000000000207', 'fab28100-0000-4000-8000-000000000102',  780, 15),
  ('fab28100-0000-4000-8000-000000000208', 'fab28100-0000-4000-8000-000000000104', 1400, 20),
  ('fab28100-0000-4000-8000-000000000209', 'fab28100-0000-4000-8000-000000000106', 1400, 20),
  -- Traditions (perte 20 % en baguette, 18 % en gros pain)
  ('fab28100-0000-4000-8000-000000000210', 'fab28100-0000-4000-8000-000000000103', 1400, 20),
  ('fab28100-0000-4000-8000-000000000211', 'fab28100-0000-4000-8000-000000000103', 1400, 20),
  ('fab28100-0000-4000-8000-000000000212', 'fab28100-0000-4000-8000-000000000103', 1400, 20),
  ('fab28100-0000-4000-8000-000000000213', 'fab28100-0000-4000-8000-000000000103', 1400, 20),
  ('fab28100-0000-4000-8000-000000000214', 'fab28100-0000-4000-8000-000000000103', 1400, 20),
  ('fab28100-0000-4000-8000-000000000215', 'fab28100-0000-4000-8000-000000000103', 3200, 20),
  ('fab28100-0000-4000-8000-000000000216', 'fab28100-0000-4000-8000-000000000110', 1400, 20),
  ('fab28100-0000-4000-8000-000000000217', 'fab28100-0000-4000-8000-000000000110', 3600, 18),
  ('fab28100-0000-4000-8000-000000000218', 'fab28100-0000-4000-8000-000000000103', 3600, 18),
  -- Pains ronds (perte 18 %, sandwich 15 %)
  ('fab28100-0000-4000-8000-000000000219', 'fab28100-0000-4000-8000-000000000111', 2880, 18),
  ('fab28100-0000-4000-8000-000000000220', 'fab28100-0000-4000-8000-000000000111', 1500, 18),
  ('fab28100-0000-4000-8000-000000000221', 'fab28100-0000-4000-8000-000000000111', 2880, 18),
  ('fab28100-0000-4000-8000-000000000222', 'fab28100-0000-4000-8000-000000000111', 1500, 18),
  ('fab28100-0000-4000-8000-000000000223', 'fab28100-0000-4000-8000-000000000104', 3000, 18),
  ('fab28100-0000-4000-8000-000000000224', 'fab28100-0000-4000-8000-000000000105', 3000, 18),
  ('fab28100-0000-4000-8000-000000000225', 'fab28100-0000-4000-8000-000000000107', 1500, 18),
  ('fab28100-0000-4000-8000-000000000226', 'fab28100-0000-4000-8000-000000000102', 2600, 18),
  ('fab28100-0000-4000-8000-000000000227', 'fab28100-0000-4000-8000-000000000109',  720, 15),
  ('fab28100-0000-4000-8000-000000000228', 'fab28100-0000-4000-8000-000000000109',  720, 15),
  ('fab28100-0000-4000-8000-000000000229', 'fab28100-0000-4000-8000-000000000104',  720, 15),
  ('fab28100-0000-4000-8000-000000000230', 'fab28100-0000-4000-8000-000000000103',  780, 15),
  ('fab28100-0000-4000-8000-000000000231', 'fab28100-0000-4000-8000-000000000106', 2600, 18),
  ('fab28100-0000-4000-8000-000000000232', 'fab28100-0000-4000-8000-000000000108', 2600, 18)
) AS v (format_id, pate_id, qte, perte);

-- 6b. Garnitures et decors (source = ingredient).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, v.role, ing.id, v.qte, 'g', 0, v.ordre
FROM (VALUES
  ('fab28100-0000-4000-8000-000000000203'::uuid, 'decor',     'Farine boulangerie',   15::numeric, 3::smallint),
  ('fab28100-0000-4000-8000-000000000204', 'decor',     'Farine boulangerie',    20, 3),
  ('fab28100-0000-4000-8000-000000000205', 'decor',     'Grains de sésame',      30, 3),
  ('fab28100-0000-4000-8000-000000000206', 'garniture', 'Mélange de graines',   100, 2),
  ('fab28100-0000-4000-8000-000000000206', 'decor',     'Mélange de graines',    50, 3),
  ('fab28100-0000-4000-8000-000000000207', 'decor',     'Mélange de graines',    60, 3),
  ('fab28100-0000-4000-8000-000000000209', 'decor',     'Semoule fine',          15, 3),
  ('fab28100-0000-4000-8000-000000000210', 'decor',     'Grains de sésame',      40, 3),
  ('fab28100-0000-4000-8000-000000000211', 'decor',     'Pavot bleu',            30, 3),
  ('fab28100-0000-4000-8000-000000000212', 'garniture', 'Olives noires',        200, 2),
  ('fab28100-0000-4000-8000-000000000213', 'garniture', 'Mélange de graines',   125, 2),
  ('fab28100-0000-4000-8000-000000000213', 'decor',     'Mélange de graines',    40, 3),
  ('fab28100-0000-4000-8000-000000000216', 'decor',     'Flocons d’avoine / graines floconnées',  40, 3),
  ('fab28100-0000-4000-8000-000000000217', 'decor',     'Flocons d’avoine / graines floconnées', 100, 3),
  ('fab28100-0000-4000-8000-000000000218', 'decor',     'Farine boulangerie',    24, 3),
  ('fab28100-0000-4000-8000-000000000219', 'decor',     'Farine boulangerie',    24, 3),
  ('fab28100-0000-4000-8000-000000000220', 'decor',     'Farine boulangerie',    24, 3),
  ('fab28100-0000-4000-8000-000000000221', 'decor',     'Mélange de graines',    64, 3),
  ('fab28100-0000-4000-8000-000000000222', 'decor',     'Mélange de graines',    48, 3),
  ('fab28100-0000-4000-8000-000000000225', 'decor',     'Farine boulangerie',    24, 3),
  ('fab28100-0000-4000-8000-000000000231', 'decor',     'Semoule fine',          30, 3),
  ('fab28100-0000-4000-8000-000000000232', 'decor',     'Semoule de mais',       50, 3)
) AS v (format_id, role, ingredient, qte, ordre)
JOIN _b_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    Sans lui, v_recipe_total_cost rendrait 0 pour toutes ces recettes.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id::text LIKE 'fab28100-0000-4000-8000-0000000001%';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
WHERE f.is_default
  AND f.recipe_id::text LIKE 'fab28100-0000-4000-8000-0000000001%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Etapes + instructions sur les 3 fiches phares.
-- ─────────────────────────────────────────────────────────────────────────────

-- Baguette a l'ancienne — le process tradition complet (autolyse + levain).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Autolyse et pétrissage","duree_estimee_min":75,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Frasage farine + eau seules, 4 min en 1ère vitesse, puis AUTOLYSE 45-60 min à couvert",
     "Ajouter levain liquide, levure émiettée puis sel ; 5 min 1ère vitesse + 2 min 2ème",
     "Température de pâte finale 24-25 °C (base de calcul 68 : adapter l''eau)",
     "Pâte lisse qui se décolle de la cuve, réseau extensible sans se déchirer"]},
  {"ordre":2,"nom":"Pointage","duree_estimee_min":90,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "1 h 30 en bac huilé couvert, à 22-24 °C",
     "Un rabat à 45 min : soulever, étirer, replier — jamais dégazer à plat",
     "Fin de pointage : pâte aérée, bulles visibles en surface"]},
  {"ordre":3,"nom":"Division et façonnage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâtons de 350 g, préformés en boudins SANS serrer",
     "Détente 20-25 min sous toile",
     "Allonger en 55-60 cm, soudure bien fermée DESSOUS, pointes fines",
     "Sur couche farinée, plis serrés entre les pâtons"]},
  {"ordre":4,"nom":"Apprêt","duree_estimee_min":60,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "45-60 min à 25 °C, ou pousse contrôlée 12 h à 4 °C pour le fournil du matin",
     "Test du doigt : l''empreinte remonte lentement, sans s''effacer tout à fait"]},
  {"ordre":5,"nom":"Cuisson avec buée","duree_estimee_min":25,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four à sole 250 °C, buée franche AVANT et APRÈS l''enfournement",
     "3 coups de lame inclinés à 45°, chevauchés d''un tiers, d''un geste net",
     "20-22 min : croûte ambrée, le pain sonne creux dessous",
     "Ressuage 30 min sur grille — un pain vendu chaud n''a pas fini de cuire",
     "Perte cuisson + ressuage attendue : 20 % du poids du pâton"]}
]'::jsonb,
instructions = 'Rendement : 5 baguettes de 280 g (pâtons de 350 g) par filet de cuisson.

Pâte tradition sans améliorant : farine, eau, levain liquide (150 g/kg de farine), levure 8 g/kg, sel 18 g/kg. Autolyse obligatoire.

Conservation : à consommer le jour même ; croûte croustillante 6-8 h. Pas de congélation en cuit.

Allergènes : gluten (blé). Le levain contient de la farine de blé.',
updated_at = NOW()
WHERE id = 'fab28100-0000-4000-8000-000000000131';

-- Baguette normale — le process courant du fournil (ameliorant, pousse directe).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pétrissage amélioré","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Frasage 4 min 1ère vitesse, tous ingrédients (sel et levure aux deux bords opposés de la cuve)",
     "8 min en 2ème vitesse : réseau lisse, voile fin au test de la membrane",
     "Température de pâte finale 25 °C"]},
  {"ordre":2,"nom":"Pointage court et division","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "20 min de pointage en masse, à couvert",
     "Division en pâtons de 350 g, boulage léger, détente 15 min"]},
  {"ordre":3,"nom":"Façonnage et apprêt","duree_estimee_min":90,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Façonnage en 55 cm, soudure dessous, directement sur filet de cuisson",
     "Apprêt 75-90 min à 26-27 °C en chambre de pousse",
     "Volume presque doublé, pâte souple au toucher"]},
  {"ordre":4,"nom":"Cuisson avec buée","duree_estimee_min":22,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four 240 °C, buée à l''enfournement, 3 coups de lame",
     "18-20 min, croûte dorée uniforme",
     "Ressuage sur grille avant mise en rayon"]}
]'::jsonb,
instructions = 'Rendement : 5 baguettes de 280 g (pâtons de 350 g) par filet de cuisson.

Prix cadré : coût matière visé sous 1,00 DH la pièce — ne pas augmenter les pesées sans revoir le prix.

Conservation : jour même. Allergènes : gluten (blé).',
updated_at = NOW()
WHERE id = 'fab28100-0000-4000-8000-000000000121';

-- Pain maison — le pain rond signature au levain.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pétrissage au levain","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Farine blanche + complète, eau, levain liquide (200 g/kg de farine), levure, sel",
     "6 min 1ère vitesse + 4 min 2ème, pâte finale 24 °C",
     "Pâte souple, légèrement collante : ne pas refariner la cuve"]},
  {"ordre":2,"nom":"Pointage avec rabat","duree_estimee_min":75,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "1 h 15 à 23 °C, un rabat à mi-parcours"]},
  {"ordre":3,"nom":"Division et boulage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâtons de 440 g (mini : 150 g), boulage serré en deux passes",
     "Clé dessous, sur plaque farinée — 8 gros ou 12 minis par plaque",
     "Fleurer le dessus à la farine (c''est la signature du pain maison)"]},
  {"ordre":4,"nom":"Apprêt et cuisson","duree_estimee_min":90,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Apprêt 60 min à 25 °C",
     "Grigne en croix au centre, d''un geste franc",
     "Four 240 °C avec buée, 25-28 min (minis : 15-17 min)",
     "Semelle qui sonne creux, ressuage 30 min : perte attendue 18 %"]}
]'::jsonb,
instructions = 'Rendement : 8 pains de 360 g (pâtons 440 g) par plaque 60x40, ou 12 minis de 125 g (pâtons 150 g) par plaque 40x30.

Pâte au levain (20 % farine complète) : mie crème, croûte rustique fleurée à la farine.

Conservation : 24 h en sachet papier. Allergènes : gluten (blé).',
updated_at = NOW()
WHERE id = 'fab28100-0000-4000-8000-000000000134';
