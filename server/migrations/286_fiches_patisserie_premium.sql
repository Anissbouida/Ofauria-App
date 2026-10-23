-- Migration 286 : Fiches techniques PATISSERIE PREMIUM — 41 produits
--
-- POURQUOI
--   Injection des fiches techniques de la famille PATISSERIE PREMIUM (pieces
--   individuelles 80-120 g, entremets entiers, tartelettes, trompe-l'oeil,
--   cheesecakes) sur le modele de l'Opera classique (mig 273/276) et le socle
--   de bases transversales de la mig 280.
--
--   Structure produite :
--     14 bases familiales (is_base, ratio_poids)  : appareil cheesecake cuit,
--       fond speculoos, mousse pralinee, mousse caramel, bavaroise coco,
--       cremeux citron/passion/mangue, mousse framboise, biscuit red velvet,
--       creme cheese frosting, biscuit brownie, appareil cake chocolat,
--       appareil velours ivoire (pistolet).
--     39 fiches produits (mode_cout = compose), 41 formats :
--       chaque produit vendu est couvert par UN format lie a son product_id.
--       NOISETTE porte 2 formats (plaque cylindres 12 pcs + cercle O20 8 parts
--       pour « Noisette 8personnes ») ; le produit OPERA recoit un 4e format
--       sur la recette EXISTANTE « Opera classique » (cadre bande 60x10x4,5),
--       sans toucher a ses 3 formats ni a son miroir.
--
-- ─── CONVENTIONS APPLIQUEES (contrat mig 273/276) ───
--   yield_quantity = pesee CRUE, perte_standard_pct = perte de transformation.
--   Quantites des composants de format = poids NET mis en oeuvre au contenant.
--   Somme des composants d'un format = nb_par_defaut x quantite_par_format ±3 %.
--   Miroir recipe_components = nomenclature du format PAR DEFAUT (sans lui,
--   cout = 0 pour v_recipe_total_cost). Le format Opera ajoute ici n'est PAS
--   par defaut : aucun miroir touche sur l'Opera classique.
--
-- ─── HYPOTHESES / DECISIONS ───
--   1. Cheesecakes : 4 parfums = 4 fiches (citron, framboise, Lotus, Oreo)
--      partageant 2 bases (fond speculoos + appareil cuit) ; seuls les toppings
--      changent. recipe_formats impose UNIQUE(recipe_id, contenant_id) : des
--      formats-parfums sur une meme recette auraient viole cette contrainte.
--   2. Format OPERA (bande 60x10x4,5 cm) : quantites = fiche masterclass x0,25
--      (rapport de surface 600/2400 cm2, meme regle que la mig 276). La bande
--      est decoupee en 18 pieces de ~99 g (10 x 3,3 cm), calibre du format
--      par defaut (102 g) — 12 pieces de 149 g auraient coute 65 % du prix de
--      vente de 10,10 DH. A ~99 g la matiere ressort a ~43 %, coherent avec le
--      format cadre existant (~44 %) : c'est le prix de l'Opera qui est tendu,
--      pas ce format.
--   3. Trompe-l'oeil : 24 demi-spheres O7 = 12 fruits assembles (montage a
--      l'envers, coque ganache montee ivoire, insert fruit surgele, velours).
--      nb_par_defaut = 12, pas 24.
--   4. « Purée de passion » est stockee en LITRES sans densite : les lignes
--      etant en grammes, fn_unit_conv retomberait sur son facteur neutre et
--      300 g seraient coutes comme 300 L. On pose densite_kg_l = 1.000
--      (approximation standard du module, cf. mig 273) — une puree titre
--      plutot 1,05-1,10 : ecart < 3 DH par fournee de cremeux.
--   5. 6 ingredients introuvables au referentiel sont crees en tete, prix
--      marche marocain 2026 (marques -- PRIX A VALIDER).
--
-- PORTEE
--   + 6 ingredients crees, 1 densite posee
--   + 14 recettes de base + 39 recettes produits (UUID fixes fab28600-…)
--   + 41 recipe_formats, ~190 recipe_format_components, miroirs recipe_components
--   + etapes + instructions sur 6 fiches phares
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes, DELETE+INSERT sur
--   les compositions. Aucune recette existante modifiee (l'Opera ne recoit
--   qu'un format supplementaire).
--
-- INVERSION
--   DELETE FROM recipe_formats WHERE id = 'fab28600-0000-4000-8000-000000000201';
--   DELETE FROM recipes WHERE id::text LIKE 'fab28600%';  -- cascade formats+composants
--   DELETE FROM ingredients WHERE name IN ('Biscuit spéculoos','Pâte de spéculoos',
--     'Biscuit Oreo','Purée de coco','Noix de coco râpée','Pêche au sirop')
--     AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id);
--   UPDATE ingredients SET densite_kg_l = NULL WHERE name = 'Purée de passion';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingredients manquants (prix marche marocain 2026, a valider).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Biscuit spéculoos', 'kg', 65.00, 'autre'          -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Biscuit spéculoos'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Pâte de spéculoos', 'kg', 85.00, 'autre'          -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Pâte de spéculoos'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Biscuit Oreo', 'kg', 90.00, 'autre'               -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Biscuit Oreo'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Purée de coco', 'kg', 85.00, 'fruits'             -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Purée de coco'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Noix de coco râpée', 'kg', 55.00, 'fruits_secs'   -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Noix de coco râpée'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Pêche au sirop', 'kg', 35.00, 'conserves'         -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name)=lower('Pêche au sirop'));

-- Densite de la puree de passion (hypothese 4 en tete).
UPDATE ingredients SET densite_kg_l = 1.000
 WHERE name = 'Purée de passion' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Resolution des ingredients (pattern mig 273). Doublons arbitres par usage
--    reel, puis par unite ponderale/volumique (evite « Beurre » a l'unite,
--    « Mangue » a la piece), puis par anciennete.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _prem_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande effilée', 'Amarena au sirop lourd', 'Banane', 'Beurre',
  'Beurre de cacao', 'Biscuit Oreo', 'Biscuit spéculoos', 'Cacao en poudre 10/12',
  'Chocolat couverture blanc 26.4%', 'Chocolat de couverture Lait 33%',
  'Chocolat de couverture Noir 55%', 'Citron', 'Colorant hydrosoluble Rouge Fraise',
  'Crème cheese', 'Crème fraîche', 'Farine Fleur', 'Fraise', 'Framboises',
  'GLAÇAGE CARAMÈL', 'GLAÇAGE FRAMBOISE', 'Gouttes drops 50% DGF',
  'Gélatine en feuille', 'Huile de table', 'Kiwi', 'Lait', 'Levure chimique',
  'Maizina', 'Mangue', 'NOISETTE EN GRAINS', 'Nappage neutre',
  'Noix de coco râpée', 'Noix décortiquées', 'Oeufs Jaune', 'Oeufs entiers liquides',
  'Pomme', 'Praliné noisette 50%', 'Purée de coco', 'Purée de mangue',
  'Purée de passion', 'Purée framboises', 'Pâte d''amande 50%', 'Pâte de spéculoos',
  'Pêche au sirop', 'Sel de table fin', 'Sucre glace', 'Sucre semoule', 'Vanille poudre'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         CASE WHEN i.unit IN ('kg','g','l','ml') THEN 0 ELSE 1 END,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _prem_ing;
  IF n <> 47 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 47 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Resolution des bases transversales (mig 280 + famille Opera). On les
--    REFERENCE, on ne les recree jamais.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _prem_base ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.is_base = true AND r.archived_at IS NULL
  AND r.name IN (
    'Dacquoise noisette', 'Croustillant praliné feuilletine', 'Mousse au chocolat noir',
    'Ganache montée ivoire', 'Ganache chocolat au lait', 'Ganache chocolat noir',
    'Caramel tendre', 'Glaçage miroir cacao', 'Génoise nature', 'Génoise cacao',
    'Biscuit cuillère', 'Crème bavaroise vanille', 'Crème chantilly', 'Pâte sucrée',
    'Streusel amande', 'Meringue française', 'Crème d''amande', 'Crème pâtissière',
    'Crème diplomate', 'Pâte à choux', 'Sirop à 30°B'
  )
ORDER BY r.name, r.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _prem_base;
  IF n <> 21 THEN
    RAISE EXCEPTION 'Bases transversales introuvables : % trouvee(s) sur 21 attendues', n;
  END IF;
  -- Famille Opera (mig 273/276) : les 5 preparations + la recette mere.
  SELECT count(*) INTO n FROM recipes WHERE id IN (
    '0be7a000-0000-4000-8000-000000000001', '0be7a000-0000-4000-8000-000000000002',
    '0be7a000-0000-4000-8000-000000000003', '0be7a000-0000-4000-8000-000000000004',
    '0be7a000-0000-4000-8000-000000000005', '0be7a000-0000-4000-8000-000000000006');
  IF n <> 6 THEN
    RAISE EXCEPTION 'Famille Opera incomplete : % recette(s) sur 6 attendues', n;
  END IF;
END $$;

-- Contenants utilises par les formats.
CREATE TEMP TABLE _prem_cont ON COMMIT DROP AS
SELECT c.nom, c.id
FROM production_contenants c
WHERE c.nom IN (
  'Cadre bande 60x10x4,5 cm', 'Cercle à entremets haut Ø20 x 6 cm',
  'Cercle à entremets Ø20 x 4,5 cm', 'Cercle à tarte Ø28 cm',
  'Cercle à tartelette Ø10 cm', 'Moule à cake 25 cm',
  'Plaque de cuisson plate 60x40', 'Plaque demi-sphères Ø7 cm (24)',
  'Plaque à cubes (15)', 'Plaque à cylindres individuels (12)',
  'Plaque à cœurs individuels (8)', 'Plaque à dômes spirale (6)'
);

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _prem_cont;
  IF n <> 12 THEN
    RAISE EXCEPTION 'Contenants introuvables : % trouve(s) sur 12 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les 14 bases familiales (pesee CRUE + perte de transformation).
