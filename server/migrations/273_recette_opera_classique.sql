-- Migration 273 : Recette Opera classique — 5 preparations de base + 3 formats
--
-- POURQUOI
--   Injection de la fiche technique de l'opera fournie par le chef (3 fichiers :
--   composition des sous-recettes, rendements/pertes, nomenclature par format).
--   C'est la premiere recette montee de bout en bout sur le referentiel
--   contenants de la mig 272 : elle sert de modele pour les suivantes.
--
--   Structure produite :
--     Opera classique (mode_cout = compose)
--       ├── format Cadre opera 60x40x3 cm    -> 70 pieces  (par defaut)
--       ├── format Cadre demi 40x30x4,5 cm   -> 32 pieces
--       └── format Cadre bande 60x15x4,5 cm  -> 18 pieces
--     chaque format portant 5 composants : biscuit, imbibage, 2 garnitures, glacage.
--
-- ─── DECISION : ECRASEMENT DE DEUX FICHES EXISTANTES ───
--   « Biscuit Joconde » et « Ganache chocolat noir » existaient deja avec une
--   AUTRE formule. Sur decision du chef, leur composition est remplacee par
--   celle du fichier. Consequence assumee : « Opera noisette » et
--   « Tarte chocolat », qui les consomment, voient leur cout de revient changer
--   — non pas parce que le prix matiere bouge, mais parce que le RENDEMENT des
--   deux bases change (2110 g -> 1300 g cru et 1726 g -> 1200 g cru), donc la
--   fraction de fournee consommee par ces produits augmente.
--
--   Valeurs remplacees (pour rollback) :
--     Biscuit Joconde        yield 2.11 kg, perte 0 %
--       Amande poudre 458 g, Blancs d'oeufs 367 g, Farine Fleur 120 g,
--       Oeufs entiers 612 g, Sucre semoule 458 g, Sucre semoule 80 g,
--       Trimoline 15 g
--     Ganache chocolat noir  yield 1.73 kg, perte 0 %
--       Beurre 300 g, Chocolat 50% 480 g, Creme fraiche 852 g,
--       Gelatine en feuille 8 g, Trimoline 86 g
--
-- ─── CONVENTION RENDEMENT ───
--   yield_quantity = poids CRU (avant transformation), perte_standard_pct = la
--   perte de transformation. Le net sort du calcul : v_recipe_total_cost divise
--   par `yield_quantity * (1 - perte_standard_pct/100)`. Poser le net dans
--   yield_quantity ET la perte compterait la perte deux fois.
--     Biscuit Joconde      1300 g - 15 % = 1105 g
--     Sirop imbibage cafe  1000 g -  5 % =  950 g
--     Ganache choc. noir   1200 g -  2 % = 1176 g
--     Creme au beurre cafe  970 g -  1 % =  960 g
--     Pate a glacer opera   500 g -  0 % =  500 g
--
-- ─── HYPOTHESE A VALIDER : densite de l'extrait de cafe ───
--   « Extrait de cafe liquide » est stocke en LITRES sans densite. Les lignes de
--   recette etant en grammes, fn_unit_conv(g -> l) retombe sur son facteur
--   neutre 1 : 50 g seraient coutes comme 50 L, soit 14 583 DH au lieu de ~15 DH.
--   On pose donc densite_kg_l = 1.000 (approximation standard du module, cf.
--   mig 266). Un extrait de cafe reel titre plutot 1,05-1,15 kg/l : si le chef
--   corrige la densite, l'ecart est de l'ordre de 1,5 DH sur la fournee de sirop.
--   Seules les fiches dont une ligne melange poids et volume sont concernees.
--
-- PORTEE
--   + 1 UPDATE ingredients (densite)
--   + 2 recettes existantes reecrites (yield, perte, ingredients)
--   + 4 recettes creees (3 bases + Opera classique) a UUID fixes
--   + 3 recipe_formats, 15 recipe_format_components, 5 recipe_components (miroir)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID fixes, DELETE+INSERT sur
--   les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id IN ('0be7a000-0000-4000-8000-000000000001',
--     '0be7a000-0000-4000-8000-000000000002', '0be7a000-0000-4000-8000-000000000003',
--     '0be7a000-0000-4000-8000-000000000004');   -- cascade formats + composants
--   UPDATE ingredients SET densite_kg_l = NULL WHERE name = 'Extrait de café liquide';
--   + restaurer les 2 fiches depuis les valeurs listees plus haut.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Resolution des ingredients AVANT toute modification.
--    Le referentiel contient des doublons ("Beurre" x3, "Sucre semoule" x2) :
--    on retient a chaque fois celui qui est reellement utilise par les recettes
--    existantes. Le calcul se fait ici, en tete, car les DELETE de l'etape 2
--    feraient bouger les compteurs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _opera_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande poudre', 'Sucre glace', 'Farine Fleur', 'Oeufs entiers liquides',
  'Blancs d''œufs liquides pasteurisés', 'Sucre semoule', 'Beurre', 'Eau',
  'Extrait de café liquide', 'Crème fraîche', 'Chocolat de couverture Noir 55%',
  'Oeufs Jaune', 'GLAÇAGE CHOCOLAT'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

