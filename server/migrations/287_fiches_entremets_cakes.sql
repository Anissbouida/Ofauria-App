-- Migration 287 : Fiches techniques ENTREMETS + CAKES/MUFFINS + COOKIES + SACHETS
--
-- POURQUOI
--   Injection des fiches du chef entremetier pour 71 produits vendus :
--     38 ENTREMETS (13 gateaux declines en parts) · 24 CAKE ET MUFFINS
--     5 GATEAUX & COOKIES · 3 SACHET MINI · 1 Divers (Tarte Myrtille)
--   Le modele est l'Opera classique (mig 273/276) : une recette « compose »
--   dont le cout vient d'une nomenclature par FORMAT, et un miroir
--   recipe_components sur le format par defaut pour v_recipe_total_cost.
--
-- ─── REGLE DE STRUCTURE : UNE RECETTE, PLUSIEURS TAILLES ───
--   Un entremets decline PRS 6/8/10/15 n'est PAS 3 recettes : c'est UNE recette
--   et 3 formats, chaque format portant le product_id de sa declinaison.
--   La nomenclature est ecrite UNE FOIS pour une reference de 1 000 g net
--   (le PRS 8, cercle O20), puis mise a l'echelle par le facteur du cercle :
--     Cercle O14 x 4,5  ->  480 g   (PRS 4)   facteur 0,48
--     Cercle O16 x 4,5  ->  720 g   (PRS 6)   facteur 0,72
--     Cercle O20 x 4,5  -> 1000 g   (PRS 8)   facteur 1,00   <- reference
--     Cercle O22 x 4,5  -> 1250 g   (PRS 10)  facteur 1,25
--     Cadre demi 40x30  -> 1875 g   (PRS 15)  facteur 1,875
--   Soit ~120-125 g par part, conforme a l'usage maison. Le facteur d'echelle
--   garantit mecaniquement l'egalite « somme des composants = nb x poids piece ».
--
-- ─── CAS PARTICULIER : OPERA PRS 6/8/10 ───
--   L'Opera classique existe deja (mig 273/276) avec ses 3 formats CADRE, qui
--   ne sont PAS touches. On lui ajoute 3 formats CERCLE portant les product_id
--   des declinaisons vendues au detail, is_default = false. Leur nomenclature
--   est celle de la masterclass ramenee au kilo :
--     joconde 335 · chablonnage 14 · sirop 191 · creme beurre 193 ·
--     ganache 144 · glacage 123  = 1 000 g
--
-- ─── PRODUITS = FORMATS, PAS RECETTES ───
--   Cakes et petits gateaux : la PATE est la base (pate a cake nature, citron,
--   chocolat, appareils muffin/madeleine/financier/brownie/tigre, pate a
--   cookies) ; le PRODUIT est un format = un moule ou une plaque avec son
--   grammage. Les tranches 100 g et les sachets sont des formats sans
--   contenant (contenant_id NULL) de la meme recette : c'est le meme appareil,
--   conditionne autrement.
--
-- ─── ECARTS DE COUT ASSUMES (a valider par le chef) ───
--   Trois fiches sortent par le BAS du couloir 20-40 % :
--     FRAISIER PRS       11,3 % — la fraise est a 15 DH/kg au referentiel
--     GATEAUX AUX FRUITS 12,3 % — idem, fruits frais bon marche a Casablanca
--     Cake design        11,1 % — prix de commande (750 DH), assume par le brief
--   Ce ne sont pas des erreurs de pesee : ces produits ont une marge matiere
--   tres large, leur prix paie la main d'oeuvre et le decor.
--
-- PORTEE
--   + 3 ingredients crees (prix a valider)
--   + 13 preparations de base (bloc 01xx). Cinq preparations attendues ici
--     (mousseline vanille, glacage rocher, mousse pralinee, mousse caramel)
--     appartiennent deja aux mig 285/286 : on les reference, on ne les double pas.
--   + 36 fiches produit « compose » (bloc 01xx)
--   + 71 recipe_formats (bloc 02xx), dont 3 greffes sur l'Opera existant
--   + les recipe_format_components et le miroir recipe_components
--   Idempotent : ON CONFLICT DO NOTHING sur UUID fixes, DELETE+INSERT sur
--   toutes les compositions.
--
-- INVERSION
--   DELETE FROM recipe_formats WHERE id::text LIKE 'fab28700%';
--   DELETE FROM recipes        WHERE id::text LIKE 'fab28700%';  -- cascade
--   (les 3 formats Opera sont dans le meme bloc 02xx, donc couverts)

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
--   La passe est rejouée avant chaque résolution par nom qui suit la création
--   des bases propres à la migration (leurs homonymes ne peuvent être repérés
--   qu'une fois ces bases en table).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.archiver_homonymes_catalogue(p_ctx TEXT)
RETURNS void LANGUAGE plpgsql AS $$
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
    RAISE NOTICE 'Mig % : homonymes de bases du catalogue archivés -> %', p_ctx, z;
  END IF;
END $$;

SELECT pg_temp.archiver_homonymes_catalogue('287 préambule');

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingredients manquants au referentiel.
--    « Pate de pistache » y figure deja mais a un unit_cost de 0 : la garder
--    ferait un cout silencieusement faux, on cree donc une fiche nommee.
--    « Myrtille » n'existe qu'en unite « unit » (barquette), inutilisable dans
--    une pesee en grammes : on cree la version surgelee au kilo.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Pâte de pistache 100%', 'kg', 350.00, 'pates_riz'   -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name) = lower('Pâte de pistache 100%'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Myrtille surgelée', 'kg', 120.00, 'fruits'          -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name) = lower('Myrtille surgelée'));

INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT 'Pâte à sucre blanche', 'kg', 55.00, 'decors'        -- PRIX À VALIDER
WHERE NOT EXISTS (SELECT 1 FROM ingredients WHERE lower(name) = lower('Pâte à sucre blanche'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Resolution des ingredients AVANT toute ecriture (pattern mig 273).
--    Le referentiel contient des doublons (« Beurre » x3, « Sucre semoule » x2,
--    « Lait » x2...) : on retient celui qui est reellement utilise par les
--    recettes existantes, puis le plus ancien.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _ing287;
CREATE TEMP TABLE _ing287 ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id, i.unit_cost
FROM ingredients i
WHERE i.name IN (
  'Amande concassée', 'Amande effilée', 'Amande poudre', 'Amarena au sirop lourd',
  'Beurre', 'Blancs d''œufs liquides pasteurisés', 'Cacao en poudre 10/12',
  'Chocolat Blanc 30%', 'Chocolat de couverture Lait 33%',
  'Chocolat de couverture Noir 55%', 'Citron', 'Crème fraîche', 'Farine Fleur',
  'Fraise', 'Gouttes drops 50% DGF', 'Gélatine en feuille', 'Huile de table',
  'Kiwi', 'Lait', 'Levure chimique', 'Myrtille surgelée', 'NOISETTE EN GRAINS',
  'Nappage neutre', 'Noix décortiquées', 'Oeufs Jaune', 'Oeufs entiers liquides',
  'Pistache décortiquée', 'Praliné amande 50%', 'Praliné noisette 50%',
  'Purée framboises', 'Pâte d''amande 50%', 'Pâte de pistache 100%',
  'Pâte à sucre blanche', 'SUCRE CASSONADE', 'Sel de table fin',
  'Sirop de glucose', 'Sucre glace', 'Sucre grain CAL 10', 'Sucre semoule',
  'Trimoline sucre inverti', 'Vanille poudre'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT; z TEXT;
BEGIN
  SELECT count(*) INTO n FROM _ing287;
  IF n <> 41 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 41 attendus', n;
  END IF;
  -- Un prix a 0 produirait un cout de revient silencieusement faux : on echoue.
  SELECT string_agg(name, ', ') INTO z FROM _ing287
   WHERE unit_cost IS NULL OR unit_cost <= 0;
  IF z IS NOT NULL THEN
    RAISE EXCEPTION 'Ingredients sans prix : %', z;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Resolution des BASES TRANSVERSALES deja en base (mig 273/276/280).
--    On ne les recree jamais : on les reference par nom. Le filtre
--    archived_at IS NULL ecarte les vieilles fiches homonymes archivees
--    (« Creme patissiere » existe en double, dont une archivee).
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _base287;
CREATE TEMP TABLE _base287 ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.archived_at IS NULL
  AND r.is_base
  AND r.name IN (
  -- mig 273/276/280
  'Biscuit Joconde', 'Biscuit cuillère', 'Caramel tendre',
  'Croustillant praliné feuilletine', 'Crème au beurre café',
  'Crème d''amande', 'Crème diplomate', 'Crème pâtissière', 'Dacquoise noisette',
  'Ganache chocolat au lait', 'Ganache chocolat noir', 'Ganache montée ivoire',
  'Glaçage miroir cacao', 'Glaçage opéra', 'Génoise cacao', 'Génoise nature',
  'Meringue française', 'Mousse au chocolat noir', 'Pâte sucrée',
  'Sirop imbibage café', 'Sirop à 30°B',
  -- mig 285 : deja ecrites par la famille patisserie classique, on ne les
  -- redouble pas (une mousseline vanille et un glacage rocher suffisent)
  'Crème mousseline vanille', 'Glaçage rocher',
  -- mig 286 : famille patisserie premium
  'Mousse pralinée', 'Mousse caramel'
)
ORDER BY r.name, r.created_at;

DO $$
DECLARE n INT; z TEXT;
BEGIN
  SELECT count(*) INTO n FROM _base287;
  IF n <> 25 THEN
    SELECT string_agg(v.n, ', ') INTO z FROM (VALUES
      ('Biscuit Joconde'),('Biscuit cuillère'),('Caramel tendre'),
      ('Croustillant praliné feuilletine'),('Crème au beurre café'),
      ('Crème d''amande'),('Crème diplomate'),('Crème pâtissière'),
      ('Dacquoise noisette'),('Ganache chocolat au lait'),('Ganache chocolat noir'),
      ('Ganache montée ivoire'),('Glaçage miroir cacao'),('Glaçage opéra'),
      ('Génoise cacao'),('Génoise nature'),('Meringue française'),
      ('Mousse au chocolat noir'),('Pâte sucrée'),('Sirop imbibage café'),
      ('Sirop à 30°B'),('Crème mousseline vanille'),('Glaçage rocher'),
      ('Mousse pralinée'),('Mousse caramel')
    ) AS v(n) WHERE NOT EXISTS (SELECT 1 FROM _base287 b WHERE b.name = v.n);
    RAISE EXCEPTION 'Bases introuvables (% sur 25) : %', n, z;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Preparations de base propres a cette famille (bloc 01xx, 101-118).
--    yield_quantity = PESEE CRUE, perte_standard_pct = perte de transformation.
--    Le net sort du calcul : yield x (1 - perte/100).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production')
FROM (VALUES
  ('fab28700-0000-4000-8000-000000000101'::uuid, 'Dacquoise amande',              1150::numeric, 15::numeric),
  -- 102/104/105/107/108 volontairement absents : « Creme mousseline vanille » et
  -- « Glacage rocher » viennent de la mig 285, « Mousse pralinee » et
  -- « Mousse caramel » de la mig 286. Les redoubler creerait deux fiches
  -- homonymes et un stock de semi-fini fantome.
  ('fab28700-0000-4000-8000-000000000103', 'Mousse au chocolat au lait',          2000,  3),
  ('fab28700-0000-4000-8000-000000000106', 'Compotée de fruits rouges',           1200, 12),
  ('fab28700-0000-4000-8000-000000000109', 'Pâte à cake nature',                  2000, 10),
  ('fab28700-0000-4000-8000-000000000110', 'Pâte à cake citron',                  2000, 10),
  ('fab28700-0000-4000-8000-000000000111', 'Pâte à cake chocolat',                2100, 10),
  ('fab28700-0000-4000-8000-000000000112', 'Appareil à muffin vanille',           2000, 10),
  ('fab28700-0000-4000-8000-000000000113', 'Appareil à muffin chocolat',          2100, 10),
  ('fab28700-0000-4000-8000-000000000114', 'Appareil à madeleine',                2000,  8),
  ('fab28700-0000-4000-8000-000000000115', 'Appareil à financier',                1800, 10),
  ('fab28700-0000-4000-8000-000000000116', 'Appareil à brownie',                  2000,  8),
  ('fab28700-0000-4000-8000-000000000117', 'Appareil à tigré',                    1800, 10),
  ('fab28700-0000-4000-8000-000000000118', 'Pâte à cookies',                      2000,  8)
) AS v (id, nom, yield, perte)
ON CONFLICT (id) DO NOTHING;

-- Compositions des bases : DELETE + INSERT pour etre rejouable.
DELETE FROM recipe_ingredients
 WHERE recipe_id::text LIKE 'fab28700-0000-4000-8000-0000000001%';
DELETE FROM recipe_sub_recipes
 WHERE recipe_id::text LIKE 'fab28700-0000-4000-8000-0000000001%';

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid, ing.id, v.qte, 'g'
FROM (VALUES
  -- 101 Dacquoise amande — 1150 g cru, 15 % a la cuisson
  ('fab28700-0000-4000-8000-000000000101'::uuid, 'Blancs d''œufs liquides pasteurisés', 400::numeric),
  ('fab28700-0000-4000-8000-000000000101', 'Sucre semoule',                      130),
  ('fab28700-0000-4000-8000-000000000101', 'Amande poudre',                      320),
  ('fab28700-0000-4000-8000-000000000101', 'Sucre glace',                        280),
  ('fab28700-0000-4000-8000-000000000101', 'Farine Fleur',                        20),
  -- 103 Mousse au chocolat au lait — anglaise + couverture lait + creme montee
  ('fab28700-0000-4000-8000-000000000103', 'Lait',                               250),
  ('fab28700-0000-4000-8000-000000000103', 'Oeufs Jaune',                        120),
  ('fab28700-0000-4000-8000-000000000103', 'Sucre semoule',                       80),
  ('fab28700-0000-4000-8000-000000000103', 'Gélatine en feuille',                 10),
  ('fab28700-0000-4000-8000-000000000103', 'Chocolat de couverture Lait 33%',    550),
  ('fab28700-0000-4000-8000-000000000103', 'Crème fraîche',                      990),
  -- 106 Compotee de fruits rouges — 12 % d'evaporation a la cuisson
  ('fab28700-0000-4000-8000-000000000106', 'Purée framboises',                   600),
  ('fab28700-0000-4000-8000-000000000106', 'Fraise',                             350),
  ('fab28700-0000-4000-8000-000000000106', 'Sucre semoule',                      220),
  ('fab28700-0000-4000-8000-000000000106', 'Sirop de glucose',                    25),
  ('fab28700-0000-4000-8000-000000000106', 'Gélatine en feuille',                  5),
  -- 109 Pate a cake nature (quatre-quarts allege au lait) — 10 % a la cuisson
  ('fab28700-0000-4000-8000-000000000109', 'Beurre',                             440),
  ('fab28700-0000-4000-8000-000000000109', 'Sucre semoule',                      500),
  ('fab28700-0000-4000-8000-000000000109', 'Oeufs entiers liquides',             460),
  ('fab28700-0000-4000-8000-000000000109', 'Farine Fleur',                       480),
  ('fab28700-0000-4000-8000-000000000109', 'Levure chimique',                     14),
  ('fab28700-0000-4000-8000-000000000109', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000109', 'Lait',                                96),
  ('fab28700-0000-4000-8000-000000000109', 'Vanille poudre',                       6),
  -- 110 Pate a cake citron
  ('fab28700-0000-4000-8000-000000000110', 'Beurre',                             440),
  ('fab28700-0000-4000-8000-000000000110', 'Sucre semoule',                      500),
  ('fab28700-0000-4000-8000-000000000110', 'Oeufs entiers liquides',             460),
  ('fab28700-0000-4000-8000-000000000110', 'Farine Fleur',                       440),
  ('fab28700-0000-4000-8000-000000000110', 'Levure chimique',                     12),
  ('fab28700-0000-4000-8000-000000000110', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000110', 'Citron',                             140),
  ('fab28700-0000-4000-8000-000000000110', 'Vanille poudre',                       4),
  -- 111 Pate a cake chocolat — cacao + pepites, pas de couverture (trop chere
  --     pour la tranche a 5,50 DH qui sort de cette pate)
  ('fab28700-0000-4000-8000-000000000111', 'Beurre',                             400),
  ('fab28700-0000-4000-8000-000000000111', 'Sucre semoule',                      520),
  ('fab28700-0000-4000-8000-000000000111', 'Oeufs entiers liquides',             440),
  ('fab28700-0000-4000-8000-000000000111', 'Farine Fleur',                       420),
  ('fab28700-0000-4000-8000-000000000111', 'Cacao en poudre 10/12',              110),
  ('fab28700-0000-4000-8000-000000000111', 'Levure chimique',                     14),
  ('fab28700-0000-4000-8000-000000000111', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000111', 'Lait',                               120),
  ('fab28700-0000-4000-8000-000000000111', 'Gouttes drops 50% DGF',               72),
  -- 112 Appareil a muffin vanille (au beurre, pas a l'huile : tenue en vitrine)
  ('fab28700-0000-4000-8000-000000000112', 'Farine Fleur',                       560),
  ('fab28700-0000-4000-8000-000000000112', 'Sucre semoule',                      420),
  ('fab28700-0000-4000-8000-000000000112', 'Oeufs entiers liquides',             340),
  ('fab28700-0000-4000-8000-000000000112', 'Lait',                               340),
  ('fab28700-0000-4000-8000-000000000112', 'Beurre',                             260),
  ('fab28700-0000-4000-8000-000000000112', 'Levure chimique',                     24),
  ('fab28700-0000-4000-8000-000000000112', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000112', 'Vanille poudre',                       8),
  ('fab28700-0000-4000-8000-000000000112', 'Crème fraîche',                       44),
  -- 113 Appareil a muffin chocolat
  ('fab28700-0000-4000-8000-000000000113', 'Farine Fleur',                       480),
  ('fab28700-0000-4000-8000-000000000113', 'Cacao en poudre 10/12',               90),
  ('fab28700-0000-4000-8000-000000000113', 'Sucre semoule',                      440),
  ('fab28700-0000-4000-8000-000000000113', 'Oeufs entiers liquides',             340),
  ('fab28700-0000-4000-8000-000000000113', 'Lait',                               320),
  ('fab28700-0000-4000-8000-000000000113', 'Beurre',                             240),
  ('fab28700-0000-4000-8000-000000000113', 'Levure chimique',                     24),
  ('fab28700-0000-4000-8000-000000000113', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000113', 'Gouttes drops 50% DGF',              162),
  -- 114 Appareil a madeleine — 26 % de beurre, trimoline pour le moelleux
  ('fab28700-0000-4000-8000-000000000114', 'Oeufs entiers liquides',             500),
  ('fab28700-0000-4000-8000-000000000114', 'Sucre semoule',                      380),
  ('fab28700-0000-4000-8000-000000000114', 'Trimoline sucre inverti',             70),
  ('fab28700-0000-4000-8000-000000000114', 'Farine Fleur',                       450),
  ('fab28700-0000-4000-8000-000000000114', 'Levure chimique',                     18),
  ('fab28700-0000-4000-8000-000000000114', 'Beurre',                             540),
  ('fab28700-0000-4000-8000-000000000114', 'Sel de table fin',                     3),
  ('fab28700-0000-4000-8000-000000000114', 'Citron',                              39),
  -- 115 Appareil a financier — beurre noisette
  ('fab28700-0000-4000-8000-000000000115', 'Blancs d''œufs liquides pasteurisés', 560),
  ('fab28700-0000-4000-8000-000000000115', 'Sucre glace',                        520),
  ('fab28700-0000-4000-8000-000000000115', 'Amande poudre',                      340),
  ('fab28700-0000-4000-8000-000000000115', 'Farine Fleur',                       180),
  ('fab28700-0000-4000-8000-000000000115', 'Beurre',                             190),
  ('fab28700-0000-4000-8000-000000000115', 'Sel de table fin',                     3),
  ('fab28700-0000-4000-8000-000000000115', 'Vanille poudre',                       7),
  -- 116 Appareil a brownie
  ('fab28700-0000-4000-8000-000000000116', 'Chocolat de couverture Noir 55%',    460),
  ('fab28700-0000-4000-8000-000000000116', 'Beurre',                             400),
  ('fab28700-0000-4000-8000-000000000116', 'Sucre semoule',                      480),
  ('fab28700-0000-4000-8000-000000000116', 'Oeufs entiers liquides',             380),
  ('fab28700-0000-4000-8000-000000000116', 'Farine Fleur',                       170),
  ('fab28700-0000-4000-8000-000000000116', 'Cacao en poudre 10/12',               30),
  ('fab28700-0000-4000-8000-000000000116', 'Sel de table fin',                     4),
  ('fab28700-0000-4000-8000-000000000116', 'Noix décortiquées',                   76),
  -- 117 Appareil a tigre — financier cacao a pepites
  ('fab28700-0000-4000-8000-000000000117', 'Blancs d''œufs liquides pasteurisés', 540),
  ('fab28700-0000-4000-8000-000000000117', 'Sucre glace',                        500),
  ('fab28700-0000-4000-8000-000000000117', 'Amande poudre',                      300),
  ('fab28700-0000-4000-8000-000000000117', 'Farine Fleur',                       150),
  ('fab28700-0000-4000-8000-000000000117', 'Cacao en poudre 10/12',               40),
  ('fab28700-0000-4000-8000-000000000117', 'Beurre',                             180),
  ('fab28700-0000-4000-8000-000000000117', 'Gouttes drops 50% DGF',               87),
  ('fab28700-0000-4000-8000-000000000117', 'Sel de table fin',                     3),
  -- 118 Pate a cookies — cassonade pour le fondant, repos 12 h au froid
  ('fab28700-0000-4000-8000-000000000118', 'Beurre',                             440),
  ('fab28700-0000-4000-8000-000000000118', 'SUCRE CASSONADE',                    300),
  ('fab28700-0000-4000-8000-000000000118', 'Sucre semoule',                      160),
  ('fab28700-0000-4000-8000-000000000118', 'Oeufs entiers liquides',             180),
  ('fab28700-0000-4000-8000-000000000118', 'Farine Fleur',                       700),
  ('fab28700-0000-4000-8000-000000000118', 'Levure chimique',                     10),
  ('fab28700-0000-4000-8000-000000000118', 'Sel de table fin',                     6),
  ('fab28700-0000-4000-8000-000000000118', 'Vanille poudre',                       4),
  ('fab28700-0000-4000-8000-000000000118', 'Lait',                               200)
) AS v (rid, ingredient, qte)
JOIN _ing287 ing ON ing.name = v.ingredient;

-- Les bases de cette migration rejoignent le repertoire de resolution : a
-- partir d'ici, _base287 resout indifferemment une base transversale et une
-- base familiale, et les nomenclatures s'ecrivent avec un seul nom de colonne.
INSERT INTO _base287 (name, id)
SELECT r.name, r.id FROM recipes r
WHERE r.id::text LIKE 'fab28700-0000-4000-8000-0000000001%' AND r.is_base;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipes
   WHERE id::text LIKE 'fab28700-0000-4000-8000-0000000001%' AND is_base;
  IF n <> 13 THEN
    RAISE EXCEPTION 'Bases 287 : % creees sur 13 attendues', n;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fiches produit « compose ». Leur cout ne vient PAS d'ingredients propres
--    mais de la nomenclature du format (etapes 5 a 8).
--
--    Les entremets portent le suffixe « PRS » (parts) : la mig 286 a deja des
--    fiches « Casablanca », « Noisette », « Pralino », « Trio », « Ôfauria »,
--    « Royal chocolat » pour les entremets vendus a la part. Ici ce sont les
--    gateaux ENTIERS vendus en 4/6/8/10/15 parts — meme parfum, autre produit,
--    autre nomenclature. Deux fiches homonymes rendraient toute resolution par
--    nom ambigue, y compris pour le planificateur de production.
--
--    yield_quantity = nb de pieces du format par defaut (1 gateau pour un
--    entremets, N pieces pour une plaque).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id)
SELECT v.id, v.nom, false, 'compose', v.yield, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'patisserie')
FROM (VALUES
  -- ENTREMETS a parts : yield = 1 gateau (le format par defaut est le PRS 8)
  ('fab28700-0000-4000-8000-000000000130'::uuid, 'Amandine PRS',                1::numeric),
  ('fab28700-0000-4000-8000-000000000131', 'Casablanca PRS',                    1),
  ('fab28700-0000-4000-8000-000000000132', 'Ferrero Rocher PRS',                1),
  ('fab28700-0000-4000-8000-000000000133', 'Feuilles d''automne PRS',           1),
  ('fab28700-0000-4000-8000-000000000134', 'Fraisier PRS',                      1),
  ('fab28700-0000-4000-8000-000000000135', 'Gâteau caramel PRS',                1),
  ('fab28700-0000-4000-8000-000000000136', 'Gâteaux aux fruits PRS',            1),
  ('fab28700-0000-4000-8000-000000000137', 'Noisette PRS',                      1),
  ('fab28700-0000-4000-8000-000000000138', 'Pralino PRS',                       1),
  ('fab28700-0000-4000-8000-000000000139', 'Royal PRS',                         1),
  ('fab28700-0000-4000-8000-000000000140', 'Trio PRS',                          1),
  ('fab28700-0000-4000-8000-000000000141', 'Ô Fauria PRS',                      1),
  -- CAKES, MUFFINS, PETITS FOURS SECS
  ('fab28700-0000-4000-8000-000000000150', 'Cake nature',                       1),
  ('fab28700-0000-4000-8000-000000000151', 'Cake citron',                       1),
  ('fab28700-0000-4000-8000-000000000153', 'Cake aux fruits secs',              1),
  ('fab28700-0000-4000-8000-000000000154', 'Cake rocher chocolat',              1),
  ('fab28700-0000-4000-8000-000000000155', 'Cake rocher framboise',             1),
  ('fab28700-0000-4000-8000-000000000156', 'Cake rocher fruits secs',           1),
  ('fab28700-0000-4000-8000-000000000157', 'Cake pistache individuel',          1),
  ('fab28700-0000-4000-8000-000000000158', 'Cake noix individuel',              1),
  ('fab28700-0000-4000-8000-000000000159', 'Brownie',                          30),
  ('fab28700-0000-4000-8000-000000000160', 'Financier',                        40),
  ('fab28700-0000-4000-8000-000000000161', 'Madeleine',                        40),
  ('fab28700-0000-4000-8000-000000000162', 'Madeleine chocolat',               40),
  ('fab28700-0000-4000-8000-000000000163', 'Madeleine citron',                 40),
  ('fab28700-0000-4000-8000-000000000164', 'Muffin vanille',                   12),
  ('fab28700-0000-4000-8000-000000000165', 'Muffin chocolat',                  12),
  ('fab28700-0000-4000-8000-000000000166', 'Mini-muffin choco-vanille',        48),
  ('fab28700-0000-4000-8000-000000000167', 'Tigré',                            15),
  ('fab28700-0000-4000-8000-000000000168', 'Tigré caramel',                    15),
  ('fab28700-0000-4000-8000-000000000169', 'Tigré pistache',                   15),
  ('fab28700-0000-4000-8000-000000000170', 'Cookie chocolat',                  20),
  ('fab28700-0000-4000-8000-000000000171', 'Cookie framboise',                 20),
  ('fab28700-0000-4000-8000-000000000172', 'Cookie pistache',                  20),
  ('fab28700-0000-4000-8000-000000000173', 'Cake design',                       1),
  ('fab28700-0000-4000-8000-000000000174', 'Tarte Myrtille',                    1)
) AS v (id, nom, yield)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FORMATS DES ENTREMETS.
--    Une seule nomenclature par gateau, ecrite pour 1 000 g net (le PRS 8), et
--    un facteur d'echelle par cercle. C'est ce facteur qui garantit
--    « somme des composants = nb_par_defaut x quantite_par_format » : les deux
--    membres sont calcules a partir du meme nombre.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _ent_fmt;
CREATE TEMP TABLE _ent_fmt (
  format_id uuid, recipe_id uuid, contenant text, scale numeric,
  product_id uuid, is_default boolean, ordre int
) ON COMMIT DROP;

INSERT INTO _ent_fmt VALUES
  -- AMANDINE
  ('fab28700-0000-4000-8000-000000000201','fab28700-0000-4000-8000-000000000130','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'3e1f8591-0b53-4c51-9900-4f7b1072ee69',false,1),
  ('fab28700-0000-4000-8000-000000000202','fab28700-0000-4000-8000-000000000130','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'0b840f57-6417-4998-b54c-a18b747056ee',true ,2),
  ('fab28700-0000-4000-8000-000000000203','fab28700-0000-4000-8000-000000000130','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'da8a5398-6f92-4a2f-a5b0-01f7fead7fbb',false,3),
  -- CASABLANCA
  ('fab28700-0000-4000-8000-000000000204','fab28700-0000-4000-8000-000000000131','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'a2a41f58-12b2-4882-b57a-ac105f115db5',false,1),
  ('fab28700-0000-4000-8000-000000000205','fab28700-0000-4000-8000-000000000131','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'f5d53d6c-da10-433a-bb3b-d1d41083f33b',true ,2),
  ('fab28700-0000-4000-8000-000000000206','fab28700-0000-4000-8000-000000000131','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'441a5c05-91f3-44cd-b3cc-9ab2e58c9a52',false,3),
  -- FERRERO ROCHER
  ('fab28700-0000-4000-8000-000000000207','fab28700-0000-4000-8000-000000000132','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'42036877-5812-4df2-b742-4d01fd2e74cf',false,1),
  ('fab28700-0000-4000-8000-000000000208','fab28700-0000-4000-8000-000000000132','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'d42ae3de-3f38-444e-bc92-4fcb1fe5544f',true ,2),
  ('fab28700-0000-4000-8000-000000000209','fab28700-0000-4000-8000-000000000132','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'e3cfb5d5-9828-412b-8fc7-5f41f3926391',false,3),
  -- FEUILLES D'AUTOMNE
  ('fab28700-0000-4000-8000-000000000210','fab28700-0000-4000-8000-000000000133','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'27f1b76e-9e24-4727-963a-d6f1140fd3d2',false,1),
  ('fab28700-0000-4000-8000-000000000211','fab28700-0000-4000-8000-000000000133','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'5bb6d888-0382-46c4-87d4-726e69961b3d',true ,2),
  ('fab28700-0000-4000-8000-000000000212','fab28700-0000-4000-8000-000000000133','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'79e46d5f-e804-4bb1-aba0-de5edf51b664',false,3),
  -- FRAISIER (une seule taille vendue, 250 DH : cercle Ø22)
  ('fab28700-0000-4000-8000-000000000213','fab28700-0000-4000-8000-000000000134','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'9922d80e-bc79-4232-b427-74b16c526922',true ,1),
  -- GATEAU CARAMEL (4 tailles, dont le PRS 15 sur cadre demi)
  ('fab28700-0000-4000-8000-000000000214','fab28700-0000-4000-8000-000000000135','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'5ec2e89a-cca5-45b6-ae10-a5585e6b5508',false,1),
  ('fab28700-0000-4000-8000-000000000215','fab28700-0000-4000-8000-000000000135','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'a136d400-76be-473a-8ded-0d825a4bbb60',true ,2),
  ('fab28700-0000-4000-8000-000000000216','fab28700-0000-4000-8000-000000000135','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'d2336d9c-6d9d-4fdb-96c2-b42b092c1c5d',false,3),
  ('fab28700-0000-4000-8000-000000000217','fab28700-0000-4000-8000-000000000135','Cadre demi 40x30x4,5 cm'        ,1.875,'d12670b3-d78a-4b6c-94fe-9f5f1ff6b034',false,4),
  -- GATEAUX AUX FRUITS (une seule taille, 220 DH : cercle Ø20)
  ('fab28700-0000-4000-8000-000000000218','fab28700-0000-4000-8000-000000000136','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'d7d9efda-a19a-48a1-9ddd-547c68dc373c',true ,1),
  -- NOISETTE (4 tailles, dont un PRS 4 sur cercle Ø14)
  ('fab28700-0000-4000-8000-000000000219','fab28700-0000-4000-8000-000000000137','Cercle à entremets Ø14 x 4,5 cm',0.48 ,'f72732b1-f872-4211-9d57-8c6598571516',false,1),
  ('fab28700-0000-4000-8000-000000000220','fab28700-0000-4000-8000-000000000137','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'0d2c2591-918d-4061-8d96-36d571f0426d',false,2),
  ('fab28700-0000-4000-8000-000000000221','fab28700-0000-4000-8000-000000000137','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'d9e18f96-2485-4290-a81d-88635ef1e0fc',true ,3),
  ('fab28700-0000-4000-8000-000000000222','fab28700-0000-4000-8000-000000000137','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'3160191e-f381-48c6-9e05-fd6210fd34c6',false,4),
  -- PRALINO
  ('fab28700-0000-4000-8000-000000000223','fab28700-0000-4000-8000-000000000138','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'0383a407-556b-4685-acc4-4211877a426e',false,1),
  ('fab28700-0000-4000-8000-000000000224','fab28700-0000-4000-8000-000000000138','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'867dbd34-1c29-4b91-a51b-a99214e57adc',true ,2),
  ('fab28700-0000-4000-8000-000000000225','fab28700-0000-4000-8000-000000000138','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'17cdd8e8-2817-4672-aa0b-14219d7eee6e',false,3),
  -- ROYAL
  ('fab28700-0000-4000-8000-000000000226','fab28700-0000-4000-8000-000000000139','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'23d51050-ebb2-4455-9329-1ac473a97d60',false,1),
  ('fab28700-0000-4000-8000-000000000227','fab28700-0000-4000-8000-000000000139','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'b9e7d606-a1c2-4133-a500-2c085e58fb82',true ,2),
  ('fab28700-0000-4000-8000-000000000228','fab28700-0000-4000-8000-000000000139','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'206f57ff-d904-4d50-9be4-bdc64f1d177d',false,3),
  -- TRIO
  ('fab28700-0000-4000-8000-000000000229','fab28700-0000-4000-8000-000000000140','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'ef00302b-0d1f-4464-9bfa-4730210595f2',false,1),
  ('fab28700-0000-4000-8000-000000000230','fab28700-0000-4000-8000-000000000140','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'6e8b83f6-2dcc-4c74-a9c5-0731c7fdc60f',true ,2),
  ('fab28700-0000-4000-8000-000000000231','fab28700-0000-4000-8000-000000000140','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'c5e7919e-056c-4eaf-bb99-c6d53b3c9f0c',false,3),
  -- Ô FAURIA (4 tailles, dont le PRS 15 sur cadre demi)
  ('fab28700-0000-4000-8000-000000000232','fab28700-0000-4000-8000-000000000141','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'f849b567-ba9f-4c53-9f67-822c747081fe',false,1),
  ('fab28700-0000-4000-8000-000000000233','fab28700-0000-4000-8000-000000000141','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'5b844d56-5766-4ab0-8a11-2dc1e0fd1b4d',true ,2),
  ('fab28700-0000-4000-8000-000000000234','fab28700-0000-4000-8000-000000000141','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'64bcee14-3da6-4dec-97f1-cd7c003b3dd0',false,3),
  ('fab28700-0000-4000-8000-000000000235','fab28700-0000-4000-8000-000000000141','Cadre demi 40x30x4,5 cm'        ,1.875,'0c01cc49-d7c0-4d18-b05c-a620f0d403d0',false,4),
  -- OPERA : 3 formats CERCLE greffes sur la recette existante (mig 273/276).
  -- is_default = false partout : le cadre 60x40 reste le format par defaut.
  ('fab28700-0000-4000-8000-000000000236','0be7a000-0000-4000-8000-000000000001','Cercle à entremets Ø16 x 4,5 cm',0.72 ,'a46c9213-2e4e-461f-a3b3-c8b729d63c3f',false,4),
  ('fab28700-0000-4000-8000-000000000237','0be7a000-0000-4000-8000-000000000001','Cercle à entremets Ø20 x 4,5 cm',1.00 ,'6fceb847-8d27-4238-96ef-e558660040ee',false,5),
  ('fab28700-0000-4000-8000-000000000238','0be7a000-0000-4000-8000-000000000001','Cercle à entremets Ø22 x 4,5 cm',1.25 ,'d42f14f4-56dd-4cd7-8785-d01babce9a6f',false,6);

INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id, nb_parts)
SELECT f.format_id, f.recipe_id, c.id, round(1000 * f.scale, 2), 'g', 1,
       f.is_default, f.ordre, f.product_id,
       -- nb de parts vendues : ~125 g par part
       round(1000 * f.scale / 125)::int
FROM _ent_fmt f
JOIN production_contenants c ON c.nom = f.contenant
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_formats WHERE id::text LIKE 'fab28700-0000-4000-8000-00000000020%'
                                                 OR id::text LIKE 'fab28700-0000-4000-8000-00000000021%'
                                                 OR id::text LIKE 'fab28700-0000-4000-8000-00000000022%'
                                                 OR id::text LIKE 'fab28700-0000-4000-8000-00000000023%';
  IF n <> 38 THEN
    RAISE EXCEPTION 'Formats entremets : % crees sur 38 attendus (contenant introuvable ?)', n;
  END IF;
END $$;

-- ─── Nomenclatures, ecrites pour 1 000 g net ───
DROP TABLE IF EXISTS _ent_nom;
CREATE TEMP TABLE _ent_nom (
  recipe_id uuid, role text, src_recipe text, src_ing text,
  qte_ref numeric, perte numeric, ordre smallint
) ON COMMIT DROP;

INSERT INTO _ent_nom VALUES
  -- AMANDINE — dacquoise amande, croustillant, mousseline pralinee amande,
  -- masquage pate d'amande, amandes effilees torrefiees
  ('fab28700-0000-4000-8000-000000000130','biscuit'     ,'Dacquoise amande'                ,NULL                ,280,0,1),
  ('fab28700-0000-4000-8000-000000000130','croustillant','Croustillant praliné feuilletine',NULL                ,120,0,2),
  ('fab28700-0000-4000-8000-000000000130','garniture'   ,'Crème mousseline vanille'        ,NULL                ,440,4,3),
  ('fab28700-0000-4000-8000-000000000130','garniture'   ,NULL                              ,'Praliné amande 50%', 60,0,4),
  ('fab28700-0000-4000-8000-000000000130','decor'       ,NULL                              ,'Pâte d''amande 50%', 60,0,5),
  ('fab28700-0000-4000-8000-000000000130','decor'       ,NULL                              ,'Amande effilée'    , 40,0,6),
  -- CASABLANCA — genoise, ganache montee ivoire, insert fruits rouges
  ('fab28700-0000-4000-8000-000000000131','biscuit'  ,'Génoise nature'            ,NULL                 ,200,0,1),
  ('fab28700-0000-4000-8000-000000000131','imbibage' ,'Sirop à 30°B'              ,NULL                 , 80,0,2),
  ('fab28700-0000-4000-8000-000000000131','garniture','Ganache montée ivoire'     ,NULL                 ,440,3,3),
  ('fab28700-0000-4000-8000-000000000131','insert'   ,'Compotée de fruits rouges' ,NULL                 ,190,3,4),
  ('fab28700-0000-4000-8000-000000000131','nappage'  ,NULL                        ,'Nappage neutre'     , 40,0,5),
  ('fab28700-0000-4000-8000-000000000131','decor'    ,NULL                        ,'Chocolat Blanc 30%' , 50,0,6),
  -- FERRERO ROCHER — dacquoise noisette, croustillant, mousse lait, enrobage rocher
  ('fab28700-0000-4000-8000-000000000132','biscuit'     ,'Dacquoise noisette'              ,NULL                  ,240,0,1),
  ('fab28700-0000-4000-8000-000000000132','croustillant','Croustillant praliné feuilletine',NULL                  ,160,0,2),
  ('fab28700-0000-4000-8000-000000000132','garniture'   ,'Mousse au chocolat au lait'      ,NULL                  ,460,3,3),
  ('fab28700-0000-4000-8000-000000000132','glacage'     ,'Glaçage rocher'                  ,NULL                  , 90,5,4),
  ('fab28700-0000-4000-8000-000000000132','decor'       ,NULL                              ,'NOISETTE EN GRAINS'  , 50,0,5),
  -- FEUILLES D'AUTOMNE — meringue, mousse chocolat noir, copeaux
  ('fab28700-0000-4000-8000-000000000133','fond'     ,'Meringue française'     ,NULL                                ,150,0,1),
  ('fab28700-0000-4000-8000-000000000133','biscuit'  ,'Génoise cacao'          ,NULL                                ,110,0,2),
  ('fab28700-0000-4000-8000-000000000133','garniture','Mousse au chocolat noir',NULL                                ,620,3,3),
  ('fab28700-0000-4000-8000-000000000133','decor'    ,NULL                     ,'Chocolat de couverture Noir 55%'   ,120,0,4),
  -- FRAISIER — genoise, mousseline vanille, fraises coupees, pate d'amande
  ('fab28700-0000-4000-8000-000000000134','biscuit'  ,'Génoise nature'          ,NULL                 ,180,0,1),
  ('fab28700-0000-4000-8000-000000000134','imbibage' ,'Sirop à 30°B'            ,NULL                 , 80,0,2),
  ('fab28700-0000-4000-8000-000000000134','garniture','Crème mousseline vanille',NULL                 ,380,4,3),
  ('fab28700-0000-4000-8000-000000000134','fruits'   ,NULL                      ,'Fraise'             ,280,5,4),
  ('fab28700-0000-4000-8000-000000000134','decor'    ,NULL                      ,'Pâte d''amande 50%' , 50,0,5),
  ('fab28700-0000-4000-8000-000000000134','nappage'  ,NULL                      ,'Nappage neutre'     , 30,0,6),
  -- GATEAU CARAMEL — dacquoise, croustillant, insert caramel, mousse caramel
  ('fab28700-0000-4000-8000-000000000135','biscuit'     ,'Dacquoise noisette'              ,NULL                ,180,0,1),
  ('fab28700-0000-4000-8000-000000000135','croustillant','Croustillant praliné feuilletine',NULL                ,170,0,2),
  ('fab28700-0000-4000-8000-000000000135','insert'      ,'Caramel tendre'                  ,NULL                ,150,3,3),
  ('fab28700-0000-4000-8000-000000000135','garniture'   ,'Mousse caramel'                  ,NULL                ,380,3,4),
  ('fab28700-0000-4000-8000-000000000135','glacage'     ,'Glaçage miroir cacao'            ,NULL                , 80,5,5),
  ('fab28700-0000-4000-8000-000000000135','decor'       ,NULL                              ,'NOISETTE EN GRAINS', 40,0,6),
  -- GATEAUX AUX FRUITS — genoise, diplomate, fruits frais, amarena
  ('fab28700-0000-4000-8000-000000000136','biscuit'  ,'Génoise nature'  ,NULL                     ,200,0,1),
  ('fab28700-0000-4000-8000-000000000136','imbibage' ,'Sirop à 30°B'    ,NULL                     , 90,0,2),
  ('fab28700-0000-4000-8000-000000000136','garniture','Crème diplomate' ,NULL                     ,380,3,3),
  ('fab28700-0000-4000-8000-000000000136','fruits'   ,NULL              ,'Fraise'                 ,130,5,4),
  ('fab28700-0000-4000-8000-000000000136','fruits'   ,NULL              ,'Kiwi'                   , 80,5,5),
  ('fab28700-0000-4000-8000-000000000136','fruits'   ,NULL              ,'Amarena au sirop lourd' , 60,0,6),
  ('fab28700-0000-4000-8000-000000000136','decor'    ,NULL              ,'Amande effilée'         , 30,0,7),
  ('fab28700-0000-4000-8000-000000000136','nappage'  ,NULL              ,'Nappage neutre'         , 30,0,8),
  -- NOISETTE — dacquoise noisette, croustillant, mousse pralinee, miroir
  ('fab28700-0000-4000-8000-000000000137','biscuit'     ,'Dacquoise noisette'              ,NULL                ,250,0,1),
  ('fab28700-0000-4000-8000-000000000137','croustillant','Croustillant praliné feuilletine',NULL                ,130,0,2),
  ('fab28700-0000-4000-8000-000000000137','garniture'   ,'Mousse pralinée'                 ,NULL                ,500,3,3),
  ('fab28700-0000-4000-8000-000000000137','glacage'     ,'Glaçage miroir cacao'            ,NULL                , 80,5,4),
  ('fab28700-0000-4000-8000-000000000137','decor'       ,NULL                              ,'NOISETTE EN GRAINS', 40,0,5),
  -- PRALINO — biscuit cuillere, mousseline pralinee amande, croustillant
  ('fab28700-0000-4000-8000-000000000138','biscuit'     ,'Biscuit cuillère'                ,NULL                 ,170,0,1),
  ('fab28700-0000-4000-8000-000000000138','imbibage'    ,'Sirop à 30°B'                    ,NULL                 , 60,0,2),
  ('fab28700-0000-4000-8000-000000000138','garniture'   ,'Crème mousseline vanille'        ,NULL                 ,360,4,3),
  ('fab28700-0000-4000-8000-000000000138','garniture'   ,NULL                              ,'Praliné amande 50%' ,130,0,4),
  ('fab28700-0000-4000-8000-000000000138','croustillant','Croustillant praliné feuilletine',NULL                 ,180,0,5),
  ('fab28700-0000-4000-8000-000000000138','decor'       ,NULL                              ,'Amande effilée'     ,100,0,6),
  -- ROYAL (trianon) — dacquoise, croustillant, mousse noire, miroir cacao
  ('fab28700-0000-4000-8000-000000000139','biscuit'     ,'Dacquoise noisette'              ,NULL,200,0,1),
  ('fab28700-0000-4000-8000-000000000139','croustillant','Croustillant praliné feuilletine',NULL,180,0,2),
  ('fab28700-0000-4000-8000-000000000139','garniture'   ,'Mousse au chocolat noir'         ,NULL,520,3,3),
  ('fab28700-0000-4000-8000-000000000139','glacage'     ,'Glaçage miroir cacao'            ,NULL,100,5,4),
  -- TRIO — trois mousses chocolat (noir, lait, ivoire) sur genoise cacao
  ('fab28700-0000-4000-8000-000000000140','biscuit'  ,'Génoise cacao'             ,NULL                             ,130,0,1),
  ('fab28700-0000-4000-8000-000000000140','imbibage' ,'Sirop à 30°B'              ,NULL                             , 50,0,2),
  ('fab28700-0000-4000-8000-000000000140','garniture','Mousse au chocolat noir'   ,NULL                             ,290,3,3),
  ('fab28700-0000-4000-8000-000000000140','garniture','Mousse au chocolat au lait',NULL                             ,280,3,4),
  ('fab28700-0000-4000-8000-000000000140','garniture','Ganache montée ivoire'     ,NULL                             ,220,3,5),
  ('fab28700-0000-4000-8000-000000000140','decor'    ,NULL                        ,'Chocolat de couverture Noir 55%', 30,0,6),
  -- Ô FAURIA (signature maison) — dacquoise noisette, croustillant, coeur
  -- caramel, mousse lait, enrobage rocher, noisettes torrefiees
  ('fab28700-0000-4000-8000-000000000141','biscuit'     ,'Dacquoise noisette'              ,NULL                ,200,0,1),
  ('fab28700-0000-4000-8000-000000000141','croustillant','Croustillant praliné feuilletine',NULL                ,140,0,2),
  ('fab28700-0000-4000-8000-000000000141','insert'      ,'Caramel tendre'                  ,NULL                ,120,3,3),
  ('fab28700-0000-4000-8000-000000000141','garniture'   ,'Mousse au chocolat au lait'      ,NULL                ,420,3,4),
  ('fab28700-0000-4000-8000-000000000141','glacage'     ,'Glaçage rocher'                  ,NULL                , 80,5,5),
  ('fab28700-0000-4000-8000-000000000141','decor'       ,NULL                              ,'NOISETTE EN GRAINS', 40,0,6),
  -- OPERA — nomenclature de la masterclass (mig 276) ramenee au kilo :
  -- 7 160 g de cadre / 7,16 = 1 000 g
  ('0be7a000-0000-4000-8000-000000000001','biscuit'    ,'Biscuit Joconde'     ,NULL                             ,335,0,1),
  ('0be7a000-0000-4000-8000-000000000001','chablonnage',NULL                  ,'Chocolat de couverture Noir 55%', 14,0,2),
  ('0be7a000-0000-4000-8000-000000000001','imbibage'   ,'Sirop imbibage café' ,NULL                             ,191,0,3),
  ('0be7a000-0000-4000-8000-000000000001','garniture'  ,'Crème au beurre café',NULL                             ,193,5,4),
  ('0be7a000-0000-4000-8000-000000000001','garniture'  ,'Ganache chocolat noir',NULL                            ,144,2,5),
  ('0be7a000-0000-4000-8000-000000000001','glacage'    ,'Glaçage opéra'       ,NULL                             ,123,5,6);

-- Garde-fou : chaque nomenclature doit peser exactement 1 000 g.
DO $$
DECLARE z TEXT;
BEGIN
  SELECT string_agg(recipe_id::text || ' = ' || total::text, ', ') INTO z
  FROM (SELECT recipe_id, sum(qte_ref) AS total FROM _ent_nom GROUP BY recipe_id) s
  WHERE total <> 1000;
  IF z IS NOT NULL THEN
    RAISE EXCEPTION 'Nomenclatures entremets hors 1000 g : %', z;
  END IF;
END $$;

DELETE FROM recipe_format_components
 WHERE format_id IN (SELECT format_id FROM _ent_fmt);

INSERT INTO recipe_format_components (format_id, role, source_recipe_id,
                                      source_ingredient_id, quantite, unite,
                                      perte_pct, ordre)
SELECT f.format_id, n.role, b.id, ing.id,
       round(n.qte_ref * f.scale, 2), 'g', n.perte, n.ordre
FROM _ent_fmt f
JOIN _ent_nom n     ON n.recipe_id = f.recipe_id
LEFT JOIN _base287 b  ON b.name = n.src_recipe
LEFT JOIN _ing287 ing ON ing.name = n.src_ing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. FORMATS DES CAKES, MUFFINS, PETITS FOURS, COOKIES ET SACHETS.
--    Ici pas de facteur d'echelle : chaque moule/plaque a son grammage propre.
--    contenant_id NULL = conditionnement, pas cuisson (tranche 100 g, sachet) :
--    c'est le meme appareil, decoupe ou ensache autrement.
--    RAPPEL : recipe_format_components.quantite = poids net pour TOUT le
--    contenant, donc nb_par_defaut x quantite_par_format.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _ck_fmt;
CREATE TEMP TABLE _ck_fmt (
  format_id uuid, recipe_id uuid, contenant text, qpf numeric, nb int,
  product_id uuid, is_default boolean, ordre int
) ON COMMIT DROP;

INSERT INTO _ck_fmt VALUES
  ('fab28700-0000-4000-8000-000000000241','fab28700-0000-4000-8000-000000000150','Moule à cake 25 cm'              , 500, 1,'269d7f1f-a299-4256-b6ac-5917eea8d030',true ,1),
  ('fab28700-0000-4000-8000-000000000242','fab28700-0000-4000-8000-000000000150','Moule à cake 15 cm'              , 230, 1,'ca03804d-5c4a-4355-ac67-454b1533fa62',false,2),
  ('fab28700-0000-4000-8000-000000000243','fab28700-0000-4000-8000-000000000150',NULL                              , 100, 1,'8d423b57-3f08-4ccb-bb6b-9a7de8867235',false,3),
  ('fab28700-0000-4000-8000-000000000244','fab28700-0000-4000-8000-000000000150',NULL                              ,  80, 1,'18d20a5d-ef21-4a42-8ff2-6f054214d8cd',false,4),
  ('fab28700-0000-4000-8000-000000000245','fab28700-0000-4000-8000-000000000151','Moule à cake 25 cm'              , 500, 1,'296e4795-0325-4941-b3a2-80fb10869ce5',true ,1),
  ('fab28700-0000-4000-8000-000000000246','fab28700-0000-4000-8000-000000000151',NULL                              , 100, 1,'baed0f4c-2d6b-4624-ae33-4668b228a263',false,2),
  ('fab28700-0000-4000-8000-000000000247','fab28700-0000-4000-8000-000000000153','Moule à cake 25 cm'              , 520, 1,'5b7bbed9-ff51-481e-8fea-ed322fa1a6b9',true ,1),
  ('fab28700-0000-4000-8000-000000000248','fab28700-0000-4000-8000-000000000154','Moule à cake 25 cm'              , 515, 1,'34464f74-ba43-48fb-9c68-73886b6490bd',true ,1),
  ('fab28700-0000-4000-8000-000000000249','fab28700-0000-4000-8000-000000000155','Moule à cake 25 cm'              , 540, 1,'45b57fac-5e8b-49db-956f-3ec12d43a280',true ,1),
  ('fab28700-0000-4000-8000-000000000250','fab28700-0000-4000-8000-000000000156','Moule à cake 25 cm'              , 520, 1,'6bb71389-4621-45a2-87da-80f68dc563c2',true ,1),
  ('fab28700-0000-4000-8000-000000000251','fab28700-0000-4000-8000-000000000157','Moule à cake individuel 8 cm'    , 114, 1,'59ca8246-41ad-4655-8104-127e50315e79',true ,1),
  ('fab28700-0000-4000-8000-000000000252','fab28700-0000-4000-8000-000000000158','Moule à cake individuel 8 cm'    , 115, 1,'69f7a30c-78e3-440f-a75a-29d903ed8c91',true ,1),
  ('fab28700-0000-4000-8000-000000000253','fab28700-0000-4000-8000-000000000159','Plaque de cuisson plate 40x30'   ,  60,30,'934c7540-f4f7-428d-9ea3-66b0061d49c5',true ,1),
  ('fab28700-0000-4000-8000-000000000254','fab28700-0000-4000-8000-000000000160','Plaque à financiers (40)'        ,  48,40,'309fa1fa-1ad0-49c9-9357-acff0e86d1fd',true ,1),
  ('fab28700-0000-4000-8000-000000000255','fab28700-0000-4000-8000-000000000160','Plaque à mini-financiers (84)'   ,  19,84,'2150c7f2-41e7-41d2-a3d7-8cc492ebd872',false,2),
  ('fab28700-0000-4000-8000-000000000256','fab28700-0000-4000-8000-000000000161','Plaque à madeleines (40)'        ,  45,40,'13845f19-5e34-4cd0-aee0-6262f8de7b13',true ,1),
  ('fab28700-0000-4000-8000-000000000257','fab28700-0000-4000-8000-000000000161',NULL                              , 225, 1,'9c047f1e-5638-4788-b29d-98b162dc7582',false,2),
  ('fab28700-0000-4000-8000-000000000258','fab28700-0000-4000-8000-000000000161',NULL                              , 168, 1,'6f4cd2d7-e2a4-41c5-90cc-d37003da6a93',false,3),
  ('fab28700-0000-4000-8000-000000000259','fab28700-0000-4000-8000-000000000162','Plaque à madeleines (40)'        ,  45,40,'9746514c-b94d-4009-b0e4-1edb87e0fefb',true ,1),
  ('fab28700-0000-4000-8000-000000000260','fab28700-0000-4000-8000-000000000163','Plaque à madeleines (40)'        ,  48,40,'25a507e7-9097-45de-9402-ad65c9ad4561',true ,1),
  ('fab28700-0000-4000-8000-000000000261','fab28700-0000-4000-8000-000000000164','Plaque à muffins gros (12)'      ,  95,12,'1233479e-bbe7-40a2-8ecc-bfdee0be4cbf',true ,1),
  ('fab28700-0000-4000-8000-000000000262','fab28700-0000-4000-8000-000000000165','Plaque à muffins gros (12)'      ,  95,12,'9d55e984-c2b8-4890-a3f4-ee9caa2c6a97',true ,1),
  ('fab28700-0000-4000-8000-000000000263','fab28700-0000-4000-8000-000000000166','Plaque à mini-muffins (48)'      ,  36,48,'050eaa87-1a00-425b-bb11-0c01e7555a53',true ,1),
  ('fab28700-0000-4000-8000-000000000264','fab28700-0000-4000-8000-000000000167','Plaque à savarins individuels (15)',55,15,'4623db19-41f6-4eef-9d2f-719e91b39e1f',true ,1),
  ('fab28700-0000-4000-8000-000000000265','fab28700-0000-4000-8000-000000000167','Plaque à mini-financiers (84)'   ,  22,84,'1a7896c4-8ff2-4aa4-b5c2-8cbfcc222ced',false,2),
  ('fab28700-0000-4000-8000-000000000266','fab28700-0000-4000-8000-000000000167',NULL                              , 220, 1,'2c24da85-799c-40ae-81fd-fc77f2d8f4d9',false,3),
  ('fab28700-0000-4000-8000-000000000267','fab28700-0000-4000-8000-000000000168','Plaque à savarins individuels (15)',58,15,'72ef2e84-eb74-46cf-bbeb-4b6a0a4b82e2',true ,1),
  ('fab28700-0000-4000-8000-000000000268','fab28700-0000-4000-8000-000000000169','Plaque à savarins individuels (15)',58,15,'dc080b71-052c-4a0c-a5d0-5193902bd2d6',true ,1),
  ('fab28700-0000-4000-8000-000000000269','fab28700-0000-4000-8000-000000000170','Plaque de cuisson plate 40x30'   ,  60,20,'e8ff6e7e-9478-496c-9187-eaf5e7f6b78d',true ,1),
  ('fab28700-0000-4000-8000-000000000270','fab28700-0000-4000-8000-000000000171','Plaque de cuisson plate 40x30'   ,  60,20,'dc6dec89-f9a4-4b82-80a2-3ec44a3aa78e',true ,1),
  ('fab28700-0000-4000-8000-000000000271','fab28700-0000-4000-8000-000000000172','Plaque de cuisson plate 40x30'   ,  60,20,'fcd88b82-508d-4c48-a566-070d3789e113',true ,1),
  ('fab28700-0000-4000-8000-000000000272','fab28700-0000-4000-8000-000000000173','Cercle à entremets haut Ø20 x 6 cm',2600,1,'4f145eec-d5b9-42ae-a8eb-4e6612ec2068',true,1),
  ('fab28700-0000-4000-8000-000000000273','fab28700-0000-4000-8000-000000000174','Cercle à tartelette Ø10 cm'      , 120, 1,'e06431a7-79da-47f3-b5f6-8e279f4a8646',true ,1);

INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id)
SELECT f.format_id, f.recipe_id, c.id, f.qpf, 'g', f.nb, f.is_default, f.ordre,
       f.product_id
FROM _ck_fmt f
LEFT JOIN production_contenants c ON c.nom = f.contenant
WHERE f.contenant IS NULL OR c.id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipe_formats f
   WHERE EXISTS (SELECT 1 FROM _ck_fmt k WHERE k.format_id = f.id);
  IF n <> 33 THEN
    RAISE EXCEPTION 'Formats cakes : % crees sur 33 attendus (contenant introuvable ?)', n;
  END IF;
END $$;

-- ─── Nomenclatures : poids NET pour tout le contenant ───
DROP TABLE IF EXISTS _ck_nom;
CREATE TEMP TABLE _ck_nom (
  format_id uuid, role text, src_recipe text, src_ing text,
  qte numeric, perte numeric, ordre smallint
) ON COMMIT DROP;

INSERT INTO _ck_nom VALUES
  -- CAKE NATURE (moule 25) / MINI (moule 15) / tranche 100 g / tranche 80 g
  ('fab28700-0000-4000-8000-000000000241','biscuit','Pâte à cake nature',NULL, 500,0,1),
  ('fab28700-0000-4000-8000-000000000242','biscuit','Pâte à cake nature',NULL, 230,0,1),
  ('fab28700-0000-4000-8000-000000000243','biscuit','Pâte à cake nature',NULL, 100,0,1),
  ('fab28700-0000-4000-8000-000000000244','biscuit','Pâte à cake nature',NULL,  80,0,1),
  -- CAKE CITRON — glacage sucre glace/jus de citron a la sortie du four
  ('fab28700-0000-4000-8000-000000000245','biscuit','Pâte à cake citron',NULL, 440,0,1),
  ('fab28700-0000-4000-8000-000000000245','glacage',NULL,'Sucre glace'       ,  45,0,2),
  ('fab28700-0000-4000-8000-000000000245','glacage',NULL,'Citron'            ,  15,0,3),
  ('fab28700-0000-4000-8000-000000000246','biscuit','Pâte à cake citron',NULL,  88,0,1),
  ('fab28700-0000-4000-8000-000000000246','glacage',NULL,'Sucre glace'       ,   9,0,2),
  ('fab28700-0000-4000-8000-000000000246','glacage',NULL,'Citron'            ,   3,0,3),
  -- CAKE FRUITS SECS
  ('fab28700-0000-4000-8000-000000000247','biscuit','Pâte à cake nature',NULL, 470,0,1),
  ('fab28700-0000-4000-8000-000000000247','fruits' ,NULL,'Amande concassée' ,  30,0,2),
  ('fab28700-0000-4000-8000-000000000247','fruits' ,NULL,'Noix décortiquées',  20,0,3),
  -- CAKES ROCHER — enrobage sur cake congele, a 30-32 °C
  ('fab28700-0000-4000-8000-000000000248','biscuit','Pâte à cake chocolat'     ,NULL, 440,0,1),
  ('fab28700-0000-4000-8000-000000000248','glacage','Glaçage rocher'           ,NULL,  75,5,2),
  ('fab28700-0000-4000-8000-000000000249','biscuit','Pâte à cake nature'       ,NULL, 390,0,1),
  ('fab28700-0000-4000-8000-000000000249','insert' ,'Compotée de fruits rouges',NULL,  75,3,2),
  ('fab28700-0000-4000-8000-000000000249','glacage','Glaçage rocher'           ,NULL,  75,5,3),
  ('fab28700-0000-4000-8000-000000000250','biscuit','Pâte à cake nature'       ,NULL, 400,0,1),
  ('fab28700-0000-4000-8000-000000000250','fruits' ,NULL,'Amande concassée'    ,  30,0,2),
  ('fab28700-0000-4000-8000-000000000250','fruits' ,NULL,'Noix décortiquées'   ,  15,0,3),
  ('fab28700-0000-4000-8000-000000000250','glacage','Glaçage rocher'           ,NULL,  75,5,4),
  -- CAKES INDIVIDUELS
  ('fab28700-0000-4000-8000-000000000251','biscuit','Pâte à cake nature',NULL      , 105,0,1),
  ('fab28700-0000-4000-8000-000000000251','garniture',NULL,'Pâte de pistache 100%',   6,0,2),
  ('fab28700-0000-4000-8000-000000000251','decor'  ,NULL,'Pistache décortiquée'  ,   3,0,3),
  ('fab28700-0000-4000-8000-000000000252','biscuit','Pâte à cake nature',NULL      , 100,0,1),
  ('fab28700-0000-4000-8000-000000000252','fruits' ,NULL,'Noix décortiquées'     ,  15,0,2),
  -- BROWNIE — 1 plaque 40x30 = 1 fournee d'appareil, decoupe en 30 carres
  ('fab28700-0000-4000-8000-000000000253','biscuit','Appareil à brownie',NULL,1800,0,1),
  -- FINANCIERS
  ('fab28700-0000-4000-8000-000000000254','biscuit','Appareil à financier',NULL,1800,0,1),
  ('fab28700-0000-4000-8000-000000000254','decor'  ,NULL,'Amande effilée'   , 120,0,2),
  ('fab28700-0000-4000-8000-000000000255','biscuit','Appareil à financier',NULL,1520,0,1),
  ('fab28700-0000-4000-8000-000000000255','decor'  ,NULL,'Amande effilée'   ,  76,0,2),
  -- MADELEINES (plaque, sachet grand 5 pieces, sachet mini 12 pieces)
  ('fab28700-0000-4000-8000-000000000256','biscuit','Appareil à madeleine',NULL,1800,0,1),
  ('fab28700-0000-4000-8000-000000000257','biscuit','Appareil à madeleine',NULL, 225,0,1),
  ('fab28700-0000-4000-8000-000000000258','biscuit','Appareil à madeleine',NULL, 168,0,1),
  ('fab28700-0000-4000-8000-000000000259','biscuit','Appareil à madeleine',NULL,1560,0,1),
  ('fab28700-0000-4000-8000-000000000259','glacage',NULL,'Chocolat de couverture Noir 55%',240,0,2),
  ('fab28700-0000-4000-8000-000000000260','biscuit','Appareil à madeleine',NULL,1780,0,1),
  ('fab28700-0000-4000-8000-000000000260','glacage',NULL,'Sucre glace'      , 100,0,2),
  ('fab28700-0000-4000-8000-000000000260','glacage',NULL,'Citron'           ,  40,0,3),
  -- MUFFINS
  ('fab28700-0000-4000-8000-000000000261','biscuit','Appareil à muffin vanille' ,NULL,1080,0,1),
  ('fab28700-0000-4000-8000-000000000261','decor'  ,NULL,'Sucre grain CAL 10'   ,  60,0,2),
  ('fab28700-0000-4000-8000-000000000262','biscuit','Appareil à muffin chocolat',NULL,1080,0,1),
  ('fab28700-0000-4000-8000-000000000262','decor'  ,NULL,'Gouttes drops 50% DGF',  60,0,2),
  ('fab28700-0000-4000-8000-000000000263','biscuit','Appareil à muffin vanille' ,NULL, 900,0,1),
  ('fab28700-0000-4000-8000-000000000263','biscuit','Appareil à muffin chocolat',NULL, 828,0,2),
  -- TIGRES — moule savarin, coeur de ganache coule apres cuisson
  ('fab28700-0000-4000-8000-000000000264','biscuit'  ,'Appareil à tigré'      ,NULL, 660,0,1),
  ('fab28700-0000-4000-8000-000000000264','garniture','Ganache chocolat noir' ,NULL, 165,2,2),
  ('fab28700-0000-4000-8000-000000000265','biscuit'  ,'Appareil à tigré'      ,NULL,1480,0,1),
  ('fab28700-0000-4000-8000-000000000265','garniture','Ganache chocolat noir' ,NULL, 368,2,2),
  ('fab28700-0000-4000-8000-000000000266','biscuit'  ,'Appareil à tigré'      ,NULL, 176,0,1),
  ('fab28700-0000-4000-8000-000000000266','garniture','Ganache chocolat noir' ,NULL,  44,2,2),
  ('fab28700-0000-4000-8000-000000000267','biscuit'  ,'Appareil à tigré'        ,NULL, 640,0,1),
  ('fab28700-0000-4000-8000-000000000267','insert'   ,'Caramel tendre'          ,NULL, 150,3,2),
  ('fab28700-0000-4000-8000-000000000267','garniture','Ganache chocolat au lait',NULL,  80,2,3),
  ('fab28700-0000-4000-8000-000000000268','biscuit'  ,'Appareil à tigré'      ,NULL     , 620,0,1),
  ('fab28700-0000-4000-8000-000000000268','garniture','Ganache montée ivoire' ,NULL     , 170,3,2),
  ('fab28700-0000-4000-8000-000000000268','garniture',NULL,'Pâte de pistache 100%'      ,  50,0,3),
  ('fab28700-0000-4000-8000-000000000268','decor'    ,NULL,'Pistache décortiquée'       ,  30,0,4),
  -- COOKIES — 3 parfums sur la meme pate, 20 palets de 60 g par plaque
  ('fab28700-0000-4000-8000-000000000269','biscuit','Pâte à cookies',NULL           ,1000,0,1),
  ('fab28700-0000-4000-8000-000000000269','decor'  ,NULL,'Gouttes drops 50% DGF'   , 200,0,2),
  ('fab28700-0000-4000-8000-000000000270','biscuit','Pâte à cookies',NULL           ,1020,0,1),
  ('fab28700-0000-4000-8000-000000000270','decor'  ,NULL,'Chocolat Blanc 30%'      , 100,0,2),
  ('fab28700-0000-4000-8000-000000000270','fruits' ,NULL,'Purée framboises'        ,  80,0,3),
  ('fab28700-0000-4000-8000-000000000271','biscuit','Pâte à cookies',NULL           ,1000,0,1),
  ('fab28700-0000-4000-8000-000000000271','garniture',NULL,'Pâte de pistache 100%' ,  80,0,2),
  ('fab28700-0000-4000-8000-000000000271','decor'  ,NULL,'Pistache décortiquée'    ,  60,0,3),
  ('fab28700-0000-4000-8000-000000000271','decor'  ,NULL,'Chocolat Blanc 30%'      ,  60,0,4),
  -- CAKE DESIGN — 2 etages genoise/mousseline/fruits rouges sous pate a sucre
  ('fab28700-0000-4000-8000-000000000272','biscuit'  ,'Génoise nature'           ,NULL, 900,0,1),
  ('fab28700-0000-4000-8000-000000000272','imbibage' ,'Sirop à 30°B'             ,NULL, 250,0,2),
  ('fab28700-0000-4000-8000-000000000272','garniture','Crème mousseline vanille' ,NULL, 800,4,3),
  ('fab28700-0000-4000-8000-000000000272','insert'   ,'Compotée de fruits rouges',NULL, 200,3,4),
  ('fab28700-0000-4000-8000-000000000272','decor'    ,NULL,'Pâte à sucre blanche' , 380,0,5),
  ('fab28700-0000-4000-8000-000000000272','decor'    ,NULL,'Chocolat Blanc 30%'   ,  70,0,6),
  -- TARTE MYRTILLE — tartelette Ø10, pate sucree / creme d'amande / myrtilles
  ('fab28700-0000-4000-8000-000000000273','fond'     ,'Pâte sucrée'    ,NULL          ,  45,0,1),
  ('fab28700-0000-4000-8000-000000000273','garniture','Crème d''amande',NULL          ,  35,0,2),
  ('fab28700-0000-4000-8000-000000000273','fruits'   ,NULL,'Myrtille surgelée'        ,  32,0,3),
  ('fab28700-0000-4000-8000-000000000273','nappage'  ,NULL,'Nappage neutre'           ,   8,0,4);

-- Garde-fou : la nomenclature d'un format doit peser nb_par_defaut x
-- quantite_par_format (tolerance 3 %). Sans lui, un chiffre mal recopie
-- fausserait le cout a la piece sans qu'aucune contrainte ne bronche.
DO $$
DECLARE z TEXT;
BEGIN
  SELECT string_agg(format_id::text || ' : ' || round(somme,1) || ' vs ' || round(cible,1), E'\n')
    INTO z
  FROM (
    SELECT f.format_id, sum(n.qte) AS somme, f.qpf * f.nb AS cible
    FROM _ck_fmt f JOIN _ck_nom n ON n.format_id = f.format_id
    GROUP BY f.format_id, f.qpf, f.nb
  ) s
  WHERE abs(somme - cible) > cible * 0.03;
  IF z IS NOT NULL THEN
    RAISE EXCEPTION 'Nomenclatures cakes incoherentes :%s', E'\n' || z;
  END IF;
END $$;

DELETE FROM recipe_format_components
 WHERE format_id IN (SELECT format_id FROM _ck_fmt);

INSERT INTO recipe_format_components (format_id, role, source_recipe_id,
                                      source_ingredient_id, quantite, unite,
                                      perte_pct, ordre)
SELECT n.format_id, n.role, b.id, ing.id, n.qte, 'g', n.perte, n.ordre
FROM _ck_nom n
LEFT JOIN _base287 b  ON b.name = n.src_recipe
LEFT JOIN _ing287 ing ON ing.name = n.src_ing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost passe par ce miroir pour les recettes composees :
--    sans lui, toutes ces fiches couteraient 0. L'Opera n'est pas concerne :
--    son format par defaut reste le cadre, deja miroite par la mig 276.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id::text LIKE 'fab28700-0000-4000-8000-0000000001%';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id,
                               source_ingredient_id, quantite, unite,
                               perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_formats f
JOIN recipe_format_components c ON c.format_id = f.id
WHERE f.is_default
  AND f.recipe_id::text LIKE 'fab28700-0000-4000-8000-0000000001%';

DO $$
DECLARE n INT;
BEGIN
  SELECT count(DISTINCT recipe_id) INTO n FROM recipe_components
   WHERE recipe_id::text LIKE 'fab28700-0000-4000-8000-0000000001%';
  IF n <> 36 THEN
    RAISE EXCEPTION 'Miroir incomplet : % fiches sur 36', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Etapes de production sur les 5 fiches phares.
--    On ne detaille pas les 36 fiches : ces cinq-la portent les gestes qui se
--    transmettent mal a l'oral — la coque de croustillant du Royal, l'ordre de
--    coulage des trois mousses du Trio, le coeur caramel de l'Ô Fauria, le choc
--    thermique de la madeleine, le repos de la pate a cookies.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Dacquoise noisette","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Blancs montés au bec d''oiseau, serrés au sucre semoule en 3 fois",
     "Tant-pour-tant noisette/sucre glace tamisé, incorporé à la maryse en 20 s maximum",
     "Étaler à 8 mm, cuisson 180 °C 18 min, sole douce",
     "Refroidir sur grille : une dacquoise laissée sur plaque transpire et colle"]},
  {"ordre":2,"nom":"Croustillant praliné","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Couverture fondue à 45 °C, praliné à 20 °C : mélanger hors du feu",
     "Feuilletine ajoutée en dernier, plier 10 s — au-delà elle se casse et le croustillant devient sableux",
     "Étaler à 4 mm sur la dacquoise ENCORE FROIDE, prise 10 min au froid positif",
     "Contrôle : la couche doit craquer sous la spatule, pas se plier"]},
  {"ordre":3,"nom":"Mousse au chocolat noir","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Anglaise cuite à 83 °C, chinoisée sur la couverture",
     "Émulsion au mixeur plongeant, cuve inclinée, lame immergée : zéro bulle",
     "Descendre l''appareil à 40 °C AVANT d''incorporer la crème montée mousseuse (pas ferme)",
     "Si l''appareil est à plus de 45 °C la crème fond et la mousse retombe : contrôler au thermomètre"]},
  {"ordre":4,"nom":"Montage à l''envers et surgélation","duree_estimee_min":25,"est_bloquante":true,
   "timer_auto":true,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cercle filmé et rhodoïdé, mousse coulée en premier, remontée aux parois à la spatule coudée",
     "Insert dacquoise+croustillant enfoncé croustillant vers la mousse, affleurant",
     "Lisser à la règle, surgélation à cœur -18 °C, 4 h minimum",
     "Un entremets glacé avant d''être dur à cœur fait couler le miroir : contrôle à la sonde"]},
  {"ordre":5,"nom":"Glaçage miroir et finition","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Miroir mixé la veille, chinoisé, utilisé à 32-35 °C",
     "Entremets décerclé SORTI DU SURGÉLATEUR, posé sur grille, glaçage coulé en une spirale du centre vers l''extérieur",
     "Racler la base à la palette, transférer sur carton or",
     "Décongélation 6 h à +4 °C avant vente"]}
]'::jsonb,
instructions = 'Royal (trianon) — entremets à parts, décliné PRS 6 (Ø16, 720 g) / PRS 8 (Ø20, 1000 g) / PRS 10 (Ø22, 1250 g), ~125 g par part.

Montage à l''envers : mousse › insert dacquoise-croustillant › surgélation › glaçage.

Conservation : 3 jours à +4 °C glacé. 2 mois à -18 °C AVANT glaçage.

Allergènes : fruits à coque (noisette, amande), œufs, lait, gluten (feuilletine), soja (lécithine du chocolat).'
WHERE id = 'fab28700-0000-4000-8000-000000000139';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Génoise cacao et imbibage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Œufs + sucre montés au bain-marie à 45 °C puis au ruban jusqu''à refroidissement",
     "Farine et cacao tamisés ensemble, incorporés en 3 fois à la maryse",
     "Cuisson 180 °C 20 min, détailler 2 disques au diamètre du cercle moins 5 mm",
     "Imbiber au sirop 30°B tiède : le disque doit être souple, pas détrempé"]},
  {"ordre":2,"nom":"Les trois mousses","duree_estimee_min":60,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "Une seule anglaise de base, séparée en trois avant l''ajout des couvertures",
     "Températures d''incorporation de la crème montée : noir 40 °C, lait 38 °C, ivoire 32 °C",
     "L''ivoire prend moins : ne jamais réduire sa gélatine",
     "Chaque mousse est coulée IMMÉDIATEMENT après montage — on ne prépare pas les trois d''avance"]},
  {"ordre":3,"nom":"Coulage en trois couches","duree_estimee_min":45,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ordre du bas vers le haut, du plus foncé au plus clair : noir › lait › ivoire",
     "15 min de prise au grand froid entre chaque couche — sinon les couches se mélangent au coulage",
     "Verser à la louche sur le dos d''une spatule pour casser la chute",
     "Contrôle visuel à la découpe test : trois bandes nettes et d''égale épaisseur"]},
  {"ordre":4,"nom":"Surgélation et finition","duree_estimee_min":240,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Surgélation à cœur -18 °C, 4 h",
     "Décerclage au chalumeau très bref, rhodoïd retiré à froid",
     "Copeaux de chocolat noir en couronne, voile de cacao sur le tiers avant",
     "Décongélation 6 h à +4 °C"]}
]'::jsonb,
instructions = 'Trio — trois mousses chocolat (noir, lait, ivoire) sur génoise cacao imbibée.
Décliné PRS 6 (Ø16) / PRS 8 (Ø20) / PRS 10 (Ø22).

Le point critique est la prise entre couches : 15 min de grand froid, pas moins.

Conservation : 3 jours à +4 °C. 2 mois à -18 °C.

Allergènes : œufs, lait, gluten, soja (lécithine du chocolat).'
WHERE id = 'fab28700-0000-4000-8000-000000000140';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Socle dacquoise-croustillant","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dacquoise noisette cuite 180 °C 18 min, refroidie sur grille",
     "Croustillant praliné feuilletine étalé à 4 mm sur la dacquoise, prise au froid 10 min",
     "Détailler au cercle à froid : la découpe à chaud arrache le croustillant"]},
  {"ordre":2,"nom":"Cœur caramel","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Caramel tendre coulé en insert dans un cercle plus petit de 2 cm, épaisseur 8 mm",
     "Surgélation de l''insert AVANT montage : un caramel souple noierait la mousse",
     "Contrôle : l''insert doit se manipuler d''une main sans se déformer"]},
  {"ordre":3,"nom":"Mousse chocolat au lait","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Anglaise à 83 °C sur la couverture lait, émulsion au mixeur plongeant",
     "Crème montée incorporée à 38 °C — la couverture lait fige plus bas que le noir",
     "Texture visée : ruban qui s''efface en 5 s"]},
  {"ordre":4,"nom":"Montage à l''envers","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mousse au tiers du cercle, insert caramel centré, mousse à ras",
     "Socle dacquoise-croustillant posé croustillant vers l''intérieur, pressé à fleur",
     "Surgélation à cœur -18 °C, 4 h minimum"]},
  {"ordre":5,"nom":"Enrobage rocher et décor","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Glaçage rocher à 30-32 °C : plus chaud il fait fondre l''arête, plus froid il fait des paquets",
     "Entremets sorti du surgélateur, glaçage coulé en une passe sur grille",
     "Couronne de noisettes torréfiées posée dans les 30 s, avant prise",
     "Décongélation 6 h à +4 °C"]}
]'::jsonb,
instructions = 'Ô Fauria — signature de la maison. Dacquoise noisette, croustillant praliné,
cœur de caramel tendre, mousse chocolat au lait, enrobage rocher aux amandes,
noisettes torréfiées.
Décliné PRS 6 (Ø16) / PRS 8 (Ø20) / PRS 10 (Ø22) / PRS 15 (cadre demi 40x30).

L''insert caramel doit être surgelé AVANT le montage : c''est la seule étape qui
ne se rattrape pas.

Conservation : 3 jours à +4 °C. 2 mois à -18 °C avant enrobage.

Allergènes : fruits à coque (noisette, amande), œufs, lait, gluten, soja.'
WHERE id = 'fab28700-0000-4000-8000-000000000141';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Appareil et maturation","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Œufs + sucre + trimoline blanchis sans monter",
     "Farine et levure tamisées, puis beurre fondu à 45 °C en émulsion",
     "Zeste de citron râpé fin, jamais le ziste",
     "MATURATION 12 h minimum à +4 °C, filmé au contact — c''est elle qui hydrate la farine et donne la bosse"]},
  {"ordre":2,"nom":"Dressage et repos au froid","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Plaque beurrée-farinée, appareil poché aux 3/4 de l''alvéole, 45 g par madeleine",
     "Remettre la plaque garnie 30 min au froid : appareil à 4 °C dans un four à 220 °C",
     "Ne jamais dresser sur une plaque tiède sortie du four précédent"]},
  {"ordre":3,"nom":"Cuisson — le choc thermique","duree_estimee_min":12,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
   "checklist_items":[
     "Enfourner à 220 °C, 4 min : le choc froid/chaud crée la bosse",
     "Baisser à 180 °C, 6 à 7 min pour terminer la cuisson à cœur",
     "Contrôle : bosse nette et centrée, bords blond foncé, cœur souple au doigt",
     "Démouler IMMÉDIATEMENT sur grille — 2 min de plus dans le moule et la madeleine devient sèche"]}
]'::jsonb,
instructions = 'Madeleine — 40 pièces de 45 g par plaque.
La bosse ne vient pas de la levure mais du CHOC THERMIQUE : appareil maturé 12 h
et refroidi à 4 °C, four à 220 °C les 4 premières minutes.

Conservation : 48 h en sachet à température ambiante. Appareil cru : 3 jours à +4 °C.

Déclinaisons : sachet 5 pièces (225 g), sachet mini 12 pièces (168 g).

Allergènes : gluten, œufs, lait.'
WHERE id = 'fab28700-0000-4000-8000-000000000161';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pâte et repos","duree_estimee_min":25,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Beurre POMMADE (18-20 °C) crémé avec cassonade et sucre : ne pas foisonner, on ne cherche pas d''air",
     "Œufs tempérés en 2 fois, farine + levure + sel en une fois, arrêter dès que la pâte se rassemble",
     "Pépites pliées en 10 s",
     "REPOS 12 h à +4 °C : c''est lui qui donne le fondant au cœur et évite l''étalement plat"]},
  {"ordre":2,"nom":"Boulage et surgélation","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Peser 60 g par palet, bouler sans écraser, ne pas aplatir",
     "20 palets par plaque 40x30, espacés de 5 cm : ils doublent de diamètre",
     "Les palets se surgèlent crus et se cuisent à la demande, +2 min de cuisson"]},
  {"ordre":3,"nom":"Cuisson","duree_estimee_min":13,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "180 °C chaleur tournante, 11 à 12 min",
     "Sortir quand le CENTRE EST ENCORE CLAIR et mou : il finit de cuire sur la plaque",
     "Un cookie doré au centre au four sera dur froid",
     "Refroidissement 10 min sur plaque puis grille"]}
]'::jsonb,
instructions = 'Cookie chocolat — 20 palets de 60 g par plaque 40x30.
Repos de pâte 12 h obligatoire ; sortie du four cœur clair.

Déclinaisons sur la même pâte : framboise (chocolat blanc + purée framboise),
pistache (pâte de pistache + pistaches concassées + chocolat blanc).

Conservation : 3 jours en boîte hermétique. Palets crus : 2 mois à -18 °C.

Allergènes : gluten, œufs, lait, soja (lécithine du chocolat).'
WHERE id = 'fab28700-0000-4000-8000-000000000170';

-- Notes de conservation sur les fiches restantes (pas d'etapes detaillees :
-- ce sont des declinaisons des cinq gestes ci-dessus).
UPDATE recipes SET instructions = v.txt
FROM (VALUES
  ('fab28700-0000-4000-8000-000000000130'::uuid, 'Amandine — dacquoise amande, croustillant, mousseline pralinée amande, masquage pâte d''amande. PRS 6/8/10. Conservation 3 j à +4 °C. Allergènes : amande, œufs, lait, gluten.'),
  ('fab28700-0000-4000-8000-000000000131', 'Casablanca — génoise imbibée, ganache montée ivoire, insert fruits rouges, décor chocolat blanc. PRS 6/8/10. Conservation 3 j à +4 °C. Allergènes : œufs, lait, gluten.'),
  ('fab28700-0000-4000-8000-000000000132', 'Ferrero Rocher — dacquoise noisette, croustillant, mousse chocolat au lait, enrobage rocher, noisettes torréfiées. PRS 6/8/10. Conservation 3 j à +4 °C. Allergènes : noisette, amande, œufs, lait, gluten, soja.'),
  ('fab28700-0000-4000-8000-000000000133', 'Feuilles d''automne — fond meringue, génoise cacao, mousse chocolat noir, copeaux. PRS 6/8/10. La meringue s''humidifie : monter le jour même. Conservation 2 j à +4 °C. Allergènes : œufs, lait, gluten, soja.'),
  ('fab28700-0000-4000-8000-000000000134', 'Fraisier — génoise imbibée, crème mousseline vanille, fraises fraîches taillées, pâte d''amande, nappage. Cercle Ø22, ~10 parts. Fraises du jour uniquement. Conservation 48 h à +4 °C. Allergènes : œufs, lait, gluten, amande.'),
  ('fab28700-0000-4000-8000-000000000135', 'Gâteau caramel — dacquoise noisette, croustillant, insert caramel tendre, mousse caramel, miroir cacao. PRS 6/8/10/15. Conservation 3 j à +4 °C. Allergènes : noisette, amande, œufs, lait, gluten.'),
  ('fab28700-0000-4000-8000-000000000136', 'Gâteaux aux fruits — génoise imbibée, crème diplomate, fruits frais (fraise, kiwi, amarena), nappage neutre. Cercle Ø20. Fruits taillés le jour même, nappage obligatoire contre l''oxydation. Conservation 48 h à +4 °C. Allergènes : œufs, lait, gluten, amande.'),
  ('fab28700-0000-4000-8000-000000000137', 'Noisette — dacquoise noisette, croustillant, mousse pralinée, miroir cacao, noisettes torréfiées. PRS 4/6/8/10. Conservation 3 j à +4 °C. Allergènes : noisette, amande, œufs, lait, gluten.'),
  ('fab28700-0000-4000-8000-000000000138', 'Pralino — biscuit cuillère imbibé, mousseline pralinée amande, croustillant, amandes effilées sur le pourtour. PRS 6/8/10. Conservation 3 j à +4 °C. Allergènes : amande, œufs, lait, gluten.'),
  ('fab28700-0000-4000-8000-000000000150', 'Cake nature (quatre-quarts) — moule 25 cm (500 g) ou 15 cm (230 g), tranches 100 g et 80 g. Cuisson 160 °C ~50 min, lame sèche. Conservation 5 j filmé. Allergènes : gluten, œufs, lait.'),
  ('fab28700-0000-4000-8000-000000000151', 'Cake citron — zestes râpés fins dans la pâte, glaçage sucre glace/jus de citron appliqué au pinceau à la sortie du four (le cake tiède boit le glaçage). Conservation 5 j filmé. Allergènes : gluten, œufs, lait.'),
  ('fab28700-0000-4000-8000-000000000153', 'Cake aux fruits secs — amandes concassées et noix torréfiées 150 °C 12 min, roulées dans la farine avant incorporation pour ne pas tomber au fond. Conservation 5 j filmé. Allergènes : gluten, œufs, lait, amande, noix.'),
  ('fab28700-0000-4000-8000-000000000154', 'Cake rocher chocolat — cake chocolat SURGELÉ puis trempé dans le glaçage rocher à 30-32 °C. Un cake tempéré fait couler l''enrobage. Conservation 5 j. Allergènes : gluten, œufs, lait, amande, soja.'),
  ('fab28700-0000-4000-8000-000000000155', 'Cake rocher framboise — cake nature, cœur de compotée de fruits rouges poché à la douille dans la longueur, enrobage rocher. Conservation 4 j à +4 °C. Allergènes : gluten, œufs, lait, amande, soja.'),
  ('fab28700-0000-4000-8000-000000000156', 'Cake rocher fruits secs — cake nature aux amandes et noix, enrobage rocher. Conservation 5 j. Allergènes : gluten, œufs, lait, amande, noix, soja.'),
  ('fab28700-0000-4000-8000-000000000157', 'Cake pistache individuel — moule à cake 8 cm, pâte de pistache dans l''appareil, pistaches concassées sur le dessus. Conservation 4 j filmé. Allergènes : gluten, œufs, lait, pistache.'),
  ('fab28700-0000-4000-8000-000000000158', 'Cake noix individuel — moule à cake 8 cm, cerneaux de noix torréfiés. Conservation 4 j filmé. Allergènes : gluten, œufs, lait, noix.'),
  ('fab28700-0000-4000-8000-000000000159', 'Brownie — 1 plaque 40x30 = 30 carrés de 60 g. Cuisson 170 °C 22 min : le centre doit trembler à la sortie. Découpe à froid, lame chaude essuyée. Conservation 4 j en boîte. Allergènes : gluten, œufs, lait, noix, soja.'),
  ('fab28700-0000-4000-8000-000000000160', 'Financier — beurre noisette filtré, appareil reposé 2 h. Plaque à financiers 40 pièces de 48 g, ou mini 84 pièces de 19 g. Cuisson 200 °C 12 min (8 min pour les minis). Conservation 4 j. Allergènes : gluten, œufs, lait, amande.'),
  ('fab28700-0000-4000-8000-000000000162', 'Madeleine chocolat — appareil madeleine additionné de couverture noire fondue, trempage de la coquille après refroidissement. Même choc thermique que la madeleine nature. Conservation 48 h. Allergènes : gluten, œufs, lait, soja.'),
  ('fab28700-0000-4000-8000-000000000163', 'Madeleine citron — glaçage sucre glace/jus de citron au pinceau sur madeleine tiède, ressuyage 5 min au four à 150 °C pour le fixer. Conservation 48 h. Allergènes : gluten, œufs, lait.'),
  ('fab28700-0000-4000-8000-000000000164', 'Muffin vanille — 12 gros muffins de 95 g par plaque. Caissettes papier, remplissage aux 3/4, sucre grain sur le dessus. Départ 200 °C 5 min puis 175 °C 15 min. Conservation 3 j. Allergènes : gluten, œufs, lait.'),
  ('fab28700-0000-4000-8000-000000000165', 'Muffin chocolat — pépites dans l''appareil ET sur le dessus (celles du dessus ne coulent pas). Départ 200 °C 5 min puis 175 °C 15 min. Conservation 3 j. Allergènes : gluten, œufs, lait, soja.'),
  ('fab28700-0000-4000-8000-000000000166', 'Mini-muffin choco-vanille — 48 pièces de 36 g, marbrage à la pointe de couteau (2 tours, pas plus). Cuisson 180 °C 12 min. Conservation 3 j. Allergènes : gluten, œufs, lait, soja.'),
  ('fab28700-0000-4000-8000-000000000167', 'Tigré — appareil financier cacao à pépites cuit en moule savarin, cœur de ganache noire coulé après refroidissement. Grand 55 g (15/plaque), mini 22 g (84/plaque), sachet 10 minis (220 g). Cuisson 190 °C 14 min. Conservation 4 j. Allergènes : gluten, œufs, lait, amande, soja.'),
  ('fab28700-0000-4000-8000-000000000168', 'Tigré caramel — cœur caramel tendre puis voile de ganache lait. Conservation 4 j. Allergènes : gluten, œufs, lait, amande, soja.'),
  ('fab28700-0000-4000-8000-000000000169', 'Tigré pistache — cœur de ganache montée ivoire à la pâte de pistache, pistaches concassées. Conservation 4 j. Allergènes : gluten, œufs, lait, amande, pistache, soja.'),
  ('fab28700-0000-4000-8000-000000000171', 'Cookie framboise — même pâte que le cookie chocolat, chocolat blanc en pépites et purée de framboise pochée en 3 points par palet. Conservation 3 j. Allergènes : gluten, œufs, lait, soja.'),
  ('fab28700-0000-4000-8000-000000000172', 'Cookie pistache — pâte de pistache dans la pâte, pistaches concassées et chocolat blanc. Conservation 3 j. Allergènes : gluten, œufs, lait, pistache, soja.'),
  ('fab28700-0000-4000-8000-000000000173', 'Cake design — PRODUIT SUR COMMANDE. 2 étages de génoise imbibée, mousseline vanille, insert fruits rouges, masquage puis pâte à sucre. Cercle haut Ø20, ~2,6 kg, 20 à 24 parts. Le prix (750 DH) paie la mise en forme et le décor, pas la matière : le ratio matière/prix est volontairement bas. Commande 72 h à l''avance. Conservation 48 h à +4 °C, sortir 1 h avant service (la pâte à sucre sue au froid). Allergènes : gluten, œufs, lait.'),
  ('fab28700-0000-4000-8000-000000000174', 'Tarte Myrtille — tartelette Ø10 cm : fond de pâte sucrée cuit à blanc, crème d''amande, myrtilles surgelées disposées serrées avant cuisson (160 °C 25 min), nappage neutre à la sortie. Conservation 48 h à +4 °C. Allergènes : gluten, œufs, lait, amande.')
) AS v (id, txt)
WHERE recipes.id = v.id;