--      Appareil cheesecake cuit   1985 g -  8 % (cuisson vapeur) = 1826 g
--      Fond spéculoos             1000 g -  2 % (fonçage)        =  980 g
--      Mousse pralinée            1500 g -  3 % (foisonnement)   = 1455 g
--      Mousse caramel             1500 g -  3 %                  = 1455 g
--      Bavaroise coco             1400 g -  3 %                  = 1358 g
--      Crémeux citron              900 g -  5 % (cuisson)        =  855 g
--      Crémeux passion             900 g -  5 %                  =  855 g
--      Crémeux mangue              900 g -  5 %                  =  855 g
--      Mousse framboise           1450 g -  3 %                  = 1406 g
--      Biscuit red velvet         1600 g - 12 % (cuisson)        = 1408 g
--      Crème cheese frosting      1200 g -  2 %                  = 1176 g
--      Biscuit brownie            1800 g - 10 % (cuisson)        = 1620 g
--      Appareil cake chocolat     1600 g - 10 % (cuisson)        = 1440 g
--      Appareil velours ivoire     500 g -  0 % (fonte)          =  500 g
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production')
FROM (VALUES
  ('fab28600-0000-4000-8000-000000000101'::uuid, 'Appareil cheesecake cuit', 1985::numeric,  8::numeric),
  ('fab28600-0000-4000-8000-000000000102', 'Fond spéculoos',           1000,  2),
  ('fab28600-0000-4000-8000-000000000103', 'Mousse pralinée',          1500,  3),
  ('fab28600-0000-4000-8000-000000000104', 'Mousse caramel',           1500,  3),
  ('fab28600-0000-4000-8000-000000000105', 'Bavaroise coco',           1400,  3),
  ('fab28600-0000-4000-8000-000000000106', 'Crémeux citron',            900,  5),
  ('fab28600-0000-4000-8000-000000000107', 'Crémeux passion',           900,  5),
  ('fab28600-0000-4000-8000-000000000108', 'Crémeux mangue',            900,  5),
  ('fab28600-0000-4000-8000-000000000109', 'Mousse framboise',         1450,  3),
  ('fab28600-0000-4000-8000-000000000110', 'Biscuit red velvet',       1600, 12),
  ('fab28600-0000-4000-8000-000000000111', 'Crème cheese frosting',    1200,  2),
  ('fab28600-0000-4000-8000-000000000112', 'Biscuit brownie',          1800, 10),
  ('fab28600-0000-4000-8000-000000000113', 'Appareil cake chocolat',   1600, 10),
  ('fab28600-0000-4000-8000-000000000114', 'Appareil velours ivoire',   500,  0)
) AS v (id, nom, yield, perte)
ON CONFLICT (id) DO NOTHING;

-- Compositions (DELETE+INSERT : rejouable).
DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28600-0000-4000-8000-0000000001%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid::uuid, ing.id, v.qte, 'g'
FROM (VALUES
  -- Appareil cheesecake cuit — 1985 g cru (cuisson douce, coeur 65 °C)
  ('fab28600-0000-4000-8000-000000000101', 'Crème cheese',                       1000::numeric),
  ('fab28600-0000-4000-8000-000000000101', 'Sucre semoule',                       250),
  ('fab28600-0000-4000-8000-000000000101', 'Oeufs entiers liquides',              350),
  ('fab28600-0000-4000-8000-000000000101', 'Crème fraîche',                       300),
  ('fab28600-0000-4000-8000-000000000101', 'Maizina',                              40),
  ('fab28600-0000-4000-8000-000000000101', 'Citron',                               40),
  ('fab28600-0000-4000-8000-000000000101', 'Vanille poudre',                        5),
  -- Fond spéculoos — 1000 g (70/30 biscuit/beurre fondu)
  ('fab28600-0000-4000-8000-000000000102', 'Biscuit spéculoos',                   700),
  ('fab28600-0000-4000-8000-000000000102', 'Beurre',                              300),
  -- Mousse pralinée — 1500 g
  ('fab28600-0000-4000-8000-000000000103', 'Crème fraîche',                       750),
  ('fab28600-0000-4000-8000-000000000103', 'Praliné noisette 50%',                400),
  ('fab28600-0000-4000-8000-000000000103', 'Lait',                                150),
  ('fab28600-0000-4000-8000-000000000103', 'Chocolat de couverture Lait 33%',     188),
  ('fab28600-0000-4000-8000-000000000103', 'Gélatine en feuille',                  12),
  -- Mousse caramel — 1500 g dont 500 g de Caramel tendre (recipe_sub_recipes)
  ('fab28600-0000-4000-8000-000000000104', 'Crème fraîche',                       800),
  ('fab28600-0000-4000-8000-000000000104', 'Oeufs Jaune',                         100),
  ('fab28600-0000-4000-8000-000000000104', 'Sucre semoule',                        86),
  ('fab28600-0000-4000-8000-000000000104', 'Gélatine en feuille',                  14),
  -- Bavaroise coco — 1400 g
  ('fab28600-0000-4000-8000-000000000105', 'Purée de coco',                       500),
  ('fab28600-0000-4000-8000-000000000105', 'Lait',                                150),
  ('fab28600-0000-4000-8000-000000000105', 'Sucre semoule',                       130),
  ('fab28600-0000-4000-8000-000000000105', 'Oeufs Jaune',                         120),
  ('fab28600-0000-4000-8000-000000000105', 'Crème fraîche',                       486),
  ('fab28600-0000-4000-8000-000000000105', 'Gélatine en feuille',                  14),
  -- Crémeux citron — 900 g (cuisson a l'anglaise 83 °C)
  ('fab28600-0000-4000-8000-000000000106', 'Citron',                              250),
  ('fab28600-0000-4000-8000-000000000106', 'Oeufs entiers liquides',              250),
  ('fab28600-0000-4000-8000-000000000106', 'Sucre semoule',                       220),
  ('fab28600-0000-4000-8000-000000000106', 'Beurre',                              174),
  ('fab28600-0000-4000-8000-000000000106', 'Gélatine en feuille',                   6),
  -- Crémeux passion — 900 g
  ('fab28600-0000-4000-8000-000000000107', 'Purée de passion',                    300),
  ('fab28600-0000-4000-8000-000000000107', 'Oeufs entiers liquides',              250),
  ('fab28600-0000-4000-8000-000000000107', 'Sucre semoule',                       180),
  ('fab28600-0000-4000-8000-000000000107', 'Beurre',                              162),
  ('fab28600-0000-4000-8000-000000000107', 'Gélatine en feuille',                   8),
  -- Crémeux mangue — 900 g
  ('fab28600-0000-4000-8000-000000000108', 'Purée de mangue',                     350),
  ('fab28600-0000-4000-8000-000000000108', 'Oeufs entiers liquides',              220),
  ('fab28600-0000-4000-8000-000000000108', 'Sucre semoule',                       150),
  ('fab28600-0000-4000-8000-000000000108', 'Beurre',                              152),
  ('fab28600-0000-4000-8000-000000000108', 'Gélatine en feuille',                   8),
  ('fab28600-0000-4000-8000-000000000108', 'Maizina',                              20),
  -- Mousse framboise — 1450 g
  ('fab28600-0000-4000-8000-000000000109', 'Purée framboises',                    600),
  ('fab28600-0000-4000-8000-000000000109', 'Crème fraîche',                       650),
  ('fab28600-0000-4000-8000-000000000109', 'Sucre semoule',                       184),
  ('fab28600-0000-4000-8000-000000000109', 'Gélatine en feuille',                  16),
  -- Biscuit red velvet — 1600 g (lait citronne = babeurre)
  ('fab28600-0000-4000-8000-000000000110', 'Farine Fleur',                        450),
  ('fab28600-0000-4000-8000-000000000110', 'Sucre semoule',                       400),
  ('fab28600-0000-4000-8000-000000000110', 'Oeufs entiers liquides',              300),
  ('fab28600-0000-4000-8000-000000000110', 'Huile de table',                      200),
  ('fab28600-0000-4000-8000-000000000110', 'Lait',                                180),
  ('fab28600-0000-4000-8000-000000000110', 'Cacao en poudre 10/12',                30),
  ('fab28600-0000-4000-8000-000000000110', 'Colorant hydrosoluble Rouge Fraise',   12),
  ('fab28600-0000-4000-8000-000000000110', 'Levure chimique',                      15),
  ('fab28600-0000-4000-8000-000000000110', 'Sel de table fin',                      3),
  ('fab28600-0000-4000-8000-000000000110', 'Vanille poudre',                        5),
  ('fab28600-0000-4000-8000-000000000110', 'Citron',                                5),
  -- Crème cheese frosting — 1200 g
  ('fab28600-0000-4000-8000-000000000111', 'Crème cheese',                        700),
  ('fab28600-0000-4000-8000-000000000111', 'Beurre',                              200),
  ('fab28600-0000-4000-8000-000000000111', 'Sucre glace',                         290),
  ('fab28600-0000-4000-8000-000000000111', 'Vanille poudre',                        5),
  ('fab28600-0000-4000-8000-000000000111', 'Citron',                                5),
  -- Biscuit brownie — 1800 g (fondant, cuisson 170 °C)
  ('fab28600-0000-4000-8000-000000000112', 'Chocolat de couverture Noir 55%',     400),
  ('fab28600-0000-4000-8000-000000000112', 'Beurre',                              350),
  ('fab28600-0000-4000-8000-000000000112', 'Sucre semoule',                       400),
  ('fab28600-0000-4000-8000-000000000112', 'Oeufs entiers liquides',              350),
  ('fab28600-0000-4000-8000-000000000112', 'Farine Fleur',                        217),
  ('fab28600-0000-4000-8000-000000000112', 'Cacao en poudre 10/12',                40),
  ('fab28600-0000-4000-8000-000000000112', 'Noix décortiquées',                    40),
  ('fab28600-0000-4000-8000-000000000112', 'Sel de table fin',                      3),
  -- Appareil cake chocolat — 1600 g
  ('fab28600-0000-4000-8000-000000000113', 'Farine Fleur',                        400),
  ('fab28600-0000-4000-8000-000000000113', 'Sucre semoule',                       380),
  ('fab28600-0000-4000-8000-000000000113', 'Beurre',                              300),
  ('fab28600-0000-4000-8000-000000000113', 'Oeufs entiers liquides',              350),
  ('fab28600-0000-4000-8000-000000000113', 'Cacao en poudre 10/12',                78),
  ('fab28600-0000-4000-8000-000000000113', 'Lait',                                 80),
  ('fab28600-0000-4000-8000-000000000113', 'Levure chimique',                      12),
  -- Appareil velours ivoire — 500 g (pistolet, 50/50 a 45 °C)
  ('fab28600-0000-4000-8000-000000000114', 'Beurre de cacao',                     250),
  ('fab28600-0000-4000-8000-000000000114', 'Chocolat couverture blanc 26.4%',     250)
) AS v (rid, ingredient, qte)
JOIN _prem_ing ing ON ing.name = v.ingredient;

-- La mousse caramel consomme la base transversale « Caramel tendre »
-- (500 g de pesee, integres au yield de 1500 g).
DELETE FROM recipe_sub_recipes
 WHERE recipe_id = 'fab28600-0000-4000-8000-000000000104';

INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity)
SELECT 'fab28600-0000-4000-8000-000000000104', b.id, 500
FROM _prem_base b WHERE b.name = 'Caramel tendre';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 39 fiches produits (mode_cout = compose). yield_quantity = nb de
--    pieces du format par defaut. product_id = le produit vendu (les
--    declinaisons passent par les formats : Noisette 8 pers, Opera).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id)
SELECT v.id, v.nom, false, 'compose', v.yield, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'patisserie'),
       v.product_id::uuid