-- Garde-fou : si un ingredient manque, on echoue ici plutot que d'inserer une
-- recette amputee dont le cout serait silencieusement faux.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _opera_ing;
  IF n <> 13 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 13 attendus', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Densite de l'extrait de cafe (voir hypothese en tete).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ingredients
   SET densite_kg_l = 1.000
 WHERE name = 'Extrait de café liquide' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Preparations de base : les 2 reecrites + les 3 creees.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct)
VALUES
  ('0be7a000-0000-4000-8000-000000000002', 'Sirop imbibage café',  true, 'ratio_poids', 1000, 'g', 5),
  ('0be7a000-0000-4000-8000-000000000003', 'Crème au beurre café', true, 'ratio_poids',  970, 'g', 1),
  ('0be7a000-0000-4000-8000-000000000004', 'Pâte à glacer opéra',  true, 'ratio_poids',  500, 'g', 0)
ON CONFLICT (id) DO NOTHING;

-- Rendements des 2 fiches reecrites (poids cru + perte de transformation).
UPDATE recipes SET yield_quantity = 1300, yield_unit = 'g', perte_standard_pct = 15, updated_at = NOW()
 WHERE name = 'Biscuit Joconde';
UPDATE recipes SET yield_quantity = 1200, yield_unit = 'g', perte_standard_pct = 2, updated_at = NOW()
 WHERE name = 'Ganache chocolat noir';

-- Compositions : on repart de zero sur les 5 fiches pour que le contenu soit
-- exactement celui du fichier (et que la migration soit rejouable).
DELETE FROM recipe_ingredients
 WHERE recipe_id IN (
   SELECT id FROM recipes
    WHERE name IN ('Biscuit Joconde', 'Ganache chocolat noir',
                   'Sirop imbibage café', 'Crème au beurre café', 'Pâte à glacer opéra')
 );

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT r.id, ing.id, v.qte, 'g'
FROM (VALUES
  -- Biscuit Joconde — 1300 g cru, 15 % de perte a la cuisson
  ('Biscuit Joconde',       'Amande poudre',                      250::numeric),
  ('Biscuit Joconde',       'Sucre glace',                        250),
  ('Biscuit Joconde',       'Farine Fleur',                        75),
  ('Biscuit Joconde',       'Oeufs entiers liquides',             350),
  ('Biscuit Joconde',       'Blancs d''œufs liquides pasteurisés', 230),
  ('Biscuit Joconde',       'Sucre semoule',                       80),
  ('Biscuit Joconde',       'Beurre',                              65),
  -- Sirop imbibage cafe — 1000 g cru, 5 % a l'ebullition
  ('Sirop imbibage café',   'Eau',                                500),
  ('Sirop imbibage café',   'Sucre semoule',                      450),
  ('Sirop imbibage café',   'Extrait de café liquide',             50),
  -- Ganache chocolat noir — 1200 g cru, 2 % a l'emulsion
  ('Ganache chocolat noir', 'Crème fraîche',                      600),
  ('Ganache chocolat noir', 'Chocolat de couverture Noir 55%',    500),
  ('Ganache chocolat noir', 'Beurre',                             100),
  -- Creme au beurre cafe — 970 g cru, 1 % a l'emulsion
  ('Crème au beurre café',  'Sucre semoule',                      250),
  ('Crème au beurre café',  'Eau',                                 80),
  ('Crème au beurre café',  'Oeufs Jaune',                        120),
  ('Crème au beurre café',  'Beurre',                             500),
  ('Crème au beurre café',  'Extrait de café liquide',             20),
  -- Pate a glacer opera — 500 g, pas de perte a la fonte
  ('Pâte à glacer opéra',   'GLAÇAGE CHOCOLAT',                   500)
) AS v (recette, ingredient, qte)
JOIN recipes r    ON r.name = v.recette
JOIN _opera_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Opera classique : recette composee (le cout vient de la nomenclature
--    par format, pas d'ingredients propres).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct)
VALUES ('0be7a000-0000-4000-8000-000000000001', 'Opéra classique', false, 'compose', 70, 'unit', 0)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 3 formats. nb_par_defaut = pieces theoriques du cadre (mig 272) :
--    c'est ce qui rapporte le cout du cadre entier a une piece vendable.
--    quantite_par_format = poids de nomenclature / nb de pieces.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre)
SELECT v.id, '0be7a000-0000-4000-8000-000000000001', c.id, v.qte_par_format, 'g',
       v.nb_par_defaut, v.is_default, v.ordre
