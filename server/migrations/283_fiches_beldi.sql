-- Migration 283 : Fiches techniques BELDI — 26 preparations de base, 31 fiches
--                  produit, 56 formats (les 56 references du catalogue BELDI).
--
-- POURQUOI
--   Le catalogue BELDI vendait 56 references sans une seule fiche technique :
--   aucun cout de revient, aucune nomenclature, aucun besoin matiere calculable
--   pour un plan de production. Cette migration monte la famille entiere sur le
--   modele de l'Opera (mig 273/276) : des preparations de base partagees, des
--   produits composes, et un format par reference vendue.
--
-- ─── LECTURE DU CATALOGUE : 56 PRODUITS, 31 RECETTES ───
--   Le catalogue est un historique de caisse, pas un referentiel : la meme
--   patisserie y apparait sous plusieurs orthographes et plusieurs poids.
--     « FEKKASS NATURE 250G », « FEKKASS NATURE 500G », « FEKKASS NATURE 1KG »
--     et « Fekkass nature 200g »  =  UNE recette, QUATRE formats.
--     « GHERIBA BAHLA » / « Ghriba … »  =  la meme ghriba, deux graphies.
--   On regroupe donc par patisserie reelle : 31 fiches portent 56 formats, un
--   par product_id. Aucun produit n'est laisse sans fiche.
--
-- ─── CONVENTION DE FORMAT : LE SACHET, PAS LA PIECE ───
--   Le beldi se vend au poids. Un format = un sachet ou une barquette :
--     contenant_id     = NULL  (pas de cadre, pas de cercle)
--     quantite_par_format = poids NET du sachet en g (200, 250, 500, 1000…)
--     nb_par_defaut    = 1     (un sachet)
--   La nomenclature d'un format somme donc exactement au poids du sachet.
--   recipes.yield_quantity porte, lui, le NOMBRE DE GATEAUX du sachet par
--   defaut (corne de gazelle 20 g -> 50 pieces au kilo, ghriba 25 g -> 40,
--   tranche de fekkas 8 g -> 125) : c'est ce qui donne un cout a la piece.
--
-- ─── OU EST LA PERTE DE CUISSON ───
--   Les composants d'un format sont des poids NETS (regle de la mig 276). Pour
--   un gateau sec, le net c'est le poids CUIT : la perte de cuisson est donc
--   portee par le perte_standard_pct de la pate, pas par la ligne de format.
--     ghriba / fekkas (four sec, double cuisson)  10-14 %
--     corne de gazelle (four doux 160 °C)          10 % pate, 4 % farce
--     maamoul                                      10 %
--     batbout (plancha)                            12 %
--   Une fiche de 1 kg de ghriba consomme donc 1 000 / 0,88 = 1 136 g de pate
--   crue : c'est le calcul que fait v_recipe_total_cost.
--
-- ─── RENDEMENT > 100 % : CHEBAKIA, MAKROUT, BRIOUATE ───
--   Ces trois familles sont FRITES puis TREMPEES. Elles ne perdent pas de
--   poids : elles en gagnent. Un kilo de chebakia vendu, c'est
--     560 g de pate  +  90 g d'huile absorbee a la friture
--                    + 330 g de sirop au miel  +  20 g de sesame  = 1 000 g
--   La pate a chebakia porte donc perte_standard_pct = 0 (l'eau perdue a la
--   friture est compensee par l'huile prise), et l'huile absorbee comme le
--   sirop sont des LIGNES DE NOMENCLATURE a part entiere, role « imbibage » et
--   « nappage ». Sans ces deux lignes, le miel — qui est le premier poste de
--   cout de la chebakia — n'apparaitrait nulle part.
--
-- ─── ASSORTIMENT « BELDI MAROCAIN KG » ───
--   Le kilo d'assortiment est bati sur les PREPARATIONS des six patisseries
--   qu'il melange (corne, ghriba bahla, fekkas, sable, maamoul, briouate), et
--   non sur les fiches produit elles-memes. Raison technique : dans
--   v_recipe_total_cost, un parent compose divise la quantite du composant par
--   le yield_quantity de l'enfant. Nos fiches produit ont un yield EN PIECES ;
--   referencer « 150 g de corne de gazelle » y serait lu comme 150 fournees.
--   Passer par les bases donne le meme cout matiere, sans l'erreur d'unite.
--
-- ─── INGREDIENTS CREES (6) — PRIX A VALIDER ───
--   Deux d'entre eux corrigent un piege du referentiel :
--   1. « Eau de fleur d''oranger » existe en unite « unit » a 235,00 DH (un
--      bidon), avec un historique d'achat allant de 4 a 235 DH. Les fiches
--      beldi la pesent en grammes : fn_unit_conv(g -> unit) retombe sur son
--      facteur neutre 1, donc 55 g de fleur d'oranger seraient factures
--      12 925 DH. On cree « Eau de fleur d''oranger (litre) », en litres, avec
--      densite 1,000 — l'ancienne fiche reste pour le stock existant.
--   2. « Miel » existe en « unit » a 5,00 DH : inexploitable au gramme pour un
--      sirop de chebakia. On cree « Miel liquide » en kg.
--   Les quatre autres manquaient simplement : noix de coco rapee, gomme
--   arabique (le liant de la farce d'amande), lait concentre sucre, raisins
--   secs. Les noms « Noix de coco rapee » et « Raisins secs » sont ceux
--   qu'emploient les mig 286 et 282 : leurs INSERT gardes deviendront des
--   no-op, on ne cree pas un doublon de plus.
--
-- PORTEE
--   + 6 ingredients crees, 1 densite posee (vinaigre)
--   + 26 recettes de base (fab28300…0101-0126) et leurs ingredients
--   + 31 fiches produit composees (…0131-0161)
--   + 56 recipe_formats (…0201-0256), un par product_id du catalogue
--   + ~150 recipe_format_components + le miroir recipe_components
--   + etapes de production sur 4 fiches phares
--   Idempotent : ON CONFLICT (id) DO NOTHING sur les UUID fixes,
--   DELETE + INSERT sur toutes les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab28300-0000-4000-8000-%';
--     (cascade : formats, composants, miroir)
--   DELETE FROM ingredients WHERE name IN ('Noix de coco râpée','Raisins secs',
--     'Gomme arabique moulue','Lait concentré sucré','Miel liquide',
--     'Eau de fleur d''oranger (litre)');
--   UPDATE ingredients SET densite_kg_l = NULL WHERE name = 'Vinaigre blanc';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ingredients manquants. Prix marche marocain 2026, en DH/kg (ou DH/l).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category, densite_kg_l)
SELECT v.name, v.unit, v.cost, v.cat, v.dens
FROM (VALUES
  -- Nom aligne sur la mig 286 (qui la cree aussi, en INSERT garde) pour ne pas
  -- ajouter un doublon au referentiel.
  ('Noix de coco râpée',             'kg', 45.00::numeric, 'fruits_secs',       NULL::numeric), -- PRIX À VALIDER
  -- Nom aligne sur la mig 282, meme raison.
  ('Raisins secs',                   'kg', 45.00,          'fruits_secs',       NULL),          -- PRIX À VALIDER
  -- Le liant de la farce d'amande marocaine (« meska »). Cher au kilo, dose a
  -- 4 g au kilo de farce : 1,40 DH par fournee.
  ('Gomme arabique moulue',          'kg', 350.00,         'epices',            NULL),          -- PRIX À VALIDER
  ('Lait concentré sucré',           'kg', 55.00,          'produits_laitiers', NULL),          -- PRIX À VALIDER
  -- Cf. hypothese 2 en tete : « Miel » existe en unite « unit » a 5 DH.
  ('Miel liquide',                   'kg', 70.00,          'sucres',            NULL),          -- PRIX À VALIDER
  -- Cf. hypothese 1 en tete. Densite 1,000 obligatoire : la mig 288 refuse un
  -- ingredient en volume sans densite.
  ('Eau de fleur d''oranger (litre)', 'l', 18.00,          'epices',            1.000)          -- PRIX À VALIDER
) AS v (name, unit, cost, cat, dens)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.name));

-- Le vinaigre entre dans la pate a chebakia, pese en grammes, et il est stocke
-- en litres : meme piege que l'huile en mig 276. Valeur alignee sur la mig 288.
UPDATE ingredients SET densite_kg_l = 1.010
 WHERE name = 'Vinaigre blanc' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Resolution des ingredients. Le referentiel a des doublons ("Beurre" x3,
--    "Sucre semoule" x2, "Noix decortiquees" en kg ET en g) : on retient celui
--    qui est reellement utilise par les recettes existantes, puis — a egalite —
--    celui qui a un prix. L'ordre `unit_cost DESC` est la pour ecarter les
--    fiches a 0,00 DH ("Son de ble", "Amandes entieres"), qui couteraient zero
--    en silence.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _beldi_ing;
CREATE TEMP TABLE _beldi_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande poudre', 'Amande concassée', 'Amande effilée',
  'Sucre glace', 'Sucre semoule', 'SUCRE CASSONADE',
  'Beurre', 'Farine Fleur', 'Farine Complète', 'Semoule fine', 'Maïzena',
  'Eau', 'Levure chimique', 'Levure fraîche', 'Huile de table',
  'Oeufs entiers liquides', 'Oeufs Jaune', 'Blancs d''œufs liquides pasteurisés',
  'Crème fraîche', 'Fromage Edam', 'Lait concentré sucré',
  'Cannelle moulue', 'Curcuma moulu', 'Poivre noir moulu', 'Vanille poudre',
  'Grains de sésame', 'Grains anis vert', 'Gomme arabique moulue',
  'Pate de dattes', 'Noix décortiquées', 'Raisins secs', 'Mélange de graines',
  'Noix de coco râpée', 'Miel liquide', 'Eau de fleur d''oranger (litre)',
  'Sel de table fin', 'Vinaigre blanc', 'Extrait de café liquide',
  'Cacao en poudre 10/12', 'Chocolat de couverture Noir 55%',
  'Chocolat cookies drops', 'Feuilles de pastilla', 'Pâte d''amande 50%',
  'Confiure', 'Filet de poulet', 'Oignon'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         COALESCE(i.unit_cost, 0) DESC,
         i.created_at;

-- Garde-fou : mieux vaut echouer ici que livrer une fiche amputee dont le cout
-- serait silencieusement faux.
DO $$
DECLARE n INT; noms TEXT;
BEGIN
  SELECT count(*) INTO n FROM _beldi_ing;
  IF n <> 46 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 46 attendus', n;
  END IF;
  SELECT string_agg(b.name, ', ') INTO noms
    FROM _beldi_ing b JOIN ingredients i ON i.id = b.id
   WHERE COALESCE(i.unit_cost, 0) = 0;
  IF noms IS NOT NULL THEN
    RAISE EXCEPTION 'Ingredients a cout nul (le cout de revient serait faux) : %', noms;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les 26 preparations de base.
--    yield_quantity = pesee CRUE, perte_standard_pct = perte de transformation
--    (cuisson pour les pates, dessiccation pour les farces, evaporation pour le
--    sirop). Le net sort du calcul, on ne le met jamais dans yield.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production'),
       v.notes