FROM (VALUES
  ('fab28600-0000-4000-8000-000000000121'::uuid, 'Amandine',                  1::numeric, '93730881-1441-46d7-8da5-cfa6aa55d1a3'),
  ('fab28600-0000-4000-8000-000000000122', 'Brownie framboise',        15, '6deeb9dc-353c-499f-9308-50034f5ddd7b'),
  ('fab28600-0000-4000-8000-000000000123', 'Casablanca',               12, '54525384-b437-4056-83e1-c4497a2cf73d'),
  ('fab28600-0000-4000-8000-000000000124', 'Cheesecake citron',        12, 'e1d5bdb3-da6e-4ac9-8e57-e6eabbe19330'),
  ('fab28600-0000-4000-8000-000000000125', 'Cheesecake framboise',     12, 'fd3a6125-8ed1-4332-9087-45f4f74794bc'),
  ('fab28600-0000-4000-8000-000000000126', 'Cheesecake Lotus',         12, 'ed64daaa-131d-4774-867a-88b2af766060'),
  ('fab28600-0000-4000-8000-000000000127', 'Cheesecake Oreo',          12, 'dd2582ba-9277-42bf-8117-a6d5948552ab'),
  ('fab28600-0000-4000-8000-000000000128', 'Chocolat caramel',         12, '4789c1b3-9763-4b36-8436-e2395469ee43'),
  ('fab28600-0000-4000-8000-000000000129', 'Crunché caramel',          15, '1a28ada6-ad20-4f37-a3c6-fc83c2fdb930'),
  ('fab28600-0000-4000-8000-000000000130', 'Cake au chocolat',          7, '4616ea67-99f9-4ea2-9e0e-2ad494f5da6f'),
  ('fab28600-0000-4000-8000-000000000131', 'Forêt noire',               1, '8e520d99-5556-4bb9-a117-1216204d69f1'),
  ('fab28600-0000-4000-8000-000000000132', 'Feuille d''automne',       12, '41ade878-c1f6-4ed9-94ff-0bbc5e88a588'),
  ('fab28600-0000-4000-8000-000000000133', 'Maruja',                   24, '2f24ea5d-e4f0-47be-b698-bd4a70a061fc'),
  ('fab28600-0000-4000-8000-000000000134', 'Milka',                     8, 'd249d680-c76d-4fea-a8e9-ce208d9a90a9'),
  ('fab28600-0000-4000-8000-000000000135', 'Noisette',                 12, 'c92f2b1b-a055-44d2-82f5-4a54234a841a'),
  ('fab28600-0000-4000-8000-000000000136', 'Ôfauria',                   6, '4155e31a-063b-43f6-9489-eb99521c3dad'),
  ('fab28600-0000-4000-8000-000000000137', 'Pralino',                  24, 'faffef7f-7f37-46fb-8416-7ec36d9b580d'),
  ('fab28600-0000-4000-8000-000000000138', 'Pralinoire',               12, 'bac23dc4-b1d5-486a-b850-75aee6d20a7e'),
  ('fab28600-0000-4000-8000-000000000139', 'Praliné noisette (entremets)', 15, '46ad536c-643f-439d-9e45-ecc44b597e01'),
  ('fab28600-0000-4000-8000-000000000140', 'Prince noir',              12, '0a0bf999-6cf6-4e20-9251-65a3f06e98de'),
  ('fab28600-0000-4000-8000-000000000141', 'Pièce en pâte d''amande',  20, 'ecd4e31c-2842-4feb-a73b-74a9c6b4b3a6'),
  ('fab28600-0000-4000-8000-000000000142', 'Red velvet',               12, '71abcd5d-8a07-4210-819f-f83bde0eb5f7'),
  ('fab28600-0000-4000-8000-000000000143', 'Royal caramel',            24, 'bf564252-70c4-4887-958e-7d1d9fe3dc93'),
  ('fab28600-0000-4000-8000-000000000144', 'Royal chocolat',            8, '77dd9e20-d7ce-4fe3-96db-c22c9d2b9f70'),
  ('fab28600-0000-4000-8000-000000000145', 'Tarte banane au chocolat',  1, '810f2ebb-61bc-4134-9dd6-470341cb20dc'),
  ('fab28600-0000-4000-8000-000000000146', 'Tarte kiwi',                1, '3758ac7e-da20-4dab-96f3-d0037fb91adc'),
  ('fab28600-0000-4000-8000-000000000147', 'Tarte mangue',              1, '00000d78-757d-4bbc-91cb-bcdf8f7f0931'),
  ('fab28600-0000-4000-8000-000000000148', 'Tarte pomme et amande',     1, '0a911127-8fe4-4177-8d8b-1f6308eb1644'),
  ('fab28600-0000-4000-8000-000000000149', 'Tarte pêche',               1, 'a0710e93-a6a8-46f3-bad2-ef1195f58671'),
  ('fab28600-0000-4000-8000-000000000150', 'Trio',                     12, '7ddde2fb-0b55-4f2e-8633-632a80204a4f'),
  ('fab28600-0000-4000-8000-000000000151', 'Trompe-l''œil citron',     12, '55ff974d-d1b3-4b49-a8ba-74ea076c9f5b'),
  ('fab28600-0000-4000-8000-000000000152', 'Trompe-l''œil coco',       12, '632cf287-e461-4900-9301-290d748d2832'),
  ('fab28600-0000-4000-8000-000000000153', 'Trompe-l''œil framboise',  12, '9c2c9981-c8c6-49aa-b4ea-cc2addc96a83'),
  ('fab28600-0000-4000-8000-000000000154', 'Trompe-l''œil mangue',     12, '766e8117-3e09-4c77-bda2-61c2612ae7ff'),
  ('fab28600-0000-4000-8000-000000000155', 'Vanille américaine',       12, '9ab518a1-6a6a-498c-9b15-889f37026419'),
  ('fab28600-0000-4000-8000-000000000156', 'À la framboise',            8, '9addcb19-6b5b-40ae-a3d9-6f3ea73e27b4'),
  ('fab28600-0000-4000-8000-000000000157', 'Éclair fraise',            24, '6a246884-00a4-4e71-aa16-ce434fa84012'),
  ('fab28600-0000-4000-8000-000000000158', 'Éclat passion',             6, '41f46f33-77dc-4b43-8604-99b6fe8c9ca4'),
  ('fab28600-0000-4000-8000-000000000159', 'Ô Vanilla',                24, '482f98cb-4c03-41ce-86e2-314eb3720d72')
) AS v (id, nom, yield, product_id)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 41 formats. nb_par_defaut = pieces vendables du contenant ;
--    quantite_par_format = poids NET d'une piece (somme nomenclature / nb).
--    Le format Opera (0201) s'accroche a la recette EXISTANTE de la mig 273.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id, nb_parts)
SELECT v.id, v.recipe_id::uuid, c.id, v.qpf, 'g', v.nb, v.is_default, v.ordre,
       v.product_id::uuid, v.nb_parts