FROM (VALUES
  ('0be7a000-0000-4000-8000-0000000000f1'::uuid, 'Cadre opéra 60x40x3 cm',    82.86::numeric, 70, true,  1),
  ('0be7a000-0000-4000-8000-0000000000f2',       'Cadre demi 40x30x4,5 cm',   90.63,          32, false, 2),
  ('0be7a000-0000-4000-8000-0000000000f3',       'Cadre bande 60x15x4,5 cm', 120.83,          18, false, 3)
) AS v (id, contenant, qte_par_format, nb_par_defaut, is_default, ordre)
JOIN production_contenants c ON c.nom = v.contenant
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Nomenclature par format (5 lignes x 3 formats).
--    Les perte_pct sont celles du fichier : perte de mise en oeuvre a
--    l'assemblage, distincte de la perte de transformation de la sous-recette.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id IN ('0be7a000-0000-4000-8000-0000000000f1',
                     '0be7a000-0000-4000-8000-0000000000f2',
                     '0be7a000-0000-4000-8000-0000000000f3');

INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, v.role, r.id, v.qte, 'g', v.perte, v.ordre
FROM (VALUES
  -- Cadre opera 60x40x3 cm — 5800 g pour 70 pieces
  ('0be7a000-0000-4000-8000-0000000000f1'::uuid, 'biscuit',   'Biscuit Joconde',       1200::numeric, 0::numeric, 1::smallint),
  ('0be7a000-0000-4000-8000-0000000000f1', 'imbibage',  'Sirop imbibage café',   1000, 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', 'Crème au beurre café',  1500, 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', 'Ganache chocolat noir', 1200, 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f1', 'glacage',   'Pâte à glacer opéra',    900, 5, 5),
  -- Cadre demi 40x30x4,5 cm — 2900 g pour 32 pieces
  ('0be7a000-0000-4000-8000-0000000000f2', 'biscuit',   'Biscuit Joconde',        600, 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f2', 'imbibage',  'Sirop imbibage café',    500, 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', 'Crème au beurre café',   750, 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', 'Ganache chocolat noir',  600, 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f2', 'glacage',   'Pâte à glacer opéra',    450, 5, 5),
  -- Cadre bande 60x15x4,5 cm — 2175 g pour 18 pieces
  ('0be7a000-0000-4000-8000-0000000000f3', 'biscuit',   'Biscuit Joconde',        450, 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f3', 'imbibage',  'Sirop imbibage café',    375, 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', 'Crème au beurre café',   563, 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', 'Ganache chocolat noir',  450, 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f3', 'glacage',   'Pâte à glacer opéra',    337, 5, 5)
) AS v (format_id, role, source, qte, perte, ordre)
JOIN recipes r ON r.name = v.source;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost, lue partout, passe par ce miroir pour les recettes
--    composees : sans lui, l'Opera classique couterait 0 pour tout parent.
--    Le service resynchronise ensuite ce miroir a chaque sauvegarde.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components WHERE recipe_id = '0be7a000-0000-4000-8000-000000000001';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT '0be7a000-0000-4000-8000-000000000001', c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
WHERE c.format_id = '0be7a000-0000-4000-8000-0000000000f1';