FROM (VALUES
  ('fab28300-0000-4000-8000-000000000101'::uuid, 'Farce amande corne de gazelle', 1000::numeric,  4::numeric,
   'Amandes mondees moulues au dernier moment. Repos 12 h au froid avant faconnage : la farce se travaille en boudins sans coller. 4 jours a +4 °C.'),
  ('fab28300-0000-4000-8000-000000000102', 'Pâte à corne de gazelle',      1000,  10,
   'Petrissage court, beurre FONDU tiede. Repos 30 min sous film. Abaisse quasi transparente : on doit lire a travers.'),
  ('fab28300-0000-4000-8000-000000000103', 'Pâte à ghriba bahla',          1000,  12,
   'Pate sablee a l''huile, jamais petrie : on serre a la main jusqu''a la boule. Trop travaillee, la ghriba ne craquelle plus.'),
  ('fab28300-0000-4000-8000-000000000104', 'Pâte à ghriba café',           1000,  12,
   'Extrait de cafe incorpore aux oeufs, jamais a la farine seche (grumeaux).'),
  ('fab28300-0000-4000-8000-000000000105', 'Pâte à ghriba coco',           1000,  10,
   'Coco hydrate 20 min dans les oeufs sucres avant d''ajouter la farine.'),
  ('fab28300-0000-4000-8000-000000000106', 'Pâte à ghriba louza',          1000,  10,
   'Semoule fine hydratee 30 min. Amande poudre incorporee en dernier.'),
  ('fab28300-0000-4000-8000-000000000107', 'Pâte à ghriba nature',         1000,  12, NULL),
  ('fab28300-0000-4000-8000-000000000108', 'Pâte à ghriba fromage',        1000,  12,
   'Edam rape fin, incorpore froid. Version salee-sucree du comptoir beldi.'),
  ('fab28300-0000-4000-8000-000000000109', 'Pâte à fekkas nature',         1000,  14,
   'Pate en boudins, premiere cuisson 180 °C, refroidissement COMPLET (12 h), tranchage 8 mm, seconde cuisson 150 °C jusqu''a sec.'),
  ('fab28300-0000-4000-8000-000000000110', 'Pâte à fekkas complet',        1000,  14,
   'Farine complete + graines. Hydratation superieure de 5 % a la version nature.'),
  ('fab28300-0000-4000-8000-000000000111', 'Pâte à fekkas noix',           1000,  14, NULL),
  ('fab28300-0000-4000-8000-000000000112', 'Pâte à fekkas raisin',         1000,  14,
   'Raisins rehydrates a l''eau tiede puis egouttes et farines : sinon ils tombent au fond du boudin.'),
  ('fab28300-0000-4000-8000-000000000113', 'Pâte à fekkas crème',          1000,  14, NULL),
  ('fab28300-0000-4000-8000-000000000114', 'Farce datte maamoul',          1000,   3,
   'Pate de dattes assouplie au beurre tiede et a la fleur d''oranger. Boulee a 12 g.'),
  ('fab28300-0000-4000-8000-000000000115', 'Pâte maamoul semoule',         1000,  10,
   'Semoule ebouillantee au beurre chaud, repos 4 h minimum (idealement une nuit) : c''est ce repos qui donne le fondant.'),
  ('fab28300-0000-4000-8000-000000000116', 'Pâte à chebakia',              1000,   0,
   'perte_standard = 0 : l''eau perdue a la friture est compensee par l''huile absorbee, comptee en ligne de nomenclature. Repos 1 h avant faconnage des rosaces.'),
  ('fab28300-0000-4000-8000-000000000117', 'Sirop au miel chebakia',       1000,   5,
   'Miel + fleur d''oranger maintenus a 80 °C. JAMAIS bouillant : le miel amerise. 5 % d''evaporation sur la duree du trempage.'),
  ('fab28300-0000-4000-8000-000000000118', 'Pâte à boule de neige',        1000,   8, NULL),
  ('fab28300-0000-4000-8000-000000000119', 'Pâte boule coco lait concentré', 1000,  2,
   'Aucune cuisson : la perte est celle du faconnage. 5 jours a +4 °C.'),
  ('fab28300-0000-4000-8000-000000000120', 'Pâte à sablé beldi',           1000,  10, NULL),
  ('fab28300-0000-4000-8000-000000000121', 'Pâte diamantine chocolat',     1000,  10,
   'Boudins roules dans la cassonade, raffermis 2 h au froid, tranches a 8 mm.'),
  ('fab28300-0000-4000-8000-000000000122', 'Pâte à cookies spécial',       1000,  10, NULL),
  ('fab28300-0000-4000-8000-000000000123', 'Pâte à makrout',               1000,   0,
   'perte_standard = 0 : produit frit, cf. pate a chebakia.'),
  ('fab28300-0000-4000-8000-000000000124', 'Farce amande grillée briouate', 1000,  3,
   'Amandes concassees TORREFIEES 12 min a 160 °C avant broyage : c''est la grillade qui fait la briouate.'),
  ('fab28300-0000-4000-8000-000000000125', 'Farce salée poulet-fromage',   1000,  20,
   'Poulet cuit puis effiloche : 20 % de perte a la cuisson de la farce.'),
  ('fab28300-0000-4000-8000-000000000126', 'Pâte à batbout',               1405,  12,
   'Pointage 1 h, faconnage en disques de 100 g, apprêt 30 min, cuisson a la plancha 3 min par face.')
) AS v (id, nom, yield, perte, notes)
ON CONFLICT (id) DO NOTHING;