FROM (VALUES
  -- Pieces individuelles et entiers premium
  ('fab28600-0000-4000-8000-000000000221'::uuid, 'fab28600-0000-4000-8000-000000000121', 'Cercle à tarte Ø28 cm',               2250.00::numeric,  1, true, 1, '93730881-1441-46d7-8da5-cfa6aa55d1a3', 10),
  ('fab28600-0000-4000-8000-000000000222', 'fab28600-0000-4000-8000-000000000122', 'Plaque à cubes (15)',                  101.00, 15, true, 1, '6deeb9dc-353c-499f-9308-50034f5ddd7b', NULL::int),
  ('fab28600-0000-4000-8000-000000000223', 'fab28600-0000-4000-8000-000000000123', 'Plaque à cylindres individuels (12)',  100.00, 12, true, 1, '54525384-b437-4056-83e1-c4497a2cf73d', NULL),
  ('fab28600-0000-4000-8000-000000000224', 'fab28600-0000-4000-8000-000000000124', 'Plaque à cylindres individuels (12)',  110.00, 12, true, 1, 'e1d5bdb3-da6e-4ac9-8e57-e6eabbe19330', NULL),
  ('fab28600-0000-4000-8000-000000000225', 'fab28600-0000-4000-8000-000000000125', 'Plaque à cylindres individuels (12)',  110.00, 12, true, 1, 'fd3a6125-8ed1-4332-9087-45f4f74794bc', NULL),
  ('fab28600-0000-4000-8000-000000000226', 'fab28600-0000-4000-8000-000000000126', 'Plaque à cylindres individuels (12)',  110.00, 12, true, 1, 'ed64daaa-131d-4774-867a-88b2af766060', NULL),
  ('fab28600-0000-4000-8000-000000000227', 'fab28600-0000-4000-8000-000000000127', 'Plaque à cylindres individuels (12)',  110.00, 12, true, 1, 'dd2582ba-9277-42bf-8117-a6d5948552ab', NULL),
  ('fab28600-0000-4000-8000-000000000228', 'fab28600-0000-4000-8000-000000000128', 'Plaque à cylindres individuels (12)',  105.00, 12, true, 1, '4789c1b3-9763-4b36-8436-e2395469ee43', NULL),
  ('fab28600-0000-4000-8000-000000000229', 'fab28600-0000-4000-8000-000000000129', 'Plaque à cubes (15)',                  104.00, 15, true, 1, '1a28ada6-ad20-4f37-a3c6-fc83c2fdb930', NULL),
  ('fab28600-0000-4000-8000-000000000230', 'fab28600-0000-4000-8000-000000000130', 'Moule à cake 25 cm',                    96.00,  7, true, 1, '4616ea67-99f9-4ea2-9e0e-2ad494f5da6f', NULL),
  ('fab28600-0000-4000-8000-000000000231', 'fab28600-0000-4000-8000-000000000131', 'Cercle à entremets haut Ø20 x 6 cm',  1820.00,  1, true, 1, '8e520d99-5556-4bb9-a117-1216204d69f1', 10),
  ('fab28600-0000-4000-8000-000000000232', 'fab28600-0000-4000-8000-000000000132', 'Plaque à cylindres individuels (12)',   97.00, 12, true, 1, '41ade878-c1f6-4ed9-94ff-0bbc5e88a588', NULL),
  ('fab28600-0000-4000-8000-000000000233', 'fab28600-0000-4000-8000-000000000133', 'Plaque demi-sphères Ø7 cm (24)',        79.00, 24, true, 1, '2f24ea5d-e4f0-47be-b698-bd4a70a061fc', NULL),
  ('fab28600-0000-4000-8000-000000000234', 'fab28600-0000-4000-8000-000000000134', 'Plaque à cœurs individuels (8)',        99.00,  8, true, 1, 'd249d680-c76d-4fea-a8e9-ce208d9a90a9', NULL),
  ('fab28600-0000-4000-8000-000000000235', 'fab28600-0000-4000-8000-000000000135', 'Plaque à cylindres individuels (12)',  103.00, 12, true, 1, 'c92f2b1b-a055-44d2-82f5-4a54234a841a', NULL),
  ('fab28600-0000-4000-8000-000000000260', 'fab28600-0000-4000-8000-000000000135', 'Cercle à entremets Ø20 x 4,5 cm',     1300.00,  1, false, 2, '762225ef-e86d-43f5-a066-6e975a83f601', 8),
  ('fab28600-0000-4000-8000-000000000236', 'fab28600-0000-4000-8000-000000000136', 'Plaque à dômes spirale (6)',           120.00,  6, true, 1, '4155e31a-063b-43f6-9489-eb99521c3dad', NULL),
  ('fab28600-0000-4000-8000-000000000237', 'fab28600-0000-4000-8000-000000000137', 'Plaque demi-sphères Ø7 cm (24)',        80.00, 24, true, 1, 'faffef7f-7f37-46fb-8416-7ec36d9b580d', NULL),
  ('fab28600-0000-4000-8000-000000000238', 'fab28600-0000-4000-8000-000000000138', 'Plaque à cylindres individuels (12)',  101.00, 12, true, 1, 'bac23dc4-b1d5-486a-b850-75aee6d20a7e', NULL),
  ('fab28600-0000-4000-8000-000000000239', 'fab28600-0000-4000-8000-000000000139', 'Plaque à cubes (15)',                   96.00, 15, true, 1, '46ad536c-643f-439d-9e45-ecc44b597e01', NULL),
  ('fab28600-0000-4000-8000-000000000240', 'fab28600-0000-4000-8000-000000000140', 'Plaque à cylindres individuels (12)',  104.00, 12, true, 1, '0a0bf999-6cf6-4e20-9251-65a3f06e98de', NULL),
  ('fab28600-0000-4000-8000-000000000241', 'fab28600-0000-4000-8000-000000000141', NULL,                                    65.00, 20, true, 1, 'ecd4e31c-2842-4feb-a73b-74a9c6b4b3a6', NULL),
  ('fab28600-0000-4000-8000-000000000242', 'fab28600-0000-4000-8000-000000000142', 'Plaque à cylindres individuels (12)',  110.00, 12, true, 1, '71abcd5d-8a07-4210-819f-f83bde0eb5f7', NULL),
  ('fab28600-0000-4000-8000-000000000243', 'fab28600-0000-4000-8000-000000000143', 'Plaque demi-sphères Ø7 cm (24)',        84.00, 24, true, 1, 'bf564252-70c4-4887-958e-7d1d9fe3dc93', NULL),
  ('fab28600-0000-4000-8000-000000000244', 'fab28600-0000-4000-8000-000000000144', 'Plaque à cœurs individuels (8)',       110.00,  8, true, 1, '77dd9e20-d7ce-4fe3-96db-c22c9d2b9f70', NULL),
  -- Tartelettes individuelles O10 (1 piece par cercle)
  ('fab28600-0000-4000-8000-000000000245', 'fab28600-0000-4000-8000-000000000145', 'Cercle à tartelette Ø10 cm',           180.00,  1, true, 1, '810f2ebb-61bc-4134-9dd6-470341cb20dc', NULL),
  ('fab28600-0000-4000-8000-000000000246', 'fab28600-0000-4000-8000-000000000146', 'Cercle à tartelette Ø10 cm',           202.00,  1, true, 1, '3758ac7e-da20-4dab-96f3-d0037fb91adc', NULL),
  ('fab28600-0000-4000-8000-000000000247', 'fab28600-0000-4000-8000-000000000147', 'Cercle à tartelette Ø10 cm',           207.00,  1, true, 1, '00000d78-757d-4bbc-91cb-bcdf8f7f0931', NULL),
  ('fab28600-0000-4000-8000-000000000248', 'fab28600-0000-4000-8000-000000000148', 'Cercle à tartelette Ø10 cm',           187.00,  1, true, 1, '0a911127-8fe4-4177-8d8b-1f6308eb1644', NULL),
  ('fab28600-0000-4000-8000-000000000249', 'fab28600-0000-4000-8000-000000000149', 'Cercle à tartelette Ø10 cm',           212.00,  1, true, 1, 'a0710e93-a6a8-46f3-bad2-ef1195f58671', NULL),
  ('fab28600-0000-4000-8000-000000000250', 'fab28600-0000-4000-8000-000000000150', 'Plaque à cylindres individuels (12)',  106.00, 12, true, 1, '7ddde2fb-0b55-4f2e-8633-632a80204a4f', NULL),
  -- Trompe-l'oeil : 24 demi-spheres = 12 fruits assembles
  ('fab28600-0000-4000-8000-000000000251', 'fab28600-0000-4000-8000-000000000151', 'Plaque demi-sphères Ø7 cm (24)',       106.00, 12, true, 1, '55ff974d-d1b3-4b49-a8ba-74ea076c9f5b', NULL),
  ('fab28600-0000-4000-8000-000000000252', 'fab28600-0000-4000-8000-000000000152', 'Plaque demi-sphères Ø7 cm (24)',       111.00, 12, true, 1, '632cf287-e461-4900-9301-290d748d2832', NULL),
  ('fab28600-0000-4000-8000-000000000253', 'fab28600-0000-4000-8000-000000000153', 'Plaque demi-sphères Ø7 cm (24)',       106.00, 12, true, 1, '9c2c9981-c8c6-49aa-b4ea-cc2addc96a83', NULL),
  ('fab28600-0000-4000-8000-000000000254', 'fab28600-0000-4000-8000-000000000154', 'Plaque demi-sphères Ø7 cm (24)',       106.00, 12, true, 1, '766e8117-3e09-4c77-bda2-61c2612ae7ff', NULL),
  ('fab28600-0000-4000-8000-000000000255', 'fab28600-0000-4000-8000-000000000155', 'Plaque à cylindres individuels (12)',  105.00, 12, true, 1, '9ab518a1-6a6a-498c-9b15-889f37026419', NULL),
  ('fab28600-0000-4000-8000-000000000256', 'fab28600-0000-4000-8000-000000000156', 'Plaque à cœurs individuels (8)',        98.00,  8, true, 1, '9addcb19-6b5b-40ae-a3d9-6f3ea73e27b4', NULL),
  ('fab28600-0000-4000-8000-000000000257', 'fab28600-0000-4000-8000-000000000157', 'Plaque de cuisson plate 60x40',        123.00, 24, true, 1, '6a246884-00a4-4e71-aa16-ce434fa84012', NULL),
  ('fab28600-0000-4000-8000-000000000258', 'fab28600-0000-4000-8000-000000000158', 'Plaque à dômes spirale (6)',           108.00,  6, true, 1, '41f46f33-77dc-4b43-8604-99b6fe8c9ca4', NULL),
  ('fab28600-0000-4000-8000-000000000259', 'fab28600-0000-4000-8000-000000000159', 'Plaque demi-sphères Ø7 cm (24)',        81.00, 24, true, 1, '482f98cb-4c03-41ce-86e2-314eb3720d72', NULL),
  -- OPERA piece individuelle : 4e format de la recette existante (mig 273),
  -- bande 60x10x4,5 decoupee en 18 pieces de ~99 g. JAMAIS par defaut.
  ('fab28600-0000-4000-8000-000000000201', '0be7a000-0000-4000-8000-000000000001', 'Cadre bande 60x10x4,5 cm',              99.44, 18, false, 4, 'ba364e7b-89ee-4851-827b-83f6b0a767dc', NULL)
) AS v (id, recipe_id, contenant, qpf, nb, is_default, ordre, product_id, nb_parts)
LEFT JOIN _prem_cont c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomenclatures par format — poids NETS pour TOUT le contenant.
--    Pertes de mise en oeuvre : mousses/cremes pochees 3 %, ganaches 2 %,
--    glacages 5 %, sinon 0 (convention mig 273).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id::text LIKE 'fab28600-0000-4000-8000-0000000002%';

-- 6a. Composants venant des bases de CETTE migration (UUID litteraux).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, v.rid::uuid, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Brownie framboise (15 cubes — 1520 g)
  ('fab28600-0000-4000-8000-000000000222', 'biscuit',   'fab28600-0000-4000-8000-000000000112', 900::numeric, 0::numeric, 1::smallint),
  ('fab28600-0000-4000-8000-000000000222', 'garniture', 'fab28600-0000-4000-8000-000000000109', 400, 3, 2),
  -- Cheesecake citron (12 cylindres — 1320 g)
  ('fab28600-0000-4000-8000-000000000224', 'fond',      'fab28600-0000-4000-8000-000000000102', 360, 0, 1),
  ('fab28600-0000-4000-8000-000000000224', 'garniture', 'fab28600-0000-4000-8000-000000000101', 840, 2, 2),
  ('fab28600-0000-4000-8000-000000000224', 'nappage',   'fab28600-0000-4000-8000-000000000106', 110, 3, 3),
  -- Cheesecake framboise
  ('fab28600-0000-4000-8000-000000000225', 'fond',      'fab28600-0000-4000-8000-000000000102', 360, 0, 1),
  ('fab28600-0000-4000-8000-000000000225', 'garniture', 'fab28600-0000-4000-8000-000000000101', 840, 2, 2),
  -- Cheesecake Lotus
  ('fab28600-0000-4000-8000-000000000226', 'fond',      'fab28600-0000-4000-8000-000000000102', 360, 0, 1),
  ('fab28600-0000-4000-8000-000000000226', 'garniture', 'fab28600-0000-4000-8000-000000000101', 840, 2, 2),
  -- Cheesecake Oreo
  ('fab28600-0000-4000-8000-000000000227', 'fond',      'fab28600-0000-4000-8000-000000000102', 360, 0, 1),
  ('fab28600-0000-4000-8000-000000000227', 'garniture', 'fab28600-0000-4000-8000-000000000101', 840, 2, 2),
  -- Crunché caramel (15 cubes — 1560 g) : mousse caramel
  ('fab28600-0000-4000-8000-000000000229', 'garniture', 'fab28600-0000-4000-8000-000000000104', 750, 3, 3),
  -- Cake au chocolat (moule 25 cm, 7 tranches — 670 g)
  ('fab28600-0000-4000-8000-000000000230', 'garniture', 'fab28600-0000-4000-8000-000000000113', 630, 0, 1),
  -- Noisette (12 cylindres — 1240 g) : mousse pralinee
  ('fab28600-0000-4000-8000-000000000235', 'garniture', 'fab28600-0000-4000-8000-000000000103', 660, 3, 3),
  -- Noisette 8 personnes (cercle O20 — 1300 g)
  ('fab28600-0000-4000-8000-000000000260', 'garniture', 'fab28600-0000-4000-8000-000000000103', 700, 3, 3),
  -- Pralino (24 demi-spheres — 1920 g)
  ('fab28600-0000-4000-8000-000000000237', 'garniture', 'fab28600-0000-4000-8000-000000000103', 1100, 3, 3),
  -- Pralinoire (12 cylindres — 1210 g)
  ('fab28600-0000-4000-8000-000000000238', 'garniture', 'fab28600-0000-4000-8000-000000000103', 240, 3, 4),
  -- Praliné noisette (15 cubes — 1440 g)
  ('fab28600-0000-4000-8000-000000000239', 'garniture', 'fab28600-0000-4000-8000-000000000103', 800, 3, 3),
  -- Prince noir (12 cylindres — 1250 g) : socle brownie
  ('fab28600-0000-4000-8000-000000000240', 'biscuit',   'fab28600-0000-4000-8000-000000000112', 300, 0, 1),
  -- Red velvet (12 cylindres — 1320 g)
  ('fab28600-0000-4000-8000-000000000242', 'biscuit',   'fab28600-0000-4000-8000-000000000110', 720, 0, 1),
  ('fab28600-0000-4000-8000-000000000242', 'garniture', 'fab28600-0000-4000-8000-000000000111', 480, 3, 2),
  ('fab28600-0000-4000-8000-000000000242', 'decor',     'fab28600-0000-4000-8000-000000000110',  60, 0, 4),
  -- Royal caramel (24 demi-spheres — 2040 g)
  ('fab28600-0000-4000-8000-000000000243', 'garniture', 'fab28600-0000-4000-8000-000000000104', 1000, 3, 3),
  -- Trompe-l'oeil citron (12 fruits — 1280 g)
  ('fab28600-0000-4000-8000-000000000251', 'insert',    'fab28600-0000-4000-8000-000000000106', 240, 3, 2),
  ('fab28600-0000-4000-8000-000000000251', 'decor',     'fab28600-0000-4000-8000-000000000114', 100, 0, 4),
  -- Trompe-l'oeil coco (12 fruits — 1340 g)
  ('fab28600-0000-4000-8000-000000000252', 'insert',    'fab28600-0000-4000-8000-000000000105', 240, 3, 2),
  ('fab28600-0000-4000-8000-000000000252', 'decor',     'fab28600-0000-4000-8000-000000000114', 100, 0, 4),
  -- Trompe-l'oeil framboise (12 fruits — 1280 g)
  ('fab28600-0000-4000-8000-000000000253', 'insert',    'fab28600-0000-4000-8000-000000000109', 240, 3, 2),
  ('fab28600-0000-4000-8000-000000000253', 'decor',     'fab28600-0000-4000-8000-000000000114', 100, 0, 4),
  -- Trompe-l'oeil mangue (12 fruits — 1280 g)
  ('fab28600-0000-4000-8000-000000000254', 'insert',    'fab28600-0000-4000-8000-000000000108', 240, 3, 2),
  ('fab28600-0000-4000-8000-000000000254', 'decor',     'fab28600-0000-4000-8000-000000000114', 100, 0, 4),
  -- Éclat passion (6 domes — 650 g)
  ('fab28600-0000-4000-8000-000000000258', 'garniture', 'fab28600-0000-4000-8000-000000000105', 350, 3, 2),
  ('fab28600-0000-4000-8000-000000000258', 'insert',    'fab28600-0000-4000-8000-000000000107', 130, 3, 3),
  -- Ô Vanilla (24 demi-spheres — 1935 g)
  ('fab28600-0000-4000-8000-000000000259', 'decor',     'fab28600-0000-4000-8000-000000000114', 100, 0, 5),
  -- OPERA bande 60x10x4,5 — masterclass x0,25 (surface 600/2400 cm2), 1790 g
  ('fab28600-0000-4000-8000-000000000201', 'biscuit',   '0be7a000-0000-4000-8000-000000000005', 599.25, 0, 1),
  ('fab28600-0000-4000-8000-000000000201', 'imbibage',  '0be7a000-0000-4000-8000-000000000002', 342.00, 0, 3),
  ('fab28600-0000-4000-8000-000000000201', 'garniture', '0be7a000-0000-4000-8000-000000000003', 346.50, 5, 4),
  ('fab28600-0000-4000-8000-000000000201', 'garniture', '0be7a000-0000-4000-8000-000000000006', 257.25, 2, 5),
  ('fab28600-0000-4000-8000-000000000201', 'glacage',   '0be7a000-0000-4000-8000-000000000004', 220.00, 5, 6)
) AS v (fid, role, rid, qte, perte, ordre);