-- Compositions des bases : DELETE + INSERT pour que la migration soit rejouable.
DELETE FROM recipe_ingredients ri
 USING recipes r
 WHERE r.id = ri.recipe_id
   AND r.id::text LIKE 'fab28300-0000-4000-8000-%'
   AND r.is_base;

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette, ing.id, v.qte, 'g'
FROM (VALUES
  -- ── 101 Farce amande corne de gazelle — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000101'::uuid, 'Amande poudre',                    625::numeric),
  ('fab28300-0000-4000-8000-000000000101', 'Sucre glace',                            250),
  ('fab28300-0000-4000-8000-000000000101', 'Beurre',                                  60),
  ('fab28300-0000-4000-8000-000000000101', 'Eau de fleur d''oranger (litre)',         55),
  ('fab28300-0000-4000-8000-000000000101', 'Cannelle moulue',                          6),
  ('fab28300-0000-4000-8000-000000000101', 'Gomme arabique moulue',                    4),
  -- ── 102 Pâte à corne de gazelle — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000102', 'Farine Fleur',                           620),
  ('fab28300-0000-4000-8000-000000000102', 'Eau',                                    200),
  ('fab28300-0000-4000-8000-000000000102', 'Beurre',                                  90),
  ('fab28300-0000-4000-8000-000000000102', 'Eau de fleur d''oranger (litre)',         60),
  ('fab28300-0000-4000-8000-000000000102', 'Oeufs Jaune',                             25),
  ('fab28300-0000-4000-8000-000000000102', 'Sel de table fin',                         5),
  -- ── 103 Pâte à ghriba bahla — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000103', 'Farine Fleur',                           340),
  ('fab28300-0000-4000-8000-000000000103', 'Sucre glace',                            200),
  ('fab28300-0000-4000-8000-000000000103', 'Huile de table',                         170),
  ('fab28300-0000-4000-8000-000000000103', 'Amande poudre',                          130),
  ('fab28300-0000-4000-8000-000000000103', 'Beurre',                                  60),
  ('fab28300-0000-4000-8000-000000000103', 'Oeufs entiers liquides',                  60),
  ('fab28300-0000-4000-8000-000000000103', 'Grains de sésame',                        30),
  ('fab28300-0000-4000-8000-000000000103', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000103', 'Sel de table fin',                         2),
  -- ── 104 Pâte à ghriba café — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000104', 'Farine Fleur',                           250),
  ('fab28300-0000-4000-8000-000000000104', 'Amande poudre',                          250),
  ('fab28300-0000-4000-8000-000000000104', 'Sucre glace',                            190),
  ('fab28300-0000-4000-8000-000000000104', 'Beurre',                                 120),
  ('fab28300-0000-4000-8000-000000000104', 'Huile de table',                          80),
  ('fab28300-0000-4000-8000-000000000104', 'Oeufs entiers liquides',                  70),
  ('fab28300-0000-4000-8000-000000000104', 'Extrait de café liquide',                 15),
  ('fab28300-0000-4000-8000-000000000104', 'Grains de sésame',                        15),
  ('fab28300-0000-4000-8000-000000000104', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000104', 'Sel de table fin',                         2),
  -- ── 105 Pâte à ghriba coco — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000105', 'Noix de coco râpée',                     340),
  ('fab28300-0000-4000-8000-000000000105', 'Sucre semoule',                          260),
  ('fab28300-0000-4000-8000-000000000105', 'Oeufs entiers liquides',                 220),
  ('fab28300-0000-4000-8000-000000000105', 'Farine Fleur',                           120),
  ('fab28300-0000-4000-8000-000000000105', 'Beurre',                                  50),
  ('fab28300-0000-4000-8000-000000000105', 'Levure chimique',                          5),
  ('fab28300-0000-4000-8000-000000000105', 'Sel de table fin',                         5),
  -- ── 106 Pâte à ghriba louza — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000106', 'Semoule fine',                           250),
  ('fab28300-0000-4000-8000-000000000106', 'Amande poudre',                          220),
  ('fab28300-0000-4000-8000-000000000106', 'Farine Fleur',                           180),
  ('fab28300-0000-4000-8000-000000000106', 'Sucre glace',                            180),
  ('fab28300-0000-4000-8000-000000000106', 'Huile de table',                          90),
  ('fab28300-0000-4000-8000-000000000106', 'Oeufs entiers liquides',                  70),
  ('fab28300-0000-4000-8000-000000000106', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000106', 'Eau de fleur d''oranger (litre)',          2),
  -- ── 107 Pâte à ghriba nature — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000107', 'Farine Fleur',                           420),
  ('fab28300-0000-4000-8000-000000000107', 'Sucre glace',                            200),
  ('fab28300-0000-4000-8000-000000000107', 'Beurre',                                 130),
  ('fab28300-0000-4000-8000-000000000107', 'Oeufs entiers liquides',                  90),
  ('fab28300-0000-4000-8000-000000000107', 'Huile de table',                          80),
  ('fab28300-0000-4000-8000-000000000107', 'Amande poudre',                           60),
  ('fab28300-0000-4000-8000-000000000107', 'Grains de sésame',                         8),
  ('fab28300-0000-4000-8000-000000000107', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000107', 'Vanille poudre',                           2),
  ('fab28300-0000-4000-8000-000000000107', 'Sel de table fin',                         2),
  -- ── 108 Pâte à ghriba fromage — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000108', 'Farine Fleur',                           430),
  ('fab28300-0000-4000-8000-000000000108', 'Sucre glace',                            130),
  ('fab28300-0000-4000-8000-000000000108', 'Beurre',                                 130),
  ('fab28300-0000-4000-8000-000000000108', 'Oeufs entiers liquides',                 110),
  ('fab28300-0000-4000-8000-000000000108', 'Fromage Edam',                            90),
  ('fab28300-0000-4000-8000-000000000108', 'Huile de table',                          80),
  ('fab28300-0000-4000-8000-000000000108', 'Grains de sésame',                        20),
  ('fab28300-0000-4000-8000-000000000108', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000108', 'Sel de table fin',                         2),
  -- ── 109 Pâte à fekkas nature — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000109', 'Farine Fleur',                           380),
  ('fab28300-0000-4000-8000-000000000109', 'Sucre semoule',                          190),
  ('fab28300-0000-4000-8000-000000000109', 'Amande concassée',                       150),
  ('fab28300-0000-4000-8000-000000000109', 'Oeufs entiers liquides',                 145),
  ('fab28300-0000-4000-8000-000000000109', 'Beurre',                                  85),
  ('fab28300-0000-4000-8000-000000000109', 'Grains de sésame',                        35),
  ('fab28300-0000-4000-8000-000000000109', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000109', 'Grains anis vert',                         5),
  ('fab28300-0000-4000-8000-000000000109', 'Sel de table fin',                         2),
  -- ── 110 Pâte à fekkas complet — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000110', 'Farine Complète',                        280),
  ('fab28300-0000-4000-8000-000000000110', 'Sucre semoule',                          160),
  ('fab28300-0000-4000-8000-000000000110', 'Oeufs entiers liquides',                 140),
  ('fab28300-0000-4000-8000-000000000110', 'Amande concassée',                       125),
  ('fab28300-0000-4000-8000-000000000110', 'Farine Fleur',                            90),
  ('fab28300-0000-4000-8000-000000000110', 'Beurre',                                  80),
  ('fab28300-0000-4000-8000-000000000110', 'Mélange de graines',                      75),
  ('fab28300-0000-4000-8000-000000000110', 'Grains de sésame',                        38),
  ('fab28300-0000-4000-8000-000000000110', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000110', 'Sel de table fin',                         4),
  -- ── 111 Pâte à fekkas noix — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000111', 'Farine Fleur',                           375),
  ('fab28300-0000-4000-8000-000000000111', 'Noix décortiquées',                      200),
  ('fab28300-0000-4000-8000-000000000111', 'Sucre semoule',                          180),
  ('fab28300-0000-4000-8000-000000000111', 'Oeufs entiers liquides',                 145),
  ('fab28300-0000-4000-8000-000000000111', 'Beurre',                                  85),
  ('fab28300-0000-4000-8000-000000000111', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000111', 'Grains de sésame',                         5),
  ('fab28300-0000-4000-8000-000000000111', 'Sel de table fin',                         2),
  -- ── 112 Pâte à fekkas raisin — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000112', 'Farine Fleur',                           320),
  ('fab28300-0000-4000-8000-000000000112', 'Sucre semoule',                          175),
  ('fab28300-0000-4000-8000-000000000112', 'Raisins secs',                           160),
  ('fab28300-0000-4000-8000-000000000112', 'Oeufs entiers liquides',                 145),
  ('fab28300-0000-4000-8000-000000000112', 'Amande concassée',                       100),
  ('fab28300-0000-4000-8000-000000000112', 'Beurre',                                  85),
  ('fab28300-0000-4000-8000-000000000112', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000112', 'Grains de sésame',                         5),
  ('fab28300-0000-4000-8000-000000000112', 'Sel de table fin',                         2),
  -- ── 113 Pâte à fekkas crème — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000113', 'Farine Fleur',                           350),
  ('fab28300-0000-4000-8000-000000000113', 'Sucre semoule',                          170),
  ('fab28300-0000-4000-8000-000000000113', 'Crème fraîche',                          150),
  ('fab28300-0000-4000-8000-000000000113', 'Oeufs entiers liquides',                 140),
  ('fab28300-0000-4000-8000-000000000113', 'Amande concassée',                        90),
  ('fab28300-0000-4000-8000-000000000113', 'Beurre',                                  80),
  ('fab28300-0000-4000-8000-000000000113', 'Grains de sésame',                        10),
  ('fab28300-0000-4000-8000-000000000113', 'Levure chimique',                          8),
  ('fab28300-0000-4000-8000-000000000113', 'Sel de table fin',                         2),
  -- ── 114 Farce datte maamoul — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000114', 'Pate de dattes',                         850),
  ('fab28300-0000-4000-8000-000000000114', 'Beurre',                                  80),
  ('fab28300-0000-4000-8000-000000000114', 'Eau de fleur d''oranger (litre)',         50),
  ('fab28300-0000-4000-8000-000000000114', 'Cannelle moulue',                         10),
  ('fab28300-0000-4000-8000-000000000114', 'Huile de table',                          10),
  -- ── 115 Pâte maamoul semoule — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000115', 'Semoule fine',                           400),
  ('fab28300-0000-4000-8000-000000000115', 'Beurre',                                 280),
  ('fab28300-0000-4000-8000-000000000115', 'Farine Fleur',                           110),
  ('fab28300-0000-4000-8000-000000000115', 'Amande poudre',                          100),
  ('fab28300-0000-4000-8000-000000000115', 'Sucre glace',                             60),
  ('fab28300-0000-4000-8000-000000000115', 'Eau de fleur d''oranger (litre)',         40),
  ('fab28300-0000-4000-8000-000000000115', 'Levure chimique',                          5),
  ('fab28300-0000-4000-8000-000000000115', 'Sel de table fin',                         5),
  -- ── 116 Pâte à chebakia — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000116', 'Farine Fleur',                           480),
  ('fab28300-0000-4000-8000-000000000116', 'Grains de sésame',                       120),
  ('fab28300-0000-4000-8000-000000000116', 'Amande poudre',                           80),
  ('fab28300-0000-4000-8000-000000000116', 'Eau',                                     80),
  ('fab28300-0000-4000-8000-000000000116', 'Beurre',                                  60),
  ('fab28300-0000-4000-8000-000000000116', 'Huile de table',                          60),
  ('fab28300-0000-4000-8000-000000000116', 'Oeufs entiers liquides',                  60),
  ('fab28300-0000-4000-8000-000000000116', 'Eau de fleur d''oranger (litre)',         30),
  ('fab28300-0000-4000-8000-000000000116', 'Vinaigre blanc',                          10),
  ('fab28300-0000-4000-8000-000000000116', 'Cannelle moulue',                          6),
  ('fab28300-0000-4000-8000-000000000116', 'Grains anis vert',                         5),
  ('fab28300-0000-4000-8000-000000000116', 'Levure fraîche',                           4),
  ('fab28300-0000-4000-8000-000000000116', 'Curcuma moulu',                            3),
  ('fab28300-0000-4000-8000-000000000116', 'Sel de table fin',                         2),
  -- ── 117 Sirop au miel chebakia — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000117', 'Miel liquide',                           900),
  ('fab28300-0000-4000-8000-000000000117', 'Eau de fleur d''oranger (litre)',         60),
  ('fab28300-0000-4000-8000-000000000117', 'Eau',                                     40),
  -- ── 118 Pâte à boule de neige — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000118', 'Farine Fleur',                           400),
  ('fab28300-0000-4000-8000-000000000118', 'Beurre',                                 250),
  ('fab28300-0000-4000-8000-000000000118', 'Sucre glace',                            130),
  ('fab28300-0000-4000-8000-000000000118', 'Maïzena',                                100),
  ('fab28300-0000-4000-8000-000000000118', 'Noix de coco râpée',                      60),
  ('fab28300-0000-4000-8000-000000000118', 'Oeufs Jaune',                             40),
  ('fab28300-0000-4000-8000-000000000118', 'Eau de fleur d''oranger (litre)',         15),
  ('fab28300-0000-4000-8000-000000000118', 'Sel de table fin',                         3),
  ('fab28300-0000-4000-8000-000000000118', 'Vanille poudre',                           2),
  -- ── 119 Pâte boule coco lait concentré — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000119', 'Noix de coco râpée',                     350),
  ('fab28300-0000-4000-8000-000000000119', 'Lait concentré sucré',                   240),
  ('fab28300-0000-4000-8000-000000000119', 'Sucre glace',                            220),
  ('fab28300-0000-4000-8000-000000000119', 'Beurre',                                  90),
  ('fab28300-0000-4000-8000-000000000119', 'Amande poudre',                           70),
  ('fab28300-0000-4000-8000-000000000119', 'Eau de fleur d''oranger (litre)',         25),
  ('fab28300-0000-4000-8000-000000000119', 'Sel de table fin',                         3),
  ('fab28300-0000-4000-8000-000000000119', 'Vanille poudre',                           2),
  -- ── 120 Pâte à sablé beldi — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000120', 'Farine Fleur',                           420),
  ('fab28300-0000-4000-8000-000000000120', 'Beurre',                                 230),
  ('fab28300-0000-4000-8000-000000000120', 'Sucre glace',                            170),
  ('fab28300-0000-4000-8000-000000000120', 'Oeufs entiers liquides',                  90),
  ('fab28300-0000-4000-8000-000000000120', 'Amande poudre',                           70),
  ('fab28300-0000-4000-8000-000000000120', 'Maïzena',                                 10),
  ('fab28300-0000-4000-8000-000000000120', 'Levure chimique',                          5),
  ('fab28300-0000-4000-8000-000000000120', 'Sel de table fin',                         3),
  ('fab28300-0000-4000-8000-000000000120', 'Vanille poudre',                           2),
  -- ── 121 Pâte diamantine chocolat — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000121', 'Farine Fleur',                           400),
  ('fab28300-0000-4000-8000-000000000121', 'Beurre',                                 250),
  ('fab28300-0000-4000-8000-000000000121', 'Sucre glace',                            160),
  ('fab28300-0000-4000-8000-000000000121', 'Amande poudre',                           70),
  ('fab28300-0000-4000-8000-000000000121', 'Cacao en poudre 10/12',                   60),
  ('fab28300-0000-4000-8000-000000000121', 'Oeufs Jaune',                             50),
  ('fab28300-0000-4000-8000-000000000121', 'Chocolat cookies drops',                   5),
  ('fab28300-0000-4000-8000-000000000121', 'Sel de table fin',                         3),
  ('fab28300-0000-4000-8000-000000000121', 'Vanille poudre',                           2),
  -- ── 122 Pâte à cookies spécial — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000122', 'Farine Fleur',                           380),
  ('fab28300-0000-4000-8000-000000000122', 'Beurre',                                 200),
  ('fab28300-0000-4000-8000-000000000122', 'SUCRE CASSONADE',                        120),
  ('fab28300-0000-4000-8000-000000000122', 'Chocolat cookies drops',                 120),
  ('fab28300-0000-4000-8000-000000000122', 'Oeufs entiers liquides',                  90),
  ('fab28300-0000-4000-8000-000000000122', 'Sucre semoule',                           60),
  ('fab28300-0000-4000-8000-000000000122', 'Noix décortiquées',                       20),
  ('fab28300-0000-4000-8000-000000000122', 'Levure chimique',                          6),
  ('fab28300-0000-4000-8000-000000000122', 'Sel de table fin',                         2),
  ('fab28300-0000-4000-8000-000000000122', 'Vanille poudre',                           2),
  -- ── 123 Pâte à makrout — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000123', 'Semoule fine',                           700),
  ('fab28300-0000-4000-8000-000000000123', 'Beurre',                                 180),
  ('fab28300-0000-4000-8000-000000000123', 'Eau',                                     80),
  ('fab28300-0000-4000-8000-000000000123', 'Eau de fleur d''oranger (litre)',         30),
  ('fab28300-0000-4000-8000-000000000123', 'Sel de table fin',                         5),
  ('fab28300-0000-4000-8000-000000000123', 'Sucre semoule',                            5),
  -- ── 124 Farce amande grillée briouate — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000124', 'Amande concassée',                       700),
  ('fab28300-0000-4000-8000-000000000124', 'Sucre glace',                            200),
  ('fab28300-0000-4000-8000-000000000124', 'Beurre',                                  40),
  ('fab28300-0000-4000-8000-000000000124', 'Eau de fleur d''oranger (litre)',         40),
  ('fab28300-0000-4000-8000-000000000124', 'Cannelle moulue',                         15),
  ('fab28300-0000-4000-8000-000000000124', 'Gomme arabique moulue',                    5),
  -- ── 125 Farce salée poulet-fromage — 1 000 g crus
  ('fab28300-0000-4000-8000-000000000125', 'Filet de poulet',                        500),
  ('fab28300-0000-4000-8000-000000000125', 'Oignon',                                 130),
  ('fab28300-0000-4000-8000-000000000125', 'Oeufs entiers liquides',                 130),
  ('fab28300-0000-4000-8000-000000000125', 'Fromage Edam',                           100),
  ('fab28300-0000-4000-8000-000000000125', 'Crème fraîche',                           80),
  ('fab28300-0000-4000-8000-000000000125', 'Huile de table',                          45),
  ('fab28300-0000-4000-8000-000000000125', 'Sel de table fin',                        10),
  ('fab28300-0000-4000-8000-000000000125', 'Curcuma moulu',                            3),
  ('fab28300-0000-4000-8000-000000000125', 'Poivre noir moulu',                        2),
  -- ── 126 Pâte à batbout — 1 405 g crus
  ('fab28300-0000-4000-8000-000000000126', 'Farine Fleur',                           600),
  ('fab28300-0000-4000-8000-000000000126', 'Eau',                                    520),
  ('fab28300-0000-4000-8000-000000000126', 'Semoule fine',                           250),
  ('fab28300-0000-4000-8000-000000000126', 'Levure fraîche',                          15),
  ('fab28300-0000-4000-8000-000000000126', 'Sel de table fin',                        12),
  ('fab28300-0000-4000-8000-000000000126', 'Sucre semoule',                            8)
) AS v (recette, ingredient, qte)
JOIN _beldi_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 31 fiches produit (mode_cout = compose : le cout vient de la
--    nomenclature du format, jamais d'ingredients propres).
--    yield_quantity = nombre de GATEAUX du sachet par defaut.
--    product_id n'est renseigne que si la fiche n'a qu'un seul produit : sinon
--    le lien passe par les formats (contrainte recipes_product_id_unique).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id)
SELECT v.id, v.nom, false, 'compose', v.pieces, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = v.cat), v.produit
FROM (VALUES
  ('fab28300-0000-4000-8000-000000000131'::uuid, 'Corne de gazelle',            50::numeric, 'gateaux_marocains', NULL::uuid),
  ('fab28300-0000-4000-8000-000000000132', 'Corne de gazelle sésame',           50, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000133', 'Ghriba bahla',                      40, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000134', 'Ghriba café',                       40, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000135', 'Ghriba coco',                        8, 'gateaux_marocains', 'ae70a676-ddc3-4cb5-9618-7968004ec5db'),
  ('fab28300-0000-4000-8000-000000000136', 'Ghriba louza',                       8, 'gateaux_marocains', 'ee0b33a6-9bf3-4748-9a68-f85fd9e35521'),
  ('fab28300-0000-4000-8000-000000000137', 'Ghriba nature',                      8, 'gateaux_marocains', 'd8416d24-066e-43a3-bf11-fa374382be54'),
  ('fab28300-0000-4000-8000-000000000138', 'Ghriba fromage',                     8, 'sale_beldi',        '66391349-7623-4f0a-bedd-ffc28613fecc'),
  ('fab28300-0000-4000-8000-000000000139', 'Fekkas nature',                    125, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000140', 'Fekkas complet',                   125, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000141', 'Fekkas noix',                       25, 'gateaux_marocains', 'aeb6ec02-65f5-4496-a846-a6d42b310bf7'),
  ('fab28300-0000-4000-8000-000000000142', 'Fekkas raisin',                     25, 'gateaux_marocains', '8a2c9f9e-ae03-48c1-ae70-244597d9a309'),
  ('fab28300-0000-4000-8000-000000000143', 'Fekkas crème',                      50, 'gateaux_marocains', 'b1cce750-1d68-4097-90df-de9fa6aea9aa'),
  ('fab28300-0000-4000-8000-000000000144', 'Maamoul aux dattes',                33, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000145', 'Chebakia',                          10, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000146', 'Chebakia amande',                   40, 'gateaux_marocains', '15f7cd53-6223-4588-931c-6554a9047015'),
  ('fab28300-0000-4000-8000-000000000147', 'Boule de neige',                    50, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000148', 'Boule coco lait concentré',         10, 'gateaux_marocains', '3a4eb176-e77f-4831-8786-992470cbd69c'),
  ('fab28300-0000-4000-8000-000000000149', 'Rafaello beldi',                    13, 'gateaux_marocains', '527c88e0-d93d-4c40-8e10-702e41514561'),
  ('fab28300-0000-4000-8000-000000000150', 'Briouate amande',                   16, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000151', 'Briouate salée',                     8, 'sale_beldi',        '96a5523c-6023-4b44-bfc0-624d38c644f7'),
  ('fab28300-0000-4000-8000-000000000152', 'Sablé beldi',                       66, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000153', 'Diamantine chocolat',               16, 'gateaux_marocains', '205070a5-b61d-4d32-b8fe-9711eb3c0175'),
  ('fab28300-0000-4000-8000-000000000154', 'Cookies spécial',                    5, 'gateaux_marocains', '2862cf31-7fd2-4d02-902d-589fb0395ce1'),
  ('fab28300-0000-4000-8000-000000000155', 'Makrout',                            8, 'gateaux_marocains', '01ed7dc0-287b-46f4-b5e6-c80101b0f36a'),
  ('fab28300-0000-4000-8000-000000000156', 'Mhancha amande',                     1, 'gateaux_marocains', '356c10dc-86c0-4a7d-a2b2-83f9420750d1'),
  ('fab28300-0000-4000-8000-000000000157', 'Rkhama amande',                      8, 'gateaux_marocains', 'ed4077a5-99dc-48eb-930c-fb4a7e059367'),
  ('fab28300-0000-4000-8000-000000000158', 'Gâteau beldi amande',               20, 'gateaux_marocains', NULL),
  ('fab28300-0000-4000-8000-000000000159', 'Feuilletine fromage',               10, 'sale_beldi',        'bd5d75c9-c9ef-4770-9090-6e4342b7688b'),
  ('fab28300-0000-4000-8000-000000000160', 'Batbout',                            1, 'sale_beldi',        '1fb93505-2b19-49ec-8b25-f8e1ef8bc496'),
  ('fab28300-0000-4000-8000-000000000161', 'Assortiment beldi marocain',        45, 'gateaux_marocains', 'a72e1600-7ff3-414f-ac64-522a2867b09a')
) AS v (id, nom, pieces, cat, produit)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 56 formats. Un par reference du catalogue, contenant_id NULL (sachet
--    ou barquette), nb_par_defaut = 1, quantite_par_format = poids du sachet.
--    Le format par defaut est le plus gros de la gamme : c'est lui qui alimente
--    le miroir recipe_components, donc le cout affiche de la fiche.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut,
                            is_default, ordre, product_id)
SELECT v.id, v.recette, NULL, v.poids, 'g', 1, v.defaut, v.ordre, v.produit
FROM (VALUES
  -- Corne de gazelle — 200 DH/kg
  ('fab28300-0000-4000-8000-000000000201'::uuid, 'fab28300-0000-4000-8000-000000000131'::uuid,  250::numeric, false, 1, '210b7ada-ff9a-41af-965f-9fbd17acc8b0'::uuid),
  ('fab28300-0000-4000-8000-000000000202', 'fab28300-0000-4000-8000-000000000131',  500, false, 2, '732b0a3f-51af-4441-8d1f-7b7d79cfcc8b'),
  ('fab28300-0000-4000-8000-000000000203', 'fab28300-0000-4000-8000-000000000131', 1000, true,  3, 'd24ca2d2-c56c-4104-9136-7346130c95bd'),
  -- Corne de gazelle sésame — 200 DH/kg
  ('fab28300-0000-4000-8000-000000000204', 'fab28300-0000-4000-8000-000000000132',  250, false, 1, '94e1afa9-dba6-46f2-87ad-551f946e7d67'),
  ('fab28300-0000-4000-8000-000000000205', 'fab28300-0000-4000-8000-000000000132',  500, false, 2, 'ca5bb0ff-7b51-4c32-ad0c-cb3e3b5fe4fc'),
  ('fab28300-0000-4000-8000-000000000206', 'fab28300-0000-4000-8000-000000000132', 1000, true,  3, '7c962e3a-0c2d-46c8-9dc3-54931951946e'),
  -- Ghriba bahla — 120 DH/kg
  ('fab28300-0000-4000-8000-000000000207', 'fab28300-0000-4000-8000-000000000133',  250, false, 1, 'f69f4029-f1bb-4ffc-ae4c-95d95c3f3450'),
  ('fab28300-0000-4000-8000-000000000208', 'fab28300-0000-4000-8000-000000000133',  500, false, 2, '932d276f-233e-4323-b9ff-9e2c80babf82'),
  ('fab28300-0000-4000-8000-000000000209', 'fab28300-0000-4000-8000-000000000133', 1000, true,  3, 'b7c51451-50ea-4efc-93e2-c7c321cb07df'),
  -- Ghriba café — 170 DH/kg
  ('fab28300-0000-4000-8000-000000000210', 'fab28300-0000-4000-8000-000000000134',  250, false, 1, '9f3f48c3-8ad5-4468-8969-65d54082590a'),
  ('fab28300-0000-4000-8000-000000000211', 'fab28300-0000-4000-8000-000000000134',  500, false, 2, '26e3ebf4-c6f3-4df4-a5b1-6e724a16d34d'),
  ('fab28300-0000-4000-8000-000000000212', 'fab28300-0000-4000-8000-000000000134', 1000, true,  3, 'c6f878fe-0033-4029-b0fe-f0578c13adee'),
  -- Ghribas au sachet de 200 g
  ('fab28300-0000-4000-8000-000000000213', 'fab28300-0000-4000-8000-000000000135',  200, true,  1, 'ae70a676-ddc3-4cb5-9618-7968004ec5db'),
  ('fab28300-0000-4000-8000-000000000214', 'fab28300-0000-4000-8000-000000000136',  200, true,  1, 'ee0b33a6-9bf3-4748-9a68-f85fd9e35521'),
  ('fab28300-0000-4000-8000-000000000215', 'fab28300-0000-4000-8000-000000000137',  200, true,  1, 'd8416d24-066e-43a3-bf11-fa374382be54'),
  ('fab28300-0000-4000-8000-000000000216', 'fab28300-0000-4000-8000-000000000138',  200, true,  1, '66391349-7623-4f0a-bedd-ffc28613fecc'),
  -- Fekkas nature — 120 DH/kg (4 graphies au catalogue, une seule recette)
  ('fab28300-0000-4000-8000-000000000217', 'fab28300-0000-4000-8000-000000000139',  200, false, 1, 'bb10d3fd-c069-4ab2-9537-6eb3fd157f7c'),
  ('fab28300-0000-4000-8000-000000000218', 'fab28300-0000-4000-8000-000000000139',  250, false, 2, 'f7c87fdb-2978-4809-8491-c6b4a11a0c4a'),
  ('fab28300-0000-4000-8000-000000000219', 'fab28300-0000-4000-8000-000000000139',  500, false, 3, '8739a707-40c7-4953-b480-ceba8e1c116d'),
  ('fab28300-0000-4000-8000-000000000220', 'fab28300-0000-4000-8000-000000000139', 1000, true,  4, '61e57705-7a46-46eb-8835-e8fd6a8d8f48'),
  -- Fekkas complet — 130 DH/kg
  ('fab28300-0000-4000-8000-000000000221', 'fab28300-0000-4000-8000-000000000140',  200, false, 1, 'e9e541cc-593f-4ad1-9eb9-d8979d842a63'),
  ('fab28300-0000-4000-8000-000000000222', 'fab28300-0000-4000-8000-000000000140',  250, false, 2, '18d30121-da19-4f83-b347-39ff7729b955'),
  ('fab28300-0000-4000-8000-000000000223', 'fab28300-0000-4000-8000-000000000140', 1000, true,  3, '602362b6-0183-4597-8597-8642206a0c62'),
  ('fab28300-0000-4000-8000-000000000224', 'fab28300-0000-4000-8000-000000000141',  200, true,  1, 'aeb6ec02-65f5-4496-a846-a6d42b310bf7'),
  ('fab28300-0000-4000-8000-000000000225', 'fab28300-0000-4000-8000-000000000142',  200, true,  1, '8a2c9f9e-ae03-48c1-ae70-244597d9a309'),
  -- « Fekkas crème » vendu 50 DH : sachet de 400 g (125 DH/kg) — À CONFIRMER
  ('fab28300-0000-4000-8000-000000000226', 'fab28300-0000-4000-8000-000000000143',  400, true,  1, 'b1cce750-1d68-4097-90df-de9fa6aea9aa'),
  -- Maamoul — 120 DH/kg (MAAMOL / MAÂMOUL / Maamoul : une seule recette)
  ('fab28300-0000-4000-8000-000000000227', 'fab28300-0000-4000-8000-000000000144',  200, false, 1, '211867be-e3aa-458f-a217-576abe31c374'),
  ('fab28300-0000-4000-8000-000000000228', 'fab28300-0000-4000-8000-000000000144',  250, false, 2, '9faaa891-bb92-461f-ac30-7faf4ace7d1c'),
  ('fab28300-0000-4000-8000-000000000229', 'fab28300-0000-4000-8000-000000000144',  500, false, 3, '47907632-1ac1-45bb-b003-08717fbf626a'),
  ('fab28300-0000-4000-8000-000000000230', 'fab28300-0000-4000-8000-000000000144', 1000, true,  4, 'be9073fd-1c97-43e9-a39b-d0334178e493'),
  -- Chebakia — 140 DH/kg
  ('fab28300-0000-4000-8000-000000000231', 'fab28300-0000-4000-8000-000000000145',  100, false, 1, '61a28773-a1bc-414b-b973-c94e2792c78c'),
  ('fab28300-0000-4000-8000-000000000232', 'fab28300-0000-4000-8000-000000000145',  250, true,  2, 'a2a095ed-a5f8-4080-817c-809fc9e0d07f'),
  ('fab28300-0000-4000-8000-000000000233', 'fab28300-0000-4000-8000-000000000146', 1000, true,  1, '15f7cd53-6223-4588-931c-6554a9047015'),
  -- Boule de neige — 5 conditionnements
  ('fab28300-0000-4000-8000-000000000234', 'fab28300-0000-4000-8000-000000000147',  200, false, 1, '24230f74-b17b-47ba-9d14-3b33d968b336'),
  ('fab28300-0000-4000-8000-000000000235', 'fab28300-0000-4000-8000-000000000147',  250, false, 2, '434c3abc-1e2a-4eef-9244-272598109e15'),
  ('fab28300-0000-4000-8000-000000000236', 'fab28300-0000-4000-8000-000000000147',  300, false, 3, '29faf5c6-a045-429f-9d88-3c857b8d724f'),
  ('fab28300-0000-4000-8000-000000000237', 'fab28300-0000-4000-8000-000000000147',  500, false, 4, 'b76154db-aa5f-45b1-a695-28a081a36d36'),
  ('fab28300-0000-4000-8000-000000000238', 'fab28300-0000-4000-8000-000000000147', 1000, true,  5, '56f87afd-46c9-4f0c-b8b8-9758bde47b91'),
  ('fab28300-0000-4000-8000-000000000239', 'fab28300-0000-4000-8000-000000000148',  200, true,  1, '3a4eb176-e77f-4831-8786-992470cbd69c'),
  ('fab28300-0000-4000-8000-000000000240', 'fab28300-0000-4000-8000-000000000149',  200, true,  1, '527c88e0-d93d-4c40-8e10-702e41514561'),
  -- Briouate amande — « BRIOUATE 300G » est la meme briouate, en 300 g
  ('fab28300-0000-4000-8000-000000000241', 'fab28300-0000-4000-8000-000000000150',  250, false, 1, 'e892e9c0-bd16-4381-ad5f-16a0c5f7ee2f'),
  ('fab28300-0000-4000-8000-000000000242', 'fab28300-0000-4000-8000-000000000150',  300, false, 2, 'a87c08c4-005b-478b-9e42-f343b1e825d6'),
  ('fab28300-0000-4000-8000-000000000243', 'fab28300-0000-4000-8000-000000000150',  400, true,  3, '31ab7f42-dde1-4c1a-8607-2384bb696f39'),
  -- « Bîote salé » = briouate salee, barquette de 200 g (125 DH/kg) — À CONFIRMER
  ('fab28300-0000-4000-8000-000000000244', 'fab28300-0000-4000-8000-000000000151',  200, true,  1, '96a5523c-6023-4b44-bfc0-624d38c644f7'),
  ('fab28300-0000-4000-8000-000000000245', 'fab28300-0000-4000-8000-000000000152',  200, false, 1, 'b48be555-2624-4751-9c1d-3ba3ae055077'),
  ('fab28300-0000-4000-8000-000000000246', 'fab28300-0000-4000-8000-000000000152', 1000, true,  2, '5c1ed9eb-5192-48c0-bb76-909144675970'),
  ('fab28300-0000-4000-8000-000000000247', 'fab28300-0000-4000-8000-000000000153',  200, true,  1, '205070a5-b61d-4d32-b8fe-9711eb3c0175'),
  ('fab28300-0000-4000-8000-000000000248', 'fab28300-0000-4000-8000-000000000154',  200, true,  1, '2862cf31-7fd2-4d02-902d-589fb0395ce1'),
  ('fab28300-0000-4000-8000-000000000249', 'fab28300-0000-4000-8000-000000000155',  200, true,  1, '01ed7dc0-287b-46f4-b5e6-c80101b0f36a'),
  -- Mhancha : le sachet de 250 g EST une couronne entiere
  ('fab28300-0000-4000-8000-000000000250', 'fab28300-0000-4000-8000-000000000156',  250, true,  1, '356c10dc-86c0-4a7d-a2b2-83f9420750d1'),
  ('fab28300-0000-4000-8000-000000000251', 'fab28300-0000-4000-8000-000000000157',  200, true,  1, 'ed4077a5-99dc-48eb-930c-fb4a7e059367'),
  -- « Gâteau beldi amande 250g » et « Gâteau Amandes 500g » : meme fiche
  ('fab28300-0000-4000-8000-000000000252', 'fab28300-0000-4000-8000-000000000158',  250, false, 1, '3e5c04b2-037c-4ed8-9997-0dde7dd30737'),
  ('fab28300-0000-4000-8000-000000000253', 'fab28300-0000-4000-8000-000000000158',  500, true,  2, '608ffc87-72a1-4685-8d96-8838953f4bf9'),
  ('fab28300-0000-4000-8000-000000000254', 'fab28300-0000-4000-8000-000000000159',  250, true,  1, 'bd5d75c9-c9ef-4770-9090-6e4342b7688b'),
  -- Batbout : le format EST la piece cuite (90 g)
  ('fab28300-0000-4000-8000-000000000255', 'fab28300-0000-4000-8000-000000000160',   90, true,  1, '1fb93505-2b19-49ec-8b25-f8e1ef8bc496'),
  ('fab28300-0000-4000-8000-000000000256', 'fab28300-0000-4000-8000-000000000161', 1000, true,  1, 'a72e1600-7ff3-414f-ac64-522a2867b09a')
) AS v (id, recette, poids, defaut, ordre, produit)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomenclature. Elle est ecrite UNE FOIS par recette, pour 1 000 g de produit
--    fini, puis projetee sur chacun de ses formats au prorata du poids du
--    sachet. C'est ce qui garantit qu'un 250 g et un 1 kg de la meme patisserie
--    ne divergent jamais, et que la somme des composants tombe exactement sur
--    le poids du format.
--    Quantites = poids NET (cuit, frit, trempe). Cf. en-tete.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _beldi_rec;
CREATE TEMP TABLE _beldi_rec ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.is_base
  AND r.archived_at IS NULL          -- d'anciennes fiches archivees portent les memes noms
  AND r.name IN (
    'Farce amande corne de gazelle', 'Pâte à corne de gazelle',
    'Pâte à ghriba bahla', 'Pâte à ghriba café', 'Pâte à ghriba coco',
    'Pâte à ghriba louza', 'Pâte à ghriba nature', 'Pâte à ghriba fromage',
    'Pâte à fekkas nature', 'Pâte à fekkas complet', 'Pâte à fekkas noix',
    'Pâte à fekkas raisin', 'Pâte à fekkas crème',
    'Farce datte maamoul', 'Pâte maamoul semoule',
    'Pâte à chebakia', 'Sirop au miel chebakia',
    'Pâte à boule de neige', 'Pâte boule coco lait concentré',
    'Pâte à sablé beldi', 'Pâte diamantine chocolat', 'Pâte à cookies spécial',
    'Pâte à makrout', 'Farce amande grillée briouate',
    'Farce salée poulet-fromage', 'Pâte à batbout',
    'Pâte feuilletée', 'Dorure'        -- bases transversales de la mig 280
  )
ORDER BY r.name, (r.id::text LIKE 'fab28300%') DESC, r.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _beldi_rec;
  IF n <> 28 THEN
    RAISE EXCEPTION 'Preparations introuvables : % trouvee(s) sur 28 attendues (mig 280 appliquee ?)', n;
  END IF;
END $$;

DROP TABLE IF EXISTS _beldi_compo;
CREATE TEMP TABLE _beldi_compo (
  recette   uuid    NOT NULL,
  role      text    NOT NULL,
  src_rec   text,
  src_ing   text,
  qte_kg    numeric NOT NULL,   -- grammes pour 1 000 g de produit fini
  perte     numeric NOT NULL,
  ordre     smallint NOT NULL
) ON COMMIT DROP;

INSERT INTO _beldi_compo (recette, role, src_rec, src_ing, qte_kg, perte, ordre) VALUES
  -- 131 Corne de gazelle : 35 % de pate, 65 % de farce — la corne est une
  -- enveloppe, pas un biscuit. Piece de 20 g, 12-13 au sachet de 250 g.
  ('fab28300-0000-4000-8000-000000000131', 'biscuit',   'Pâte à corne de gazelle',        NULL, 350, 0, 1),
  ('fab28300-0000-4000-8000-000000000131', 'garniture', 'Farce amande corne de gazelle',  NULL, 650, 0, 2),
  -- 132 Corne de gazelle sésame : le sesame remplace 30 g de gateau
  ('fab28300-0000-4000-8000-000000000132', 'biscuit',   'Pâte à corne de gazelle',        NULL, 340, 0, 1),
  ('fab28300-0000-4000-8000-000000000132', 'garniture', 'Farce amande corne de gazelle',  NULL, 630, 0, 2),
  ('fab28300-0000-4000-8000-000000000132', 'decor',     NULL, 'Grains de sésame',                30, 0, 3),
  -- 133-138 Ghribas : un seul appareil + le voile de finition
  ('fab28300-0000-4000-8000-000000000133', 'biscuit',   'Pâte à ghriba bahla',            NULL, 990, 0, 1),
  ('fab28300-0000-4000-8000-000000000133', 'decor',     NULL, 'Sucre glace',                     10, 0, 2),
  ('fab28300-0000-4000-8000-000000000134', 'biscuit',   'Pâte à ghriba café',             NULL, 985, 0, 1),
  ('fab28300-0000-4000-8000-000000000134', 'decor',     NULL, 'Sucre glace',                     15, 0, 2),
  ('fab28300-0000-4000-8000-000000000135', 'biscuit',   'Pâte à ghriba coco',             NULL, 960, 0, 1),
  ('fab28300-0000-4000-8000-000000000135', 'decor',     NULL, 'Noix de coco râpée',              40, 0, 2),
  ('fab28300-0000-4000-8000-000000000136', 'biscuit',   'Pâte à ghriba louza',            NULL, 985, 0, 1),
  ('fab28300-0000-4000-8000-000000000136', 'decor',     NULL, 'Sucre glace',                     15, 0, 2),
  ('fab28300-0000-4000-8000-000000000137', 'biscuit',   'Pâte à ghriba nature',           NULL, 985, 0, 1),
  ('fab28300-0000-4000-8000-000000000137', 'decor',     NULL, 'Sucre glace',                     15, 0, 2),
  ('fab28300-0000-4000-8000-000000000138', 'biscuit',   'Pâte à ghriba fromage',          NULL, 970, 0, 1),
  ('fab28300-0000-4000-8000-000000000138', 'decor',     NULL, 'Grains de sésame',                30, 0, 2),
  -- 139-143 Fekkas : pate seule, tout est dans la pate (tranche de 8 g)
  ('fab28300-0000-4000-8000-000000000139', 'biscuit',   'Pâte à fekkas nature',           NULL, 1000, 0, 1),
  ('fab28300-0000-4000-8000-000000000140', 'biscuit',   'Pâte à fekkas complet',          NULL, 1000, 0, 1),
  ('fab28300-0000-4000-8000-000000000141', 'biscuit',   'Pâte à fekkas noix',             NULL, 1000, 0, 1),
  ('fab28300-0000-4000-8000-000000000142', 'biscuit',   'Pâte à fekkas raisin',           NULL, 1000, 0, 1),
  ('fab28300-0000-4000-8000-000000000143', 'biscuit',   'Pâte à fekkas crème',            NULL, 1000, 0, 1),
  -- 144 Maamoul : 62 % de coque, 36,5 % de farce (piece de 30 g)
  ('fab28300-0000-4000-8000-000000000144', 'biscuit',   'Pâte maamoul semoule',           NULL, 620, 0, 1),
  ('fab28300-0000-4000-8000-000000000144', 'garniture', 'Farce datte maamoul',            NULL, 365, 0, 2),
  ('fab28300-0000-4000-8000-000000000144', 'decor',     NULL, 'Sucre glace',                     15, 0, 3),
  -- 145 Chebakia : rendement > 100 %, cf. en-tete. Le miel est le 1er poste.
  ('fab28300-0000-4000-8000-000000000145', 'biscuit',   'Pâte à chebakia',                NULL, 560, 0, 1),
  ('fab28300-0000-4000-8000-000000000145', 'imbibage',  NULL, 'Huile de table',                  90, 0, 2),
  ('fab28300-0000-4000-8000-000000000145', 'nappage',   'Sirop au miel chebakia',         NULL, 330, 3, 3),
  ('fab28300-0000-4000-8000-000000000145', 'decor',     NULL, 'Grains de sésame',                20, 0, 4),
  -- 146 Chebakia amande : amandes concassees au trempage
  ('fab28300-0000-4000-8000-000000000146', 'biscuit',   'Pâte à chebakia',                NULL, 540, 0, 1),
  ('fab28300-0000-4000-8000-000000000146', 'imbibage',  NULL, 'Huile de table',                  90, 0, 2),
  ('fab28300-0000-4000-8000-000000000146', 'nappage',   'Sirop au miel chebakia',         NULL, 310, 3, 3),
  ('fab28300-0000-4000-8000-000000000146', 'decor',     NULL, 'Amande concassée',                60, 0, 4),
  -- 147-149 Boules
  ('fab28300-0000-4000-8000-000000000147', 'biscuit',   'Pâte à boule de neige',          NULL, 940, 0, 1),
  ('fab28300-0000-4000-8000-000000000147', 'decor',     NULL, 'Sucre glace',                     60, 0, 2),
  ('fab28300-0000-4000-8000-000000000148', 'biscuit',   'Pâte boule coco lait concentré', NULL, 950, 0, 1),
  ('fab28300-0000-4000-8000-000000000148', 'decor',     NULL, 'Noix de coco râpée',              50, 0, 2),
  ('fab28300-0000-4000-8000-000000000149', 'biscuit',   'Pâte boule coco lait concentré', NULL, 900, 0, 1),
  ('fab28300-0000-4000-8000-000000000149', 'insert',    NULL, 'Amande concassée',                45, 0, 2),
  ('fab28300-0000-4000-8000-000000000149', 'decor',     NULL, 'Noix de coco râpée',              55, 0, 3),
  -- 150 Briouate amande : frite puis miellee, meme logique que la chebakia
  ('fab28300-0000-4000-8000-000000000150', 'fond',      NULL, 'Feuilles de pastilla',           150, 0, 1),
  ('fab28300-0000-4000-8000-000000000150', 'garniture', 'Farce amande grillée briouate',  NULL, 560, 0, 2),
  ('fab28300-0000-4000-8000-000000000150', 'imbibage',  NULL, 'Huile de table',                  80, 0, 3),
  ('fab28300-0000-4000-8000-000000000150', 'nappage',   'Sirop au miel chebakia',         NULL, 180, 3, 4),
  ('fab28300-0000-4000-8000-000000000150', 'decor',     NULL, 'Grains de sésame',                30, 0, 5),
  -- 151 Briouate salee : pas de miel, plus d'huile (feuille plus epaisse)
  ('fab28300-0000-4000-8000-000000000151', 'fond',      NULL, 'Feuilles de pastilla',           220, 0, 1),
  ('fab28300-0000-4000-8000-000000000151', 'garniture', 'Farce salée poulet-fromage',     NULL, 620, 0, 2),
  ('fab28300-0000-4000-8000-000000000151', 'imbibage',  NULL, 'Huile de table',                 160, 0, 3),
  -- 152 Sable beldi
  ('fab28300-0000-4000-8000-000000000152', 'biscuit',   'Pâte à sablé beldi',             NULL, 930, 0, 1),
  ('fab28300-0000-4000-8000-000000000152', 'garniture', NULL, 'Confiure',                        50, 0, 2),
  ('fab28300-0000-4000-8000-000000000152', 'decor',     NULL, 'Sucre glace',                     20, 0, 3),
  -- 153 Diamantine chocolat
  ('fab28300-0000-4000-8000-000000000153', 'biscuit',   'Pâte diamantine chocolat',       NULL, 930, 0, 1),
  ('fab28300-0000-4000-8000-000000000153', 'decor',     NULL, 'SUCRE CASSONADE',                 40, 0, 2),
  ('fab28300-0000-4000-8000-000000000153', 'glacage',   NULL, 'Chocolat de couverture Noir 55%', 30, 5, 3),
  -- 154 Cookies special
  ('fab28300-0000-4000-8000-000000000154', 'biscuit',   'Pâte à cookies spécial',         NULL, 1000, 0, 1),
  -- 155 Makrout : frit puis mielle
  ('fab28300-0000-4000-8000-000000000155', 'biscuit',   'Pâte à makrout',                 NULL, 480, 0, 1),
  ('fab28300-0000-4000-8000-000000000155', 'garniture', 'Farce datte maamoul',            NULL, 250, 0, 2),
  ('fab28300-0000-4000-8000-000000000155', 'imbibage',  NULL, 'Huile de table',                  70, 0, 3),
  ('fab28300-0000-4000-8000-000000000155', 'nappage',   'Sirop au miel chebakia',         NULL, 200, 3, 4),
  -- 156 Mhancha : la couronne roulee, beurre au pinceau entre les feuilles
  ('fab28300-0000-4000-8000-000000000156', 'fond',      NULL, 'Feuilles de pastilla',           200, 0, 1),
  ('fab28300-0000-4000-8000-000000000156', 'garniture', 'Farce amande corne de gazelle',  NULL, 520, 0, 2),
  ('fab28300-0000-4000-8000-000000000156', 'imbibage',  NULL, 'Beurre',                          80, 0, 3),
  ('fab28300-0000-4000-8000-000000000156', 'nappage',   NULL, 'Miel liquide',                   130, 3, 4),
  ('fab28300-0000-4000-8000-000000000156', 'decor',     NULL, 'Amande effilée',                  40, 0, 5),
  ('fab28300-0000-4000-8000-000000000156', 'decor',     NULL, 'Sucre glace',                     30, 0, 6),
  -- 157 Rkhama : le « marbre » — pate d'amande + glace royale
  ('fab28300-0000-4000-8000-000000000157', 'garniture', NULL, 'Pâte d''amande 50%',             480, 0, 1),
  ('fab28300-0000-4000-8000-000000000157', 'insert',    'Farce amande corne de gazelle',  NULL, 240, 0, 2),
  ('fab28300-0000-4000-8000-000000000157', 'glacage',   NULL, 'Sucre glace',                    160, 5, 3),
  ('fab28300-0000-4000-8000-000000000157', 'glacage',   NULL, 'Blancs d''œufs liquides pasteurisés', 60, 5, 4),
  ('fab28300-0000-4000-8000-000000000157', 'decor',     NULL, 'Amande effilée',                  40, 0, 5),
  ('fab28300-0000-4000-8000-000000000157', 'nappage',   NULL, 'Eau de fleur d''oranger (litre)', 20, 0, 6),
  -- 158 Gateau beldi amande : fond sable + farce d'amande
  ('fab28300-0000-4000-8000-000000000158', 'fond',      'Pâte à sablé beldi',             NULL, 380, 0, 1),
  ('fab28300-0000-4000-8000-000000000158', 'garniture', 'Farce amande corne de gazelle',  NULL, 420, 0, 2),
  ('fab28300-0000-4000-8000-000000000158', 'garniture', NULL, 'Confiure',                        30, 0, 3),
  ('fab28300-0000-4000-8000-000000000158', 'nappage',   NULL, 'Miel liquide',                    80, 3, 4),
  ('fab28300-0000-4000-8000-000000000158', 'decor',     NULL, 'Amande effilée',                  60, 0, 5),
  ('fab28300-0000-4000-8000-000000000158', 'decor',     NULL, 'Sucre glace',                     30, 0, 6),
  -- 159 Feuilletine fromage : reutilise la pate feuilletee transversale (280)
  ('fab28300-0000-4000-8000-000000000159', 'fond',      'Pâte feuilletée',                NULL, 680, 0, 1),
  ('fab28300-0000-4000-8000-000000000159', 'garniture', NULL, 'Fromage Edam',                   150, 0, 2),
  ('fab28300-0000-4000-8000-000000000159', 'garniture', NULL, 'Crème fraîche',                  100, 0, 3),
  ('fab28300-0000-4000-8000-000000000159', 'nappage',   'Dorure',                         NULL,  40, 5, 4),
  ('fab28300-0000-4000-8000-000000000159', 'decor',     NULL, 'Grains de sésame',                30, 0, 5),
  -- 160 Batbout : la piece de 90 g cuite a la plancha
  ('fab28300-0000-4000-8000-000000000160', 'biscuit',   'Pâte à batbout',                 NULL, 1000, 0, 1),
  -- 161 Assortiment : six patisseries au prorata, montees sur leurs BASES
  --     (cf. en-tete : passer par les fiches produit fausserait l'unite).
  ('fab28300-0000-4000-8000-000000000161', 'biscuit',   'Pâte à corne de gazelle',        NULL,  85, 0, 1),
  ('fab28300-0000-4000-8000-000000000161', 'garniture', 'Farce amande corne de gazelle',  NULL, 165, 0, 2),
  ('fab28300-0000-4000-8000-000000000161', 'biscuit',   'Pâte à ghriba bahla',            NULL, 150, 0, 3),
  ('fab28300-0000-4000-8000-000000000161', 'biscuit',   'Pâte à fekkas nature',           NULL, 150, 0, 4),
  ('fab28300-0000-4000-8000-000000000161', 'biscuit',   'Pâte à sablé beldi',             NULL, 150, 0, 5),
  ('fab28300-0000-4000-8000-000000000161', 'biscuit',   'Pâte maamoul semoule',           NULL,  93, 0, 6),
  ('fab28300-0000-4000-8000-000000000161', 'garniture', 'Farce datte maamoul',            NULL,  55, 0, 7),
  ('fab28300-0000-4000-8000-000000000161', 'garniture', 'Farce amande grillée briouate',  NULL,  84, 0, 8),
  ('fab28300-0000-4000-8000-000000000161', 'fond',      NULL, 'Feuilles de pastilla',            22, 0, 9),
  ('fab28300-0000-4000-8000-000000000161', 'imbibage',  NULL, 'Huile de table',                  12, 0, 10),
  ('fab28300-0000-4000-8000-000000000161', 'nappage',   'Sirop au miel chebakia',         NULL,  27, 3, 11),
  ('fab28300-0000-4000-8000-000000000161', 'decor',     NULL, 'Sucre glace',                      7, 0, 12);

-- Garde-fou 1 : chaque nomenclature doit sommer a 1 000 g pile.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(r.name || ' = ' || s.total || ' g', ', ')
    INTO bad
    FROM (SELECT recette, sum(qte_kg) AS total FROM _beldi_compo GROUP BY recette) s
    JOIN recipes r ON r.id = s.recette
   WHERE s.total <> 1000;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Nomenclature qui ne somme pas a 1000 g : %', bad;
  END IF;
END $$;

-- Garde-fou 2 : toute source citee doit avoir ete resolue.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT COALESCE(k.src_rec, k.src_ing), ', ') INTO bad
    FROM _beldi_compo k
    LEFT JOIN _beldi_rec sr ON sr.name = k.src_rec
    LEFT JOIN _beldi_ing i  ON i.name  = k.src_ing
   WHERE (k.src_rec IS NOT NULL AND sr.id IS NULL)
      OR (k.src_ing IS NOT NULL AND i.id  IS NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Sources de nomenclature non resolues : %', bad;
  END IF;
END $$;

DELETE FROM recipe_format_components c
 USING recipe_formats f
 WHERE c.format_id = f.id
   AND f.recipe_id::text LIKE 'fab28300-0000-4000-8000-%';

-- Projection : nomenclature au kilo x poids du sachet.
INSERT INTO recipe_format_components (format_id, role, source_recipe_id,
                                      source_ingredient_id, quantite, unite,
                                      perte_pct, ordre)
SELECT f.id, k.role, sr.id, i.id,
       round(k.qte_kg * f.quantite_par_format / 1000.0, 2),
       'g', k.perte, k.ordre
FROM _beldi_compo k
JOIN recipe_formats f  ON f.recipe_id = k.recette
LEFT JOIN _beldi_rec sr ON sr.name = k.src_rec
LEFT JOIN _beldi_ing i  ON i.name  = k.src_ing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost passe par ce miroir pour les recettes composees : sans
--    lui, les 31 fiches couteraient 0.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components c
 USING recipes r
 WHERE r.id = c.recipe_id
   AND r.id::text LIKE 'fab28300-0000-4000-8000-%'
   AND NOT r.is_base;

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
WHERE f.is_default
  AND f.recipe_id::text LIKE 'fab28300-0000-4000-8000-%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Conservation, DLC, allergenes, rendement — sur les 31 fiches produit.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes r SET instructions = v.txt, updated_at = NOW()
FROM (VALUES
  ('fab28300-0000-4000-8000-000000000131'::uuid,
   'Rendement : piece de 20 g — 12 a 13 cornes au sachet de 250 g, 50 au kilo.
Ratio : 35 % de pate, 65 % de farce. Une corne dont la pate depasse 40 % est une corne rate.
Conservation : 15 jours en boite hermetique a l''abri de la lumiere. Ne jamais mettre au froid : la pate durcit.
Allergenes : gluten, fruits a coque (amande), oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000132',
   'Rendement : piece de 20 g, 50 au kilo. Sesame torrefie a sec avant enrobage.
Conservation : 15 jours en boite hermetique.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000133',
   'Rendement : piece de 25 g, 40 au kilo. Perte de cuisson 12 %.
La bahla doit craqueler en surface et rester sablee au coeur : cuisson 160 °C, jamais plus.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000134',
   'Rendement : piece de 25 g, 40 au kilo.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000135',
   'Rendement : piece de 25 g, 8 au sachet de 200 g.
Conservation : 10 jours — le coco rancit plus vite que l''amande.
Allergenes : gluten, oeufs, lait, fruits a coque.'),
  ('fab28300-0000-4000-8000-000000000136',
   'Rendement : piece de 25 g, 8 au sachet de 200 g. « Louza » = amande.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque (amande), oeufs.'),
  ('fab28300-0000-4000-8000-000000000137',
   'Rendement : piece de 25 g, 8 au sachet de 200 g.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque, oeufs, lait, sesame.'),
  ('fab28300-0000-4000-8000-000000000138',
   'Ghriba salee-sucree au fromage. Rendement : piece de 25 g, 8 au sachet.
Conservation : 5 jours a temperature ambiante, 10 jours a +4 °C.
Allergenes : gluten, lait, oeufs, sesame.'),
  ('fab28300-0000-4000-8000-000000000139',
   'Rendement : tranche de 8 g, 125 au kilo. Double cuisson (boudin 180 °C, puis tranches 150 °C).
Le boudin doit refroidir 12 h avant tranchage : chaud, il s''emiette.
Conservation : 1 mois en boite hermetique. Produit tres sec, DLUO longue.
Allergenes : gluten, fruits a coque (amande), oeufs, lait, sesame.'),
  ('fab28300-0000-4000-8000-000000000140',
   'Rendement : tranche de 8 g, 125 au kilo. Farine complete + melange de graines.
Conservation : 1 mois en boite hermetique.
Allergenes : gluten, fruits a coque, oeufs, lait, sesame, graines.'),
  ('fab28300-0000-4000-8000-000000000141',
   'Rendement : tranche de 8 g, 25 au sachet de 200 g.
Conservation : 1 mois en boite hermetique.
Allergenes : gluten, fruits a coque (noix), oeufs, lait, sesame.'),
  ('fab28300-0000-4000-8000-000000000142',
   'Rendement : tranche de 8 g, 25 au sachet de 200 g.
Conservation : 3 semaines — les raisins reapportent de l''humidite.
Allergenes : gluten, fruits a coque (amande), oeufs, lait, sulfites (raisins secs).'),
  ('fab28300-0000-4000-8000-000000000143',
   'Sachet de 400 g (poids A CONFIRMER : le catalogue ne donne que le prix).
Rendement : tranche de 8 g, 50 au sachet.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, lait, oeufs, fruits a coque, sesame.'),
  ('fab28300-0000-4000-8000-000000000144',
   'Rendement : piece de 30 g, 33 au kilo. 62 % de coque, 36,5 % de farce.
La pate a la semoule DOIT reposer une nuit apres l''ebouillantage au beurre.
Cuisson 170 °C, 15-18 min : le maamoul ne doit pas colorer, il reste blond.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque (amande), lait.'),
  ('fab28300-0000-4000-8000-000000000145',
   'RENDEMENT SUPERIEUR A 100 % — assume et documente : la chebakia est frite puis trempee.
1 000 g vendus = 560 g de pate + 90 g d''huile absorbee + 330 g de sirop au miel + 20 g de sesame.
Rendement : rosace de 25 g, 10 au sachet de 250 g, 40 au kilo.
Conservation : 1 mois en boite hermetique. Le miel est un conservateur.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000146',
   'Version amande : amandes concassees jetees sur les rosaces au sortir du bain de miel, tant qu''il colle.
Rendement : rosace de 25 g, 40 au kilo. Rendement > 100 %, cf. chebakia nature.
Conservation : 1 mois en boite hermetique.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.'),
  ('fab28300-0000-4000-8000-000000000147',
   'Rendement : boule de 20 g, 50 au kilo.
Rouler DEUX FOIS dans le sucre glace : a chaud (le sucre fond et scelle), puis a froid (le voile blanc).
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, lait, oeufs, fruits a coque.'),
  ('fab28300-0000-4000-8000-000000000148',
   'Boule crue au coco et au lait concentre — AUCUNE CUISSON.
Rendement : boule de 20 g, 10 au sachet de 200 g.
Conservation : 5 jours a +4 °C obligatoirement (produit non cuit, riche en lait).
Allergenes : lait, fruits a coque (amande, coco).'),
  ('fab28300-0000-4000-8000-000000000149',
   'Boule crue, coeur amande, roulee au coco. AUCUNE CUISSON.
Rendement : boule de 15 g, 13 au sachet de 200 g.
Conservation : 5 jours a +4 °C.
Allergenes : lait, fruits a coque (amande, coco).'),
  ('fab28300-0000-4000-8000-000000000150',
   'RENDEMENT SUPERIEUR A 100 % : frite puis miellee, comme la chebakia.
1 000 g = 560 g de farce + 150 g de feuille + 80 g d''huile absorbee + 180 g de sirop + 30 g de sesame.
Rendement : triangle de 25 g, 16 au sachet de 400 g.
Friture 160 °C, dore clair : trop chaud, la feuille brunit avant que la farce chauffe.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, fruits a coque (amande), sesame, lait.'),
  ('fab28300-0000-4000-8000-000000000151',
   'Barquette de 200 g (poids A CONFIRMER). Rendement : triangle de 25 g, 8 a la barquette.
Conservation : 48 h a +4 °C, ou 2 mois crue a -18 °C. Produit carne : chaine du froid stricte.
Allergenes : gluten, lait, oeufs.'),
  ('fab28300-0000-4000-8000-000000000152',
   'Rendement : piece de 15 g, 66 au kilo.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, lait, oeufs, fruits a coque (amande).'),
  ('fab28300-0000-4000-8000-000000000153',
   'Sable diamant cacao, boudin roule dans la cassonade, base trempee au chocolat.
Rendement : piece de 12 g, 16 au sachet de 200 g.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, lait, oeufs, fruits a coque, soja (lecithine du chocolat).'),
  ('fab28300-0000-4000-8000-000000000154',
   'Rendement : cookie de 40 g, 5 au sachet de 200 g. Cuisson 180 °C 11 min, sortie moelleuse au centre.
Conservation : 10 jours en boite hermetique.
Allergenes : gluten, lait, oeufs, fruits a coque (noix), soja.'),
  ('fab28300-0000-4000-8000-000000000155',
   'RENDEMENT SUPERIEUR A 100 % : frit puis mielle.
Rendement : losange de 25 g, 8 au sachet de 200 g.
Conservation : 3 semaines en boite hermetique.
Allergenes : gluten, lait. Sans fruits a coque.'),
  ('fab28300-0000-4000-8000-000000000156',
   'La couronne de 250 g EST le format : un mhancha entier par sachet.
Beurre au pinceau entre chaque feuille, roulage serre puis enroulement en escargot.
Cuisson 180 °C 25 min, miel a la sortie du four, tant que la couronne est chaude.
Conservation : 10 jours en boite hermetique.
Allergenes : gluten, fruits a coque (amande), lait.'),
  ('fab28300-0000-4000-8000-000000000157',
   'Rkhama = « marbre » : couches de pate d''amande, glace royale lissee puis marbree.
Rendement : part de 25 g, 8 au sachet de 200 g.
Conservation : 15 jours a temperature ambiante, a l''abri de l''humidite (la glace royale se ramollit).
Allergenes : fruits a coque (amande), oeufs (blanc).'),
  ('fab28300-0000-4000-8000-000000000158',
   'Rendement : part de 25 g, 20 au sachet de 500 g.
Conservation : 15 jours en boite hermetique.
Allergenes : gluten, fruits a coque (amande), lait, oeufs.'),
  ('fab28300-0000-4000-8000-000000000159',
   'Feuillete sale au fromage, monte sur la pate feuilletee transversale (mig 280).
Rendement : part de 25 g, 10 au sachet de 250 g. Cuisson 200 °C puis 180 °C, 25 min au total.
Conservation : 48 h a temperature ambiante, a consommer le jour meme de preference.
Allergenes : gluten, lait, oeufs, sesame.'),
  ('fab28300-0000-4000-8000-000000000160',
   'Pain beldi a la plancha. Piece de 90 g cuite (100 g de pate crue, 12 % de perte).
Une fournee de pate (1 405 g) donne 13 a 14 batbouts.
NOTE COUT : le pain est structurellement en dehors du couloir 20-40 % — le cout matiere
d''un batbout est de l''ordre de 5 % de son prix de vente. C''est normal pour un produit
de panification, dont le cout reel est la main d''oeuvre et le four, pas la farine.
Conservation : 24 h. Se congele tres bien.
Allergenes : gluten.'),
  ('fab28300-0000-4000-8000-000000000161',
   'Assortiment au kilo : 25 % corne de gazelle, 15 % ghriba bahla, 15 % fekkas nature,
15 % sable beldi, 15 % maamoul, 15 % briouate amande. Piece moyenne 22 g, 45 pieces au kilo.
La nomenclature est batie sur les PREPARATIONS et non sur les fiches produit : voir l''en-tete
de la migration 283 (un parent compose divise par le yield de l''enfant, qui est en pieces).
Conservation : 3 semaines en boite hermetique, le fekkas separe des produits mielles.
Allergenes : gluten, fruits a coque (amande), sesame, oeufs, lait.')
) AS v (id, txt)
WHERE r.id = v.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Etapes de production sur les 4 fiches phares. Ce sont les tours de main
--    marocains qui font la difference : le repos de la farce, le pincage au
--    khab (la pince a corne), la cuisson douce, le trempage du miel a 80 °C.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Farce d''amande et repos","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Amandes mondees, egouttees, SECHEES sur torchon avant broyage — une amande humide fait une farce qui suinte",
     "Broyer avec le sucre glace, jamais seule : le sucre absorbe l''huile qui sort",
     "Gomme arabique moulue au mortier avec une pincee de sucre, puis incorporee",
     "Beurre fondu tiede et fleur d''oranger en dernier, a la main",
     "REPOS 12 h au froid, filme au contact — non negociable : c''est ce repos qui permet de rouler les boudins"]},
  {"ordre":2,"nom":"Pate et abaisse","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Beurre FONDU (jamais pommade) verse sur la farine, sabler du bout des doigts",
     "Eau de fleur d''oranger et eau tiede melangees avant incorporation",
     "Petrir 10 min jusqu''a une pate lisse et elastique, puis repos 30 min sous film",
     "Abaisse au laminoir cran par cran jusqu''a 1 mm : on doit lire un texte a travers",
     "Ne jamais fariner l''abaisse : la corne ne collerait plus a la soudure"]},
  {"ordre":3,"nom":"Faconnage et pincage au khab","duree_estimee_min":90,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":4,"responsable_role":null,
   "checklist_items":[
     "Boudins de farce de 13 g, effiles aux deux bouts, poses a 4 cm du bord",
     "Rabattre la pate, chasser l''air en pressant DEPUIS la farce vers l''exterieur",
     "Decouper a la roulette cannelee en demi-lune",
     "Pincer au khab tout le long de la soudure : c''est le pincage qui fait la corne, pas la decoupe",
     "Courber en croissant, piquer 2 fois a l''aiguille sur le dessus",
     "Piece finie : 20 g. Peser une corne toutes les 20 pieces"]},
  {"ordre":4,"nom":"Cuisson douce et ressuage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four a 160 °C, chaleur tournante douce, 12 a 14 min",
     "La corne ne doit PAS colorer : blonde tres pale, a peine doree sous le pied",
     "Une corne coloree est une corne seche : la farce a perdu son humidite",
     "Sortie sur grille, refroidissement complet avant toute mise en sachet",
     "Perte de cuisson attendue : 8 a 10 %"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28300-0000-4000-8000-000000000131';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Sablage a l''huile","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sucre glace + huile + beurre fondu battus jusqu''a blanchiment leger",
     "Farine et amande poudre versees en UNE fois, melange a la main",
     "NE PAS PETRIR : on serre, on ne travaille pas. Une bahla petrie devient dure",
     "Texture juste : la pate tient quand on la presse, s''effrite quand on la lache",
     "Sesame torrefie a sec, refroidi, incorpore en dernier"]},
  {"ordre":2,"nom":"Boulage et fissuration","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "Boules de 28 g crues (25 g cuites), roulees SANS serrer",
     "Aplatir a peine, du plat de la main — jamais au rouleau",
     "Espacer de 4 cm : la bahla s''etale a la cuisson",
     "Ne pas dorer, ne pas humidifier : la surface doit rester seche pour craqueler"]},
  {"ordre":3,"nom":"Cuisson 160 °C","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four 160 °C, sole douce, 15 a 18 min",
     "Point de controle : la craquelure doit s''ouvrir en etoile a mi-cuisson",
     "Sortir quand le dessous est blond et le dessus encore pale",
     "NE PAS BOUGER LES PLAQUES a la sortie : la bahla est molle et casse",
     "Refroidissement complet sur la plaque, puis sur grille",
     "Perte de cuisson attendue : 12 %"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28300-0000-4000-8000-000000000133';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Pate epicee et repos","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sesame torrefie puis MOULU — c''est lui qui donne le gout, pas la farine",
     "Amandes torrefiees et moulues, melangees a sec avec les epices et le curcuma",
     "Levure fraiche delayee dans l''eau de fleur d''oranger tiede",
     "Vinaigre en dernier : il assouplit la pate et limite l''absorption d''huile a la friture",
     "Petrissage 15 min, pate souple et lisse. REPOS 1 h a couvert"]},
  {"ordre":2,"nom":"Faconnage des rosaces","duree_estimee_min":120,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":5,"responsable_role":null,
   "checklist_items":[
     "Abaisse a 2 mm, decoupe en carres de 6 cm, 5 fentes paralleles",
     "Enfiler une fente sur deux sur le doigt, retourner : la rosace se forme seule",
     "Serrer le centre entre pouce et index — une rosace lache se defait dans l''huile",
     "Poser sur linge farine, couvrir : une rosace qui croute ne s''ouvre pas a la friture",
     "Piece crue : 22 g"]},
  {"ordre":3,"nom":"Friture 160 °C","duree_estimee_min":60,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":5,"responsable_role":null,
   "checklist_items":[
     "Huile a 160 °C, controlee au thermometre entre chaque bain",
     "Petites quantites : l''huile ne doit pas chuter sous 150 °C",
     "Retourner a mi-friture, sortir dore roux (pas brun)",
     "EGOUTTAGE 2 min sur grille avant le miel — une rosace grasse n''absorbe pas le miel",
     "Absorption attendue : 90 g d''huile par kilo de produit fini"]},
  {"ordre":4,"nom":"Trempage au miel","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":5,"responsable_role":null,
   "checklist_items":[
     "Miel + fleur d''oranger a 80 °C AU BAIN-MARIE. Bouillant, le miel amerise et durcit",
     "Rosaces CHAUDES dans le miel CHAUD : les deux chauds, sinon ca ne penetre pas",
     "Immersion 3 a 4 min, jusqu''a ce que la rosace cesse de faire des bulles",
     "Sortir a l''ecumoire, egoutter 5 min sur grille, sesame par-dessus tant que ca colle",
     "Prise de miel attendue : 330 g par kilo de produit fini",
     "Refroidissement 2 h avant conditionnement"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28300-0000-4000-8000-000000000145';

UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Semoule ebouillantee et repos long","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Beurre chauffe a 90 °C verse sur la semoule, melange a la cuillere",
     "Sabler a la main quand c''est tiede, jusqu''a texture de sable mouille",
     "REPOS 4 h minimum, une nuit de preference : la semoule doit boire tout le beurre",
     "Le lendemain, ressabler et ajouter la fleur d''oranger — jamais avant le repos"]},
  {"ordre":2,"nom":"Farce et faconnage au moule","duree_estimee_min":90,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "Farce de dattes assouplie au beurre tiede, boulee a 12 g",
     "Coque de 20 g creusee au pouce, farce enfermee, soudure fermee et lissee",
     "Presser dans le moule a maamoul, tapoter d''un coup sec pour demouler",
     "Motif net = moule farine et TAPOTE apres chaque piece",
     "Piece crue : 33 g pour 30 g cuits"]},
  {"ordre":3,"nom":"Cuisson blonde","duree_estimee_min":20,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Four 170 °C, 15 a 18 min",
     "Le maamoul NE COLORE PAS : il reste blond, seul le dessous prend une teinte",
     "Un maamoul dore est un maamoul sec",
     "Refroidir COMPLETEMENT avant de sucrer : le sucre glace fondrait",
     "Voile de sucre glace au tamis, 15 g par kilo",
     "Perte de cuisson attendue : 10 %"]}
]'::jsonb, updated_at = NOW()
WHERE id = 'fab28300-0000-4000-8000-000000000144';