-- 6b. Composants venant des bases transversales (resolution par nom).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, b.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Amandine (tarte O28 — 2250 g)
  ('fab28600-0000-4000-8000-000000000221', 'fond',        'Pâte sucrée',                       450::numeric, 3::numeric, 1::smallint),
  ('fab28600-0000-4000-8000-000000000221', 'garniture',   'Crème d''amande',                  1300, 2, 2),
  -- Casablanca (12 cylindres — 1200 g)
  ('fab28600-0000-4000-8000-000000000223', 'biscuit',     'Génoise cacao',                     240, 0, 1),
  ('fab28600-0000-4000-8000-000000000223', 'imbibage',    'Sirop à 30°B',                       60, 0, 2),
  ('fab28600-0000-4000-8000-000000000223', 'insert',      'Ganache chocolat au lait',          300, 2, 3),
  ('fab28600-0000-4000-8000-000000000223', 'garniture',   'Mousse au chocolat noir',           480, 3, 4),
  ('fab28600-0000-4000-8000-000000000223', 'glacage',     'Glaçage miroir cacao',              120, 5, 5),
  -- Cheesecake Oreo : pointe de ganache ivoire montee
  ('fab28600-0000-4000-8000-000000000227', 'garniture',   'Ganache montée ivoire',              40, 2, 4),
  -- Chocolat caramel (12 cylindres — 1260 g)
  ('fab28600-0000-4000-8000-000000000228', 'biscuit',     'Dacquoise noisette',                200, 0, 1),
  ('fab28600-0000-4000-8000-000000000228', 'croustillant','Croustillant praliné feuilletine',  130, 0, 2),
  ('fab28600-0000-4000-8000-000000000228', 'insert',      'Caramel tendre',                    180, 0, 3),
  ('fab28600-0000-4000-8000-000000000228', 'garniture',   'Mousse au chocolat noir',           600, 3, 4),
  ('fab28600-0000-4000-8000-000000000228', 'glacage',     'Glaçage miroir cacao',              150, 5, 5),
  -- Crunché caramel (15 cubes — 1560 g)
  ('fab28600-0000-4000-8000-000000000229', 'biscuit',     'Génoise cacao',                     200, 0, 1),
  ('fab28600-0000-4000-8000-000000000229', 'croustillant','Croustillant praliné feuilletine',  250, 0, 2),
  ('fab28600-0000-4000-8000-000000000229', 'insert',      'Caramel tendre',                    180, 0, 4),
  -- Forêt noire (cercle O20 x 6 — 1820 g)
  ('fab28600-0000-4000-8000-000000000231', 'biscuit',     'Génoise cacao',                     450, 0, 1),
  ('fab28600-0000-4000-8000-000000000231', 'imbibage',    'Sirop à 30°B',                      200, 0, 2),
  ('fab28600-0000-4000-8000-000000000231', 'garniture',   'Crème chantilly',                   650, 3, 3),
  ('fab28600-0000-4000-8000-000000000231', 'insert',      'Ganache chocolat noir',             100, 2, 5),
  -- Feuille d'automne (12 cylindres — 1160 g)
  ('fab28600-0000-4000-8000-000000000232', 'biscuit',     'Meringue française',                240, 0, 1),
  ('fab28600-0000-4000-8000-000000000232', 'garniture',   'Mousse au chocolat noir',           700, 3, 2),
  -- Maruja (24 demi-spheres — 1900 g)
  ('fab28600-0000-4000-8000-000000000233', 'biscuit',     'Génoise cacao',                     380, 0, 1),
  ('fab28600-0000-4000-8000-000000000233', 'insert',      'Ganache chocolat au lait',          580, 2, 2),
  ('fab28600-0000-4000-8000-000000000233', 'garniture',   'Mousse au chocolat noir',           700, 3, 3),
  ('fab28600-0000-4000-8000-000000000233', 'glacage',     'Glaçage miroir cacao',              240, 5, 4),
  -- Milka (8 coeurs — 790 g)
  ('fab28600-0000-4000-8000-000000000234', 'biscuit',     'Génoise cacao',                     160, 0, 1),
  ('fab28600-0000-4000-8000-000000000234', 'croustillant','Croustillant praliné feuilletine',   90, 0, 2),
  ('fab28600-0000-4000-8000-000000000234', 'garniture',   'Ganache chocolat au lait',          400, 2, 3),
  ('fab28600-0000-4000-8000-000000000234', 'glacage',     'Glaçage miroir cacao',              140, 5, 4),
  -- Noisette (12 cylindres — 1240 g)
  ('fab28600-0000-4000-8000-000000000235', 'biscuit',     'Dacquoise noisette',                240, 0, 1),
  ('fab28600-0000-4000-8000-000000000235', 'croustillant','Croustillant praliné feuilletine',  130, 0, 2),
  ('fab28600-0000-4000-8000-000000000235', 'glacage',     'Glaçage miroir cacao',              150, 5, 4),
  -- Noisette 8 personnes (cercle O20 — 1300 g)
  ('fab28600-0000-4000-8000-000000000260', 'biscuit',     'Dacquoise noisette',                250, 0, 1),
  ('fab28600-0000-4000-8000-000000000260', 'croustillant','Croustillant praliné feuilletine',  140, 0, 2),
  ('fab28600-0000-4000-8000-000000000260', 'glacage',     'Glaçage miroir cacao',              150, 5, 4),
  -- Ôfauria (6 domes spirale — 730 g)
  ('fab28600-0000-4000-8000-000000000236', 'biscuit',     'Dacquoise noisette',                130, 0, 1),
  ('fab28600-0000-4000-8000-000000000236', 'croustillant','Croustillant praliné feuilletine',   80, 0, 2),
  ('fab28600-0000-4000-8000-000000000236', 'insert',      'Caramel tendre',                     90, 0, 3),
  ('fab28600-0000-4000-8000-000000000236', 'garniture',   'Mousse au chocolat noir',           350, 3, 4),
  ('fab28600-0000-4000-8000-000000000236', 'glacage',     'Glaçage miroir cacao',               80, 5, 5),
  -- Pralino (24 demi-spheres — 1920 g)
  ('fab28600-0000-4000-8000-000000000237', 'biscuit',     'Génoise nature',                    380, 0, 1),
  ('fab28600-0000-4000-8000-000000000237', 'croustillant','Croustillant praliné feuilletine',  200, 0, 2),
  ('fab28600-0000-4000-8000-000000000237', 'glacage',     'Glaçage miroir cacao',              240, 5, 4),
  -- Pralinoire (12 cylindres — 1210 g)
  ('fab28600-0000-4000-8000-000000000238', 'biscuit',     'Dacquoise noisette',                220, 0, 1),
  ('fab28600-0000-4000-8000-000000000238', 'croustillant','Croustillant praliné feuilletine',  140, 0, 2),
  ('fab28600-0000-4000-8000-000000000238', 'garniture',   'Mousse au chocolat noir',           480, 3, 3),
  ('fab28600-0000-4000-8000-000000000238', 'glacage',     'Glaçage miroir cacao',              130, 5, 5),
  -- Praliné noisette (15 cubes — 1440 g)
  ('fab28600-0000-4000-8000-000000000239', 'biscuit',     'Dacquoise noisette',                280, 0, 1),
  ('fab28600-0000-4000-8000-000000000239', 'glacage',     'Ganache chocolat au lait',          180, 2, 4),
  -- Prince noir (12 cylindres — 1250 g)
  ('fab28600-0000-4000-8000-000000000240', 'garniture',   'Mousse au chocolat noir',           560, 3, 2),
  ('fab28600-0000-4000-8000-000000000240', 'insert',      'Ganache chocolat noir',             240, 2, 3),
  ('fab28600-0000-4000-8000-000000000240', 'glacage',     'Glaçage miroir cacao',              150, 5, 4),
  -- Royal caramel (24 demi-spheres — 2040 g)
  ('fab28600-0000-4000-8000-000000000243', 'biscuit',     'Dacquoise noisette',                380, 0, 1),
  ('fab28600-0000-4000-8000-000000000243', 'croustillant','Croustillant praliné feuilletine',  260, 0, 2),
  ('fab28600-0000-4000-8000-000000000243', 'insert',      'Caramel tendre',                    180, 0, 4),
  -- Royal chocolat (8 coeurs — 885 g)
  ('fab28600-0000-4000-8000-000000000244', 'biscuit',     'Dacquoise noisette',                180, 0, 1),
  ('fab28600-0000-4000-8000-000000000244', 'croustillant','Croustillant praliné feuilletine',  110, 0, 2),
  ('fab28600-0000-4000-8000-000000000244', 'garniture',   'Mousse au chocolat noir',           460, 3, 3),
  ('fab28600-0000-4000-8000-000000000244', 'glacage',     'Glaçage miroir cacao',              120, 5, 4),
  -- Tarte banane au chocolat (O10 — 180 g)
  ('fab28600-0000-4000-8000-000000000245', 'fond',        'Pâte sucrée',                        45, 3, 1),
  ('fab28600-0000-4000-8000-000000000245', 'garniture',   'Crème pâtissière',                   50, 3, 2),
  ('fab28600-0000-4000-8000-000000000245', 'garniture',   'Ganache chocolat noir',              30, 2, 3),
  -- Tarte kiwi (O10 — 202 g)
  ('fab28600-0000-4000-8000-000000000246', 'fond',        'Pâte sucrée',                        45, 3, 1),
  ('fab28600-0000-4000-8000-000000000246', 'garniture',   'Crème pâtissière',                   45, 3, 2),
  ('fab28600-0000-4000-8000-000000000246', 'garniture',   'Crème diplomate',                    40, 3, 3),
  -- Tarte mangue (O10 — 207 g)
  ('fab28600-0000-4000-8000-000000000247', 'fond',        'Pâte sucrée',                        45, 3, 1),
  ('fab28600-0000-4000-8000-000000000247', 'garniture',   'Crème d''amande',                    40, 2, 2),
  ('fab28600-0000-4000-8000-000000000247', 'garniture',   'Crème diplomate',                    40, 3, 3),
  -- Tarte pomme et amande (O10 — 187 g)
  ('fab28600-0000-4000-8000-000000000248', 'fond',        'Pâte sucrée',                        45, 3, 1),
  ('fab28600-0000-4000-8000-000000000248', 'garniture',   'Crème d''amande',                    60, 2, 2),
  -- Tarte pêche (O10 — 212 g)
  ('fab28600-0000-4000-8000-000000000249', 'fond',        'Pâte sucrée',                        45, 3, 1),
  ('fab28600-0000-4000-8000-000000000249', 'garniture',   'Crème pâtissière',                   40, 3, 2),
  ('fab28600-0000-4000-8000-000000000249', 'garniture',   'Crème diplomate',                    40, 3, 3),
  -- Trio (12 cylindres — 1270 g)
  ('fab28600-0000-4000-8000-000000000250', 'biscuit',     'Génoise cacao',                     240, 0, 1),
  ('fab28600-0000-4000-8000-000000000250', 'garniture',   'Mousse au chocolat noir',           380, 3, 2),
  ('fab28600-0000-4000-8000-000000000250', 'garniture',   'Ganache chocolat au lait',          320, 2, 3),
  ('fab28600-0000-4000-8000-000000000250', 'garniture',   'Ganache montée ivoire',             300, 2, 4),
  -- Trompe-l'oeil x4 : socle streusel + coque ganache montee ivoire
  ('fab28600-0000-4000-8000-000000000251', 'fond',        'Streusel amande',                   180, 0, 1),
  ('fab28600-0000-4000-8000-000000000251', 'garniture',   'Ganache montée ivoire',             700, 3, 3),
  ('fab28600-0000-4000-8000-000000000252', 'fond',        'Streusel amande',                   180, 0, 1),
  ('fab28600-0000-4000-8000-000000000252', 'garniture',   'Ganache montée ivoire',             700, 3, 3),
  ('fab28600-0000-4000-8000-000000000253', 'fond',        'Streusel amande',                   180, 0, 1),
  ('fab28600-0000-4000-8000-000000000253', 'garniture',   'Ganache montée ivoire',             700, 3, 3),
  ('fab28600-0000-4000-8000-000000000254', 'fond',        'Streusel amande',                   180, 0, 1),
  ('fab28600-0000-4000-8000-000000000254', 'garniture',   'Ganache montée ivoire',             700, 3, 3),
  -- Vanille américaine (12 cylindres — 1260 g)
  ('fab28600-0000-4000-8000-000000000255', 'fond',        'Streusel amande',                   200, 0, 1),
  ('fab28600-0000-4000-8000-000000000255', 'garniture',   'Crème bavaroise vanille',           600, 3, 2),
  ('fab28600-0000-4000-8000-000000000255', 'insert',      'Caramel tendre',                    160, 0, 3),
  ('fab28600-0000-4000-8000-000000000255', 'garniture',   'Ganache montée ivoire',             240, 2, 4),
  -- À la framboise (8 coeurs — 780 g)
  ('fab28600-0000-4000-8000-000000000256', 'biscuit',     'Biscuit cuillère',                  170, 0, 1),
  -- Éclair fraise (plaque 60x40, 24 pieces — 2950 g)
  ('fab28600-0000-4000-8000-000000000257', 'fond',        'Pâte à choux',                      850, 0, 1),
  ('fab28600-0000-4000-8000-000000000257', 'garniture',   'Crème diplomate',                  1300, 3, 2),
  ('fab28600-0000-4000-8000-000000000257', 'garniture',   'Crème chantilly',                   100, 3, 4),
  -- Éclat passion (6 domes — 650 g)
  ('fab28600-0000-4000-8000-000000000258', 'fond',        'Streusel amande',                   110, 0, 1),
  -- Ô Vanilla (24 demi-spheres — 1935 g)
  ('fab28600-0000-4000-8000-000000000259', 'fond',        'Streusel amande',                   280, 0, 1),
  ('fab28600-0000-4000-8000-000000000259', 'garniture',   'Crème bavaroise vanille',           780, 3, 2),
  ('fab28600-0000-4000-8000-000000000259', 'garniture',   'Ganache montée ivoire',             600, 2, 3),
  ('fab28600-0000-4000-8000-000000000259', 'insert',      'Caramel tendre',                    160, 0, 4),
  -- À la framboise : mousse framboise deja en 6a ? Non — elle vient de cette
  -- migration, elle est ci-dessous en 6a-bis via UUID. (ligne informative)
  ('fab28600-0000-4000-8000-000000000232', 'decor',       'Génoise nature',                      0.01, 0, 9)
) AS v (fid, role, source, qte, perte, ordre)
JOIN _prem_base b ON b.name = v.source
WHERE v.qte > 0.01;   -- ecarte la ligne informative

-- 6a-bis. Mousse framboise de « À la framboise » (base de cette migration).
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES ('fab28600-0000-4000-8000-000000000256', 'garniture',
        'fab28600-0000-4000-8000-000000000109', 440, 'g', 3, 2);

-- 6c. Composants INGREDIENTS directs (fruits, decors, glacages du commerce).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.fid::uuid, v.role, ing.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Amandine
  ('fab28600-0000-4000-8000-000000000221', 'fruits',   'Amarena au sirop lourd',            150::numeric, 0::numeric, 3::smallint),
  ('fab28600-0000-4000-8000-000000000221', 'decor',    'Amande effilée',                    180, 0, 4),
  ('fab28600-0000-4000-8000-000000000221', 'nappage',  'Nappage neutre',                    150, 0, 5),
  ('fab28600-0000-4000-8000-000000000221', 'decor',    'Sucre glace',                        20, 0, 6),
  -- Brownie framboise
  ('fab28600-0000-4000-8000-000000000222', 'fruits',   'Framboises',                        120, 0, 3),
  ('fab28600-0000-4000-8000-000000000222', 'glacage',  'GLAÇAGE FRAMBOISE',                 100, 5, 4),
  -- Cheesecake citron
  ('fab28600-0000-4000-8000-000000000224', 'decor',    'Citron',                             10, 0, 4),
  -- Cheesecake framboise
  ('fab28600-0000-4000-8000-000000000225', 'nappage',  'Purée framboises',                   90, 0, 3),
  ('fab28600-0000-4000-8000-000000000225', 'fruits',   'Framboises',                         30, 0, 4),
  -- Cheesecake Lotus
  ('fab28600-0000-4000-8000-000000000226', 'nappage',  'Pâte de spéculoos',                  80, 0, 3),
  ('fab28600-0000-4000-8000-000000000226', 'decor',    'Biscuit spéculoos',                  40, 0, 4),
  -- Cheesecake Oreo
  ('fab28600-0000-4000-8000-000000000227', 'decor',    'Biscuit Oreo',                       80, 0, 3),
  -- Crunché caramel
  ('fab28600-0000-4000-8000-000000000229', 'glacage',  'GLAÇAGE CARAMÈL',                   150, 5, 5),
  ('fab28600-0000-4000-8000-000000000229', 'decor',    'NOISETTE EN GRAINS',                 30, 0, 6),
  -- Cake au chocolat
  ('fab28600-0000-4000-8000-000000000230', 'decor',    'Gouttes drops 50% DGF',              40, 0, 2),
  -- Forêt noire
  ('fab28600-0000-4000-8000-000000000231', 'fruits',   'Amarena au sirop lourd',            300, 0, 4),
  ('fab28600-0000-4000-8000-000000000231', 'decor',    'Chocolat de couverture Noir 55%',   120, 0, 6),
  -- Feuille d'automne
  ('fab28600-0000-4000-8000-000000000232', 'decor',    'Chocolat de couverture Noir 55%',   200, 0, 3),
  ('fab28600-0000-4000-8000-000000000232', 'decor',    'Cacao en poudre 10/12',              20, 0, 4),
  -- Noisette + Noisette 8 personnes
  ('fab28600-0000-4000-8000-000000000235', 'decor',    'NOISETTE EN GRAINS',                 60, 0, 5),
  ('fab28600-0000-4000-8000-000000000260', 'decor',    'NOISETTE EN GRAINS',                 60, 0, 5),
  -- Praliné noisette : coeur praliné pur + noisettes torrefiees
  ('fab28600-0000-4000-8000-000000000239', 'insert',   'Praliné noisette 50%',              120, 0, 2),
  ('fab28600-0000-4000-8000-000000000239', 'decor',    'NOISETTE EN GRAINS',                 60, 0, 5),
  -- Pièce en pâte d'amande (20 pieces de 65 g, modelage)
  ('fab28600-0000-4000-8000-000000000241', 'garniture','Pâte d''amande 50%',               1200, 0, 1),
  ('fab28600-0000-4000-8000-000000000241', 'decor',    'Sucre glace',                        60, 0, 2),
  ('fab28600-0000-4000-8000-000000000241', 'decor',    'Chocolat de couverture Noir 55%',    40, 0, 3),
  -- Red velvet
  ('fab28600-0000-4000-8000-000000000242', 'fruits',   'Framboises',                         60, 0, 3),
  -- Royal caramel
  ('fab28600-0000-4000-8000-000000000243', 'glacage',  'GLAÇAGE CARAMÈL',                   160, 5, 5),
  ('fab28600-0000-4000-8000-000000000243', 'decor',    'Chocolat de couverture Lait 33%',    60, 0, 6),
  -- Royal chocolat
  ('fab28600-0000-4000-8000-000000000244', 'decor',    'Cacao en poudre 10/12',              15, 0, 5),
  -- Tartes individuelles
  ('fab28600-0000-4000-8000-000000000245', 'fruits',   'Banane',                             45, 0, 4),
  ('fab28600-0000-4000-8000-000000000245', 'nappage',  'Nappage neutre',                     10, 0, 5),
  ('fab28600-0000-4000-8000-000000000246', 'fruits',   'Kiwi',                               60, 0, 4),
  ('fab28600-0000-4000-8000-000000000246', 'nappage',  'Nappage neutre',                     12, 0, 5),
  ('fab28600-0000-4000-8000-000000000247', 'fruits',   'Mangue',                             70, 0, 4),
  ('fab28600-0000-4000-8000-000000000247', 'nappage',  'Nappage neutre',                     12, 0, 5),
  ('fab28600-0000-4000-8000-000000000248', 'fruits',   'Pomme',                              70, 0, 3),
  ('fab28600-0000-4000-8000-000000000248', 'nappage',  'Nappage neutre',                     12, 0, 4),
  ('fab28600-0000-4000-8000-000000000249', 'fruits',   'Pêche au sirop',                     75, 0, 4),
  ('fab28600-0000-4000-8000-000000000249', 'nappage',  'Nappage neutre',                     12, 0, 5),
  -- Trio
  ('fab28600-0000-4000-8000-000000000250', 'decor',    'Chocolat de couverture Noir 55%',    30, 0, 5),
  -- Trompe-l'oeil : brillance / decors specifiques
  ('fab28600-0000-4000-8000-000000000251', 'nappage',  'Nappage neutre',                     60, 0, 5),
  ('fab28600-0000-4000-8000-000000000252', 'nappage',  'Nappage neutre',                     60, 0, 5),
  ('fab28600-0000-4000-8000-000000000252', 'decor',    'Noix de coco râpée',                 60, 0, 6),
  ('fab28600-0000-4000-8000-000000000253', 'nappage',  'Nappage neutre',                     60, 0, 5),
  ('fab28600-0000-4000-8000-000000000254', 'nappage',  'Nappage neutre',                     60, 0, 5),
  -- Vanille américaine
  ('fab28600-0000-4000-8000-000000000255', 'nappage',  'Nappage neutre',                     60, 0, 5),
  -- À la framboise
  ('fab28600-0000-4000-8000-000000000256', 'fruits',   'Framboises',                         80, 0, 3),
  ('fab28600-0000-4000-8000-000000000256', 'glacage',  'GLAÇAGE FRAMBOISE',                  90, 5, 4),
  -- Éclair fraise
  ('fab28600-0000-4000-8000-000000000257', 'fruits',   'Fraise',                            550, 0, 3),
  ('fab28600-0000-4000-8000-000000000257', 'nappage',  'Nappage neutre',                    150, 0, 5),
  -- Éclat passion
  ('fab28600-0000-4000-8000-000000000258', 'nappage',  'Nappage neutre',                     40, 0, 4),
  ('fab28600-0000-4000-8000-000000000258', 'decor',    'Purée de passion',                   20, 0, 5),
  -- Ô Vanilla
  ('fab28600-0000-4000-8000-000000000259', 'decor',    'Vanille poudre',                     15, 0, 6),
  -- OPERA bande : chablonnage (fond etanche, cf. mig 276), x0,25 = 25 g
  ('fab28600-0000-4000-8000-000000000201', 'chablonnage', 'Chocolat de couverture Noir 55%', 25, 0, 2)
) AS v (fid, role, ingredient, qte, perte, ordre)
JOIN _prem_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost passe par ce miroir pour les recettes composees :
--    sans lui, toutes ces fiches couteraient 0. L'Opera classique n'est PAS
--    touche : son miroir reste celui du cadre 60x40 (mig 276).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id::text LIKE 'fab28600-0000-4000-8000-0000000001%'
   AND recipe_id::text >= 'fab28600-0000-4000-8000-000000000121';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT rf.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats rf ON rf.id = c.format_id
WHERE rf.recipe_id::text LIKE 'fab28600-0000-4000-8000-0000000001%'
  AND rf.is_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Etapes de production + instructions — 6 fiches phares.
-- ─────────────────────────────────────────────────────────────────────────────

-- Cheesecake Lotus (vaut pour les 4 parfums, seule la finition change).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Fond spéculoos","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mixer les biscuits en poudre fine, ajouter le beurre fondu à 40 °C",
     "30 g par cylindre, tasser au pilon : surface plane et régulière",
     "Bloquer 20 min au froid avant de couler l''appareil"]},
  {"ordre":2,"nom":"Appareil cheesecake","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Crème cheese tempérée à 20 °C : jamais froide, sinon grumeaux",
     "Mélanger à la FEUILLE, vitesse lente — ne pas foisonner, zéro bulle d''air",
     "Chinoiser l''appareil avant de couler à 70 g par cylindre"]},
  {"ordre":3,"nom":"Cuisson douce","duree_estimee_min":45,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four vapeur 95 °C (ou bain-marie à 100 °C) 40-45 min",
     "Le coeur doit trembler comme un flan : 65 °C à coeur, pas plus",
     "Toute coloration = four trop chaud, appareil qui gonfle puis retombe"]},
  {"ordre":4,"nom":"Refroidissement et surgélation","duree_estimee_min":240,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "1 h à température ambiante, puis surgélation -18 °C à coeur",
     "Démouler SURGELÉ : bords nets, aucun arrachage"]},
  {"ordre":5,"nom":"Finition Lotus","duree_estimee_min":15,"est_bloquante":false,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pâte de spéculoos tiédie à 30 °C, coulée en disque sur le dessus",
     "Brisures de spéculoos en couronne au moment de la vente",
     "Décongélation contrôlée 4 h à +4 °C avant mise en vitrine"]}
]'::jsonb,
instructions = 'Rendement : 12 pièces de 110 g (plaque à cylindres individuels).

Conservation : 3 jours à +4 °C après décongélation. 1 mois à -18 °C avant finition.

Allergènes : gluten (spéculoos), lait (crème cheese, beurre, crème), œufs.

Les 4 parfums (citron, framboise, Lotus, Oreo) partagent le même fond et le même appareil ; seul le topping change.',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000126';

-- Trompe-l'oeil framboise (vaut pour les 4 fruits).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Insert framboise","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pocher la mousse framboise en petites demi-sphères (20 g)",
     "Surgélation -18 °C à coeur : l''insert doit se manipuler comme un palet",
     "Un insert mou déforme la coque au montage"]},
  {"ordre":2,"nom":"Montage à l''envers","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ganache montée souple (bec d''oiseau), pochée aux 2/3 des demi-sphères Ø7",
     "Enfoncer l''insert SURGELÉ au centre, chasser l''air, lisser à ras",
     "Coller les demi-sphères deux à deux, lisser la jointure au doigt tiède"]},
  {"ordre":3,"nom":"Surgélation","duree_estimee_min":240,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "-18 °C à coeur avant démoulage : la sphère doit sonner plein",
     "Démouler et remettre 10 min au froid avant le velours"]},
  {"ordre":4,"nom":"Velours au pistolet","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Appareil velours à 40-45 °C, pièce à -18 °C : le choc thermique fait le grain",
     "Pistolet à 25-30 cm, passes croisées courtes",
     "Trop près = coulures, pièce trop chaude = aspect mouillé"]},
  {"ordre":5,"nom":"Finition et décongélation","duree_estimee_min":240,"est_bloquante":false,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Poser sur le socle streusel, pédoncule en chocolat, pointe de nappage",
     "Décongélation contrôlée 4 h à +4 °C AVANT la vitrine — jamais à l''ambiante"]}
]'::jsonb,
instructions = 'Rendement : 12 fruits de ~106 g (24 demi-sphères Ø7 assemblées).

Conservation : 48 h à +4 °C après décongélation. 2 mois à -18 °C avant velours.

Allergènes : lait, fruits à coque (amande du streusel), soja (lécithine).

Même gamme opératoire pour citron, coco et mangue : seul l''insert change.',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000153';

-- Royal chocolat.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Dacquoise et croustillant","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dacquoise cuite 180 °C, détaillée en coeurs LÉGÈREMENT plus petits que le moule",
     "Croustillant étalé fin (3 mm) sur la dacquoise encore tiède",
     "Bloquer au froid : le croustillant doit casser net"]},
  {"ordre":2,"nom":"Mousse au chocolat","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Chocolat fondu à 45-50 °C, crème montée mousseuse (pas ferme)",
     "Incorporer en 3 fois, mousse utilisée IMMÉDIATEMENT avant qu''elle fige"]},
  {"ordre":3,"nom":"Montage à l''envers","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mousse pochée aux 3/4 des moules coeurs, remonter les bords à la spatule",
     "Enfoncer le socle dacquoise-croustillant, croustillant côté mousse",
     "Lisser à ras du moule"]},
  {"ordre":4,"nom":"Surgélation et glaçage","duree_estimee_min":260,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Surgélation -18 °C à coeur avant démoulage",
     "Glaçage miroir chinoisé, coulé à 32-35 °C sur pièces à -18 °C posées sur grille",
     "Un seul passage — retoucher rend le glaçage mat",
     "Voile de cacao au tamis, décongélation 4 h à +4 °C"]}
]'::jsonb,
instructions = 'Rendement : 8 coeurs de 110 g (plaque à coeurs individuels).

Conservation : 3 jours à +4 °C. 2 mois à -18 °C avant glaçage.

Montage (de bas en haut) : dacquoise noisette › croustillant praliné › mousse chocolat noir › glaçage miroir cacao.

Allergènes : gluten (feuilletine), lait, œufs, fruits à coque (noisette, amande), soja.',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000144';

-- Ôfauria (signature maison).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Insert caramel","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Caramel tendre coulé en empreintes de 15 g, surgélation -18 °C",
     "L''insert doit rester souple à la dégustation : ne pas recuire le caramel"]},
  {"ordre":2,"nom":"Montage des dômes spirale","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mousse chocolat pochée aux 2/3, remonter la spirale du moule à la spatule",
     "Insert caramel surgelé au centre, socle dacquoise + croustillant en fermeture",
     "Lisser à ras : le socle affleure le bord du moule"]},
  {"ordre":3,"nom":"Surgélation","duree_estimee_min":240,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":["-18 °C à coeur : la spirale démoule nette ou pas du tout"]},
  {"ordre":4,"nom":"Glaçage et finition","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Glaçage miroir à 32-35 °C sur dômes à -18 °C, un seul geste",
     "La spirale doit rester lisible sous le glaçage : couche fine",
     "Décongélation contrôlée 4 h à +4 °C avant vitrine"]}
]'::jsonb,
instructions = 'Rendement : 6 dômes spirale de 120 g. Pièce signature de la maison.

Conservation : 3 jours à +4 °C. 2 mois à -18 °C avant glaçage.

Montage (de bas en haut) : dacquoise noisette › croustillant praliné › mousse chocolat noir + coeur caramel tendre › glaçage miroir.

Allergènes : gluten, lait, œufs, fruits à coque, soja.',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000136';

-- Ô Vanilla.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Insert caramel et socle streusel","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Caramel tendre en empreintes de 7 g, surgélation",
     "Streusel cuit 160 °C, détaillé en disques Ø6 à chaud"]},
  {"ordre":2,"nom":"Bavaroise et montage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Bavaroise vanille utilisée à 28-30 °C, avant gélification",
     "Demi-sphères aux 2/3, insert caramel surgelé, fermer à la ganache montée",
     "Socle streusel posé en fermeture, surgélation -18 °C à coeur"]},
  {"ordre":3,"nom":"Velours ivoire","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Appareil velours 40-45 °C au pistolet sur pièces à -18 °C",
     "Pointe de vanille en poudre sur le sommet, décongélation 4 h à +4 °C"]}
]'::jsonb,
instructions = 'Rendement : 24 demi-sphères de 81 g.

Conservation : 3 jours à +4 °C. 2 mois à -18 °C avant velours.

Allergènes : gluten (streusel), lait, œufs, fruits à coque (amande), soja.',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000159';

-- Forêt noire (entremets entier O20).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Génoise cacao","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Génoise cuite en cercle Ø20, refroidie sur grille",
     "Trancher en 3 disques réguliers à la lyre — épaisseurs identiques"]},
  {"ordre":2,"nom":"Montage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Chaque disque imbibé au sirop TIÈDE (30-35 °C), au pinceau, généreusement",
     "Chantilly ferme, amarena égouttées 30 min sur grille (le sirop tache la crème)",
     "Ordre : génoise › chantilly + amarena › génoise › ganache › génoise › masquage"]},
  {"ordre":3,"nom":"Masquage et copeaux","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Masquage chantilly à la spatule, lissé au cercle chaud",
     "Copeaux de chocolat au couteau d''office sur bloc tempéré, appliqués à la main froide",
     "Amarena et rosaces en couronne, 2 h de repos au froid avant découpe"]}
]'::jsonb,
instructions = 'Rendement : 1 entremets Ø20 x 6 cm de ~1,8 kg, 10 parts.

Conservation : 48 h à +4 °C — la chantilly ne supporte pas plus.

Allergènes : gluten, lait, œufs, soja (lécithine du chocolat).',
updated_at = NOW()
WHERE id = 'fab28600-0000-4000-8000-000000000131';
