-- Migration 290 : Boites et plateaux — les 22 dernieres references du catalogue
--
-- POURQUOI
--   Dernier lot du catalogue Ofauria. Il melange deux natures de produit que
--   rien ne rapproche commercialement, mais que le modele traite de la meme
--   facon (une recette « compose » + un format par reference vendue) :
--
--   A. LES BOITES (11 references). Ce ne sont PAS des assortiments : chacune est
--      un produit a part entiere conditionne en boite ou barquette — une pate,
--      une garniture, une cuisson. Diamantine nature, Diamantine fromage,
--      Sable roule 200 g, Sable prestige 200 g, Nougat choco blanc 200 g,
--      Fekkas dentelle, Mini cookies, Cookies caramel 200 g, Financier abricot
--      100 g, Financier aux dattes 100 g, Boite sale.
--      Le carton/la barquette est porte par recipe_formats.cout_emballage_unitaire
--      (1,50 a 3,00 DH selon la taille), pas par la nomenclature matiere : c'est
--      la colonne que v_recipe_format_cost ajoute au cout unitaire du format.
--
--   B. LES PLATEAUX (11 references). Ce sont de VRAIS assortiments. Le catalogue
--      les decline systematiquement par deux — un « mini » et un « grand » au
--      prix exactement double (115/230 beldi, 95/190 mixte, 75/150 sable,
--      120/230 soiree, 130/250 prestige). On ne monte donc PAS 11 fiches mais
--      6 : cinq familles a deux formats (mini 500 g / grand 1 000 g) plus le
--      plateau sale, qui n'a pas de mini au catalogue (1 200 g, 250 DH).
--
-- ─── PIEGE CENTRAL : UN ASSORTIMENT SE MONTE SUR LES BASES, JAMAIS SUR LES
--     FICHES PRODUIT ───
--   Dans v_recipe_total_cost, un parent « compose » coute un enfant au prorata
--   de son rendement : quantite / (yield_quantity x (1 - perte/100)). Les fiches
--   PRODUIT FINI des migrations 283/285/286/287 ont un yield_unit = 'unit' et un
--   yield_quantity exprime EN PIECES (« Corne de gazelle » = 50 pieces au kilo).
--   Ecrire « 150 g de Corne de gazelle » en pointant cette fiche ferait lire au
--   moteur 150 / 50 = 3 FOURNEES entieres. L'erreur est silencieuse : le cout ne
--   sort pas a zero, il sort faux d'un facteur ~20.
--   Les plateaux de cette migration sont donc composes exclusivement de
--   PREPARATIONS DE BASE (yield en grammes) : « Pate a corne de gazelle » +
--   « Farce amande corne de gazelle » plutot que la fiche « Corne de gazelle »,
--   « Pate a ghriba bahla » plutot que « Ghriba bahla », etc. Le cout matiere
--   est rigoureusement le meme — c'est la meme matiere pesee — sans l'erreur
--   d'unite. C'est aussi ce qu'avait fait la mig 283 pour « Assortiment beldi
--   marocain ». Les lignes qui ne correspondent a aucune base (feuilles de
--   pastilla, amandes effilees, chocolat de couverture, sucre glace de
--   finition) sont posees en INGREDIENT direct.
--
-- ─── MUTUALISATION ───
--   Les migrations 280 a 287 ont deja pose 129 preparations de base. Toutes les
--   preparations reutilisables de ce lot en viennent : Pate a cookies et
--   Appareil a financier (287), Pate a sable beldi / Pate diamantine chocolat /
--   Pate a ghriba / Pate a corne de gazelle / Farces amande / Pate a chebakia /
--   Sirop au miel (283), Pate feuilletee / Pate sucree / Pate a choux / Cremes /
--   Caramel tendre (280), Pate brisee salee / Appareil a quiche / Farces salees
--   (284), Coque de macaron / Ganache framboise (285), Ganache montee ivoire /
--   Cremeux citron / Glacage rocher (285/286).
--   Cette migration ne cree que 6 bases, celles qu'aucune fiche existante ne
--   couvre : les deux diamantines non chocolatees, le sable roule, le sable
--   prestige, le nougat tendre et le fekkas dentelle.
--
-- ─── LIRE LES COUTS : v_recipe_total_cost vs v_recipe_format_cost ───
--   v_recipe_total_cost donne le cout matiere du format PAR DEFAUT (le miroir
--   recipe_components) : 42,46 DH pour 1 kg de plateau beldi, 60,62 DH pour 1 kg
--   de plateau prestige. C'est ce chiffre qui doit etre compare au prix de vente.
--   v_recipe_format_cost, elle, REPARTIT ce total entre tous les formats actifs
--   au prorata de leur poids (ratio_poids = poids du format / somme des poids de
--   la fiche). Sur une fiche a deux formats 500 g + 1 000 g, le grand affiche
--   donc les 2/3 du total et le mini le 1/3. Ce n'est pas propre a cette
--   migration : c'est le comportement de la vue depuis la mig 169, deja subi par
--   les fiches multi-formats de la mig 283 (corne de gazelle 250/500/1 000 g).
--   Les ratios annonces ci-dessous sont calcules sur v_recipe_total_cost.
--
-- ─── ARBITRAGES DE PRIX A FAIRE VALIDER PAR LE CHEF ───
--   1. « Nougat choco blanc 200 g » est affiche 15,00 DH, soit 75 DH/kg, quand
--      toutes les autres boites de 200 g du meme lot sont a 20-25 DH. Un nougat
--      tendre (sucre + glucose + miel + blancs montes) enrobe de chocolat blanc
--      revient a ~29 DH/kg de matiere : le ratio ressort a 39 %, en haut du
--      couloir 20-40 %, et a 49 % emballage compris. La recette n'a PAS ete
--      appauvrie pour rentrer dans le couloir : c'est le prix de vente qui est
--      hors marche, ou l'etiquette « 200 g » qui est fausse. A trancher.
--   2. Les plateaux d'assortiment ressortent a 17-24 % du prix de vente
--      (beldi 18,5 %, mixte 19,7 %, prestige 24,2 %, sable 21,2 %, soiree
--      18,5 %, sale 17,2 %). C'est normal et voulu : sur un plateau, le prix
--      couvre aussi le plateau lui-meme, la mise en scene et le temps de
--      dressage — 40 min pour un plateau sable, 55 min pour un prestige, un peu
--      plus de 2 h de facon pour le plateau sale — pas seulement la matiere.
--      Les pesees n'ont pas ete gonflees pour remonter dans le couloir 20-40 %
--      des produits unitaires : un plateau n'est pas un produit unitaire.
--
-- ─── PIEGES DE REFERENTIEL EVITES ───
--   - « Miel » (5 DH) et « Fruits confits » sont stockes en 'unit' : pesee en
--     grammes, fn_unit_conv retombe sur 1 et le cout explose. On utilise
--     « Miel liquide » (kg), cree par la mig 283/284.
--   - « Chocolat cookies drops » et « Sirop de glucose » existent en double,
--     une fois en kg et une fois en g (0,14 DH/g = 140 DH/kg contre 30 DH/kg).
--     L'arbitrage se fait sur : usage reel, puis unite ponderale, puis prix non
--     nul, puis anciennete.
--   - « Huile de table » est en litres avec densite 0,920 (posee par la mig 276),
--     « Eau » et « Eau de fleur d'oranger (litre) » en litres avec densite 1,000.
--     Les lignes en grammes passent donc correctement.
--
-- PORTEE
--   + 3 ingredients crees si absents (abricot sec, dattes denoyautees, gruyere)
--   + 6 preparations de base                (fab29000-…-0000000001{01..06})
--   + 17 fiches produit fini                (fab29000-…-0000000001{21..37})
--   + 22 recipe_formats, un par reference vendue (fab29000-…-0000000002{01..22})
--   + la nomenclature de chaque format et le miroir recipe_components
--   + etapes de production et notes de conservation sur les 17 fiches
--   Rejouable : ON CONFLICT (id) DO NOTHING sur les UUID fixes, DELETE + INSERT
--   sur toutes les compositions.
--
-- INVERSION
--   DELETE FROM recipes WHERE id::text LIKE 'fab29000-0000-4000-8000-%';
--     -- cascade recipe_formats, recipe_format_components, recipe_components
--   DELETE FROM ingredients WHERE name IN ('Abricot sec','Dattes dénoyautées')
--     AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id);

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

SELECT pg_temp.archiver_homonymes_catalogue('290 préambule');

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingredients manquants au referentiel.
--    « Gruyère râpé » est aussi cree par la mig 284 (meme nom, meme prix) : le
--    garde NOT EXISTS rend l'ordre d'application indifferent.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT v.nom, 'kg', v.prix, v.cat
FROM (VALUES
  -- Oreillons secs souples, retailles en des pour le financier abricot.
  ('Abricot sec',        70.00::numeric, 'fruits_secs'),   -- PRIX À VALIDER
  -- « Pate de dattes » (20 DH/kg) existe, mais c'est une pate a farcir : un
  -- financier aux dattes se monte avec des des de datte entiere, pas de la pate.
  ('Dattes dénoyautées', 42.00,          'fruits_secs'),   -- PRIX À VALIDER
  -- Fromage rape de cuisson. « Fromage Edam » du referentiel est a 170 DH/kg :
  -- trop cher pour une diamantine salee vendue 25 DH la boite de 200 g.
  ('Gruyère râpé',       95.00,          'fromages')       -- PRIX À VALIDER
) AS v (nom, prix, cat)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.nom));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Resolution des ingredients (pattern mig 273, durci pour les doublons
--    kg/g de ce lot).
--    Ordre d'arbitrage : usage reel dans les recettes existantes, puis unite
--    ponderale ou volumique (evite « Beurre » a l'unite et le drop a 0,14 DH/g),
--    puis prix non nul, puis anciennete.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _bp_ing;
CREATE TEMP TABLE _bp_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id, i.unit, i.unit_cost
FROM ingredients i
WHERE i.name IN (
  'Abricot sec', 'Amande concassée', 'Amande effilée', 'Amande poudre',
  'Beurre', 'Blancs d''œufs liquides pasteurisés', 'Chocolat Blanc 30%',
  'Chocolat cookies drops', 'Chocolat de couverture Noir 55%',
  'Confiture de framboise', 'Dattes dénoyautées', 'Eau', 'Farine Fleur',
  'Feuilles de pastilla', 'Grains de sésame', 'Gruyère râpé', 'Huile de table',
  'Levure chimique', 'Maïzena', 'Miel liquide', 'Nappage neutre',
  'Oeufs Jaune', 'Oeufs entiers liquides', 'Pistache décortiquée',
  'SUCRE CASSONADE', 'Sel de table fin', 'Sirop de glucose', 'Sucre glace',
  'Sucre grain CAL 10', 'Sucre semoule', 'Vanille poudre'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         (i.unit IN ('kg', 'l')) DESC,
         (i.unit_cost > 0) DESC,
         i.unit_cost DESC,
         i.created_at;

-- Garde-fou 1 : aucun ingredient manquant. Une fiche amputee couterait faux
-- sans jamais lever d'erreur.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _bp_ing;
  IF n <> 31 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 31 attendus (migs 283/284 appliquees ?)', n;
  END IF;
END $$;

-- Garde-fou 2 : aucun prix nul. Le referentiel contient des doublons a 0,00 DH
-- (cf. « Saumon fume » de la mig 284) : s'ils remontaient ici, tout le lot
-- serait sous-coute silencieusement.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO bad FROM _bp_ing WHERE unit_cost IS NULL OR unit_cost <= 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Ingredients a prix nul retenus : %', bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Les 6 preparations de base creees par ce lot.
--    yield_quantity = PESEE CRUE, perte_standard_pct = perte de transformation.
--    Sables et diamantines : 8-10 % (evaporation + chutes de detaillage).
--    Fekkas : 14 % (double cuisson, la tranche seche completement).
--    Nougat : 6 % (evaporation du sirop cuit a 145 °C).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, instructions)
SELECT v.id, v.nom, true, 'ratio_poids', v.yield, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production'), v.notes
FROM (VALUES
  ('fab29000-0000-4000-8000-000000000101'::uuid, 'Pâte diamantine nature',      1000::numeric, 10::numeric,
   'Sablage beurre-farine, jaunes en dernier. Rouler en boudin Ø 3,5 cm, filmer, 2 h au froid. Rouler le boudin dans le sucre grain AVANT de trancher a 1 cm. Cuisson 165 °C 14 min, le bord doit rester blond.'),
  ('fab29000-0000-4000-8000-000000000102', 'Pâte diamantine fromage',           1000, 10,
   'Version salee du diamant : le gruyere remplace une partie du sucre. Meme boudin, roule dans le sesame. Cuisson 170 °C 13 min. Se refroidit completement sur grille sinon le fromage rend et ramollit le sable.'),
  ('fab29000-0000-4000-8000-000000000103', 'Pâte à sablé roulé',                1000,  8,
   'Pate sablee souple destinee a etre abaissee a 3 mm puis roulee sur la confiture. Repos 2 h au froid obligatoire avant abaisse, 30 min au congelateur avant tranchage.'),
  ('fab29000-0000-4000-8000-000000000104', 'Pâte à sablé prestige amande',      1000,  8,
   'Sable riche en amande (15 %). Ne pas foisonner le beurre : un sable prestige doit etre court, pas aere. Detailler a l''emporte-piece cannele Ø 4 cm.'),
  ('fab29000-0000-4000-8000-000000000105', 'Nougat tendre au miel',             1000,  6,
   'Sirop sucre-glucose-eau a 145 °C verse sur les blancs montes, puis miel cuit a 125 °C. Assecher au batteur 8 min. Couler entre deux feuilles azyme, 12 h a 18 °C avant detaillage.'),
  ('fab29000-0000-4000-8000-000000000106', 'Pâte à fekkas dentelle',            1000, 14,
   'Fekkas fin : pate ferme, boudins de 4 cm, precuisson 170 °C 20 min, repos une nuit, tranchage a 4 mm au couteau-scie puis sechage 140 °C 15 min par face. La finesse de la tranche EST le produit.')
) AS v (id, nom, yield, perte, notes)
ON CONFLICT (id) DO NOTHING;

DELETE FROM recipe_ingredients
 WHERE recipe_id IN ('fab29000-0000-4000-8000-000000000101',
                     'fab29000-0000-4000-8000-000000000102',
                     'fab29000-0000-4000-8000-000000000103',
                     'fab29000-0000-4000-8000-000000000104',
                     'fab29000-0000-4000-8000-000000000105',
                     'fab29000-0000-4000-8000-000000000106');

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette, ing.id, v.qte, 'g'
FROM (VALUES
  -- 101 Pate diamantine nature — 1 000 g cru. Le diamant classique : 25 % de
  -- beurre sur pate totale, jaunes seuls (pas de blanc : il ferait gonfler).
  ('fab29000-0000-4000-8000-000000000101'::uuid, 'Farine Fleur',     420::numeric),
  ('fab29000-0000-4000-8000-000000000101', 'Beurre',                 250),
  ('fab29000-0000-4000-8000-000000000101', 'Sucre glace',            170),
  ('fab29000-0000-4000-8000-000000000101', 'Amande poudre',           80),
  ('fab29000-0000-4000-8000-000000000101', 'Oeufs Jaune',             50),
  ('fab29000-0000-4000-8000-000000000101', 'Maïzena',                 20),
  ('fab29000-0000-4000-8000-000000000101', 'Levure chimique',          4),
  ('fab29000-0000-4000-8000-000000000101', 'Vanille poudre',           3),
  ('fab29000-0000-4000-8000-000000000101', 'Sel de table fin',         3),
  -- 102 Pate diamantine fromage — 1 000 g cru. 15 % de gruyere : en dessous le
  -- gout disparait a la cuisson, au dessus le sable se delite.
  ('fab29000-0000-4000-8000-000000000102', 'Farine Fleur',           410),
  ('fab29000-0000-4000-8000-000000000102', 'Beurre',                 220),
  ('fab29000-0000-4000-8000-000000000102', 'Gruyère râpé',           150),
  ('fab29000-0000-4000-8000-000000000102', 'Oeufs entiers liquides',  90),
  ('fab29000-0000-4000-8000-000000000102', 'Sucre glace',             60),
  ('fab29000-0000-4000-8000-000000000102', 'Maïzena',                 30),
  ('fab29000-0000-4000-8000-000000000102', 'Grains de sésame',        30),
  ('fab29000-0000-4000-8000-000000000102', 'Levure chimique',          5),
  ('fab29000-0000-4000-8000-000000000102', 'Sel de table fin',         5),
  -- 103 Pate a sable roule — 1 000 g cru. Plus souple que le diamant (24 % de
  -- beurre, oeuf entier) : elle doit s'enrouler sans casser.
  ('fab29000-0000-4000-8000-000000000103', 'Farine Fleur',           430),
  ('fab29000-0000-4000-8000-000000000103', 'Beurre',                 240),
  ('fab29000-0000-4000-8000-000000000103', 'Sucre glace',            180),
  ('fab29000-0000-4000-8000-000000000103', 'Oeufs entiers liquides', 100),
  ('fab29000-0000-4000-8000-000000000103', 'Maïzena',                 30),
  ('fab29000-0000-4000-8000-000000000103', 'Amande poudre',           10),
  ('fab29000-0000-4000-8000-000000000103', 'Levure chimique',          4),
  ('fab29000-0000-4000-8000-000000000103', 'Vanille poudre',           3),
  ('fab29000-0000-4000-8000-000000000103', 'Sel de table fin',         3),
  -- 104 Pate a sable prestige amande — 1 000 g cru. 15 % d'amande en poudre :
  -- c'est elle qui fait le fondant et justifie le nom.
  ('fab29000-0000-4000-8000-000000000104', 'Farine Fleur',           350),
  ('fab29000-0000-4000-8000-000000000104', 'Beurre',                 250),
  ('fab29000-0000-4000-8000-000000000104', 'Amande poudre',          150),
  ('fab29000-0000-4000-8000-000000000104', 'Sucre glace',            160),
  ('fab29000-0000-4000-8000-000000000104', 'Oeufs entiers liquides',  70),
  ('fab29000-0000-4000-8000-000000000104', 'Oeufs Jaune',             10),
  ('fab29000-0000-4000-8000-000000000104', 'Maïzena',                  3),
  ('fab29000-0000-4000-8000-000000000104', 'Vanille poudre',           3),
  ('fab29000-0000-4000-8000-000000000104', 'Levure chimique',          2),
  ('fab29000-0000-4000-8000-000000000104', 'Sel de table fin',         2),
  -- 105 Nougat tendre au miel — 1 000 g cru. Ratio classique 1 volume de miel
  -- pour 2,5 de sucre : au dela le nougat colle et ne se tranche plus.
  ('fab29000-0000-4000-8000-000000000105', 'Sucre semoule',          400),
  ('fab29000-0000-4000-8000-000000000105', 'Sirop de glucose',       250),
  ('fab29000-0000-4000-8000-000000000105', 'Eau',                    140),
  ('fab29000-0000-4000-8000-000000000105', 'Miel liquide',           100),
  ('fab29000-0000-4000-8000-000000000105', 'Blancs d''œufs liquides pasteurisés', 80),
  ('fab29000-0000-4000-8000-000000000105', 'Sucre glace',             30),
  -- 106 Pate a fekkas dentelle — 1 000 g cru. Amande effilee + amande
  -- concassee : c'est le dessin de la tranche qui fait la « dentelle ».
  ('fab29000-0000-4000-8000-000000000106', 'Farine Fleur',           340),
  ('fab29000-0000-4000-8000-000000000106', 'Sucre semoule',          175),
  ('fab29000-0000-4000-8000-000000000106', 'Oeufs entiers liquides', 150),
  ('fab29000-0000-4000-8000-000000000106', 'Amande effilée',         110),
  ('fab29000-0000-4000-8000-000000000106', 'Beurre',                  90),
  ('fab29000-0000-4000-8000-000000000106', 'Amande concassée',        70),
  ('fab29000-0000-4000-8000-000000000106', 'Grains de sésame',        40),
  ('fab29000-0000-4000-8000-000000000106', 'Maïzena',                 12),
  ('fab29000-0000-4000-8000-000000000106', 'Levure chimique',          8),
  ('fab29000-0000-4000-8000-000000000106', 'Vanille poudre',           3),
  ('fab29000-0000-4000-8000-000000000106', 'Sel de table fin',         2)
) AS v (recette, ingredient, qte)
JOIN _bp_ing ing ON ing.name = v.ingredient;

-- Garde-fou 3 : chaque base doit sommer exactement a sa pesee (1 000 g ici).
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(r.name || ' = ' || s.total || ' g (yield ' || r.yield_quantity || ')', ', ')
    INTO bad
    FROM (SELECT recipe_id, sum(quantity) AS total
            FROM recipe_ingredients
           WHERE recipe_id::text LIKE 'fab29000-0000-4000-8000-0000000001%'
           GROUP BY recipe_id) s
    JOIN recipes r ON r.id = s.recipe_id
   WHERE s.total <> r.yield_quantity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Base dont la somme des pesees ne tombe pas sur le rendement : %', bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les 17 fiches produit fini (mode_cout = 'compose' : tout le cout vient de
--    la nomenclature du format par defaut, aucune ligne d'ingredient propre).
--    yield_quantity = nombre de PIECES du format par defaut ; c'est ce qui
--    rapporte le cout du conditionnement a la piece dans l'editeur.
--    recipes.product_id n'est renseigne que pour les fiches mono-produit : les
--    cinq familles de plateaux portent deux references chacune, le lien passe
--    alors uniquement par recipe_formats.product_id.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id)
SELECT v.id, v.nom, false, 'compose', v.pieces, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = v.cat), v.produit
FROM (VALUES
  -- ── A. LES BOITES ────────────────────────────────────────────────────────
  ('fab29000-0000-4000-8000-000000000121'::uuid, 'Diamantine nature',   15::numeric, 'gateaux_marocains', '4c1ba25f-a348-4efb-b0d0-eaff81129cb4'::uuid),
  ('fab29000-0000-4000-8000-000000000122', 'Diamantine fromage',        15, 'sale_beldi',        '00d271b2-7aee-4b7e-b2b4-f22124aa0ea6'),
  ('fab29000-0000-4000-8000-000000000123', 'Sablé roulé confiture',     16, 'gateaux_marocains', '6f3b8e7d-6220-409c-9656-8fa13826f88e'),
  ('fab29000-0000-4000-8000-000000000124', 'Sablé prestige amande',     14, 'gateaux_marocains', '38358858-93d3-4122-8908-d87df10e979b'),
  ('fab29000-0000-4000-8000-000000000125', 'Nougat chocolat blanc',     10, 'patisserie',        'eb67a0c9-804f-459e-a479-06ac70500d65'),
  ('fab29000-0000-4000-8000-000000000126', 'Fekkas dentelle',           36, 'gateaux_marocains', 'c29ff0b4-b904-434d-9321-65351d1bd6cc'),
  ('fab29000-0000-4000-8000-000000000127', 'Mini cookies',              20, 'patisserie',        'fed81d65-939a-49e8-bc67-c6bfc5d56f76'),
  ('fab29000-0000-4000-8000-000000000128', 'Cookies caramel',            8, 'patisserie',        '076f897c-9e0d-491f-855e-7631071d2992'),
  ('fab29000-0000-4000-8000-000000000129', 'Financier abricot',          4, 'patisserie',        'd941148f-300d-40df-bf06-7833ff84fa8a'),
  ('fab29000-0000-4000-8000-000000000130', 'Financier aux dattes',       4, 'patisserie',        'fa8c5a7b-b188-4424-b5a3-e34c666ea1ea'),
  ('fab29000-0000-4000-8000-000000000131', 'Boîte salé assortie',       10, 'sale_beldi',        '5f8720a8-2ca3-4893-8352-42ba371e72d0'),
  -- ── B. LES PLATEAUX ──────────────────────────────────────────────────────
  --    product_id NULL : deux references (mini + grand) par fiche.
  ('fab29000-0000-4000-8000-000000000132', 'Plateau beldi',             50, 'gateaux_marocains', NULL),
  ('fab29000-0000-4000-8000-000000000133', 'Plateau mixte',             50, 'gateaux_marocains', NULL),
  ('fab29000-0000-4000-8000-000000000134', 'Plateau prestige',          50, 'patisserie',        NULL),
  ('fab29000-0000-4000-8000-000000000135', 'Plateau sablé',             60, 'gateaux_marocains', NULL),
  ('fab29000-0000-4000-8000-000000000136', 'Plateau soirée',            45, 'patisserie',        NULL),
  -- Le plateau sale n'a pas de mini au catalogue : une seule reference.
  ('fab29000-0000-4000-8000-000000000137', 'Plateau salé',              60, 'sale_beldi',        'f4251b45-b3fe-486a-950c-b20225283cb0')
) AS v (id, nom, pieces, cat, produit)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les 22 formats — un par reference vendue. contenant_id NULL : une boite ou
--    un plateau n'est pas un contenant de PRODUCTION (la table
--    production_contenants ne contient que cadres, cercles, moules et plaques).
--    nb_par_defaut = 1 : le format EST l'unite vendue.
--    cout_emballage_unitaire = le carton / la barquette / le plateau :
--      boite carton 200 g ............ 1,80 DH
--      boite carton 250 g ............ 2,20 DH
--      barquette + film 100 g ........ 1,50 DH
--      barquette salee 250 g ......... 2,50 DH
--      plateau carton mini (500 g) ... 5,00 DH
--      plateau carton grand (1 kg) ... 8,00 DH
--      plateau sale 1,2 kg + cloche .. 10,00 DH
--    Cette valeur n'entre PAS dans la nomenclature matiere : v_recipe_format_cost
--    l'ajoute apres coup au cout unitaire du format (cf. mig 158/169).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut,
                            cout_emballage_unitaire, is_default, ordre, product_id)
SELECT v.id, v.recette, NULL, v.poids, 'g', 1, v.emb, v.defaut, v.ordre, v.produit
FROM (VALUES
  -- Boites — le format par defaut est le seul format de la fiche.
  ('fab29000-0000-4000-8000-000000000201'::uuid, 'fab29000-0000-4000-8000-000000000121'::uuid,  200::numeric, 1.80::numeric, true, 1, '4c1ba25f-a348-4efb-b0d0-eaff81129cb4'::uuid),
  ('fab29000-0000-4000-8000-000000000202', 'fab29000-0000-4000-8000-000000000122',  200,  1.80, true, 1, '00d271b2-7aee-4b7e-b2b4-f22124aa0ea6'),
  ('fab29000-0000-4000-8000-000000000203', 'fab29000-0000-4000-8000-000000000123',  200,  1.80, true, 1, '6f3b8e7d-6220-409c-9656-8fa13826f88e'),
  ('fab29000-0000-4000-8000-000000000204', 'fab29000-0000-4000-8000-000000000124',  200,  1.80, true, 1, '38358858-93d3-4122-8908-d87df10e979b'),
  ('fab29000-0000-4000-8000-000000000205', 'fab29000-0000-4000-8000-000000000125',  200,  1.80, true, 1, 'eb67a0c9-804f-459e-a479-06ac70500d65'),
  ('fab29000-0000-4000-8000-000000000206', 'fab29000-0000-4000-8000-000000000126',  250,  2.20, true, 1, 'c29ff0b4-b904-434d-9321-65351d1bd6cc'),
  ('fab29000-0000-4000-8000-000000000207', 'fab29000-0000-4000-8000-000000000127',  200,  1.80, true, 1, 'fed81d65-939a-49e8-bc67-c6bfc5d56f76'),
  ('fab29000-0000-4000-8000-000000000208', 'fab29000-0000-4000-8000-000000000128',  200,  1.80, true, 1, '076f897c-9e0d-491f-855e-7631071d2992'),
  ('fab29000-0000-4000-8000-000000000209', 'fab29000-0000-4000-8000-000000000129',  100,  1.50, true, 1, 'd941148f-300d-40df-bf06-7833ff84fa8a'),
  ('fab29000-0000-4000-8000-000000000210', 'fab29000-0000-4000-8000-000000000130',  100,  1.50, true, 1, 'fa8c5a7b-b188-4424-b5a3-e34c666ea1ea'),
  ('fab29000-0000-4000-8000-000000000211', 'fab29000-0000-4000-8000-000000000131',  250,  2.50, true, 1, '5f8720a8-2ca3-4893-8352-42ba371e72d0'),
  -- Plateaux — mini 500 g / grand 1 000 g, le grand porte le miroir de cout.
  ('fab29000-0000-4000-8000-000000000212', 'fab29000-0000-4000-8000-000000000132',  500,  5.00, false, 1, 'd5e0f4f2-54b1-41bf-a50b-bddf2634712e'),
  ('fab29000-0000-4000-8000-000000000213', 'fab29000-0000-4000-8000-000000000132', 1000,  8.00, true,  2, '99c5814f-56a8-4321-b613-3bc0f234f584'),
  ('fab29000-0000-4000-8000-000000000214', 'fab29000-0000-4000-8000-000000000133',  500,  5.00, false, 1, '12425058-357a-425a-a760-28941592efde'),
  ('fab29000-0000-4000-8000-000000000215', 'fab29000-0000-4000-8000-000000000133', 1000,  8.00, true,  2, '17023442-1c91-4926-a168-d99bf8d69dff'),
  ('fab29000-0000-4000-8000-000000000216', 'fab29000-0000-4000-8000-000000000134',  500,  5.00, false, 1, '3167d420-2c32-4bea-98ec-5086dfba8e1c'),
  ('fab29000-0000-4000-8000-000000000217', 'fab29000-0000-4000-8000-000000000134', 1000,  8.00, true,  2, '0fc8f5e0-33ba-452c-802f-8afea78fcb43'),
  ('fab29000-0000-4000-8000-000000000218', 'fab29000-0000-4000-8000-000000000135',  500,  5.00, false, 1, 'e4ba82f9-cb57-4d31-927e-7cb43ef57b50'),
  ('fab29000-0000-4000-8000-000000000219', 'fab29000-0000-4000-8000-000000000135', 1000,  8.00, true,  2, 'dc914661-7a7f-4164-ab5f-a0fe8399f60d'),
  ('fab29000-0000-4000-8000-000000000220', 'fab29000-0000-4000-8000-000000000136',  500,  5.00, false, 1, 'c803d5db-e378-42b9-96d8-981229c3973b'),
  ('fab29000-0000-4000-8000-000000000221', 'fab29000-0000-4000-8000-000000000136', 1000,  8.00, true,  2, '42cb4be5-0f4e-45f1-8566-cfd4ba2a899f'),
  ('fab29000-0000-4000-8000-000000000222', 'fab29000-0000-4000-8000-000000000137', 1200, 10.00, true,  1, 'f4251b45-b3fe-486a-950c-b20225283cb0')
) AS v (id, recette, poids, emb, defaut, ordre, produit)
ON CONFLICT (id) DO NOTHING;

-- Les bases propres à cette migration sont en table : on rejoue l'archivage
-- de leurs éventuels homonymes avant de les résoudre par nom.
SELECT pg_temp.archiver_homonymes_catalogue('290 avant résolution par nom');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Resolution des 41 preparations de base consommees (pattern mig 283).
--    archived_at IS NULL : d'anciennes fiches archivees portent les memes noms
--    (cf. mig 275), et un JOIN sur le nom seul en ramenerait deux.
--    L'arbitrage prefere les bases posees par les migs 28x a d'eventuels
--    homonymes plus anciens.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _bp_rec;
CREATE TEMP TABLE _bp_rec ON COMMIT DROP AS
SELECT DISTINCT ON (r.name) r.name, r.id
FROM recipes r
WHERE r.is_base
  AND r.archived_at IS NULL
  AND r.name IN (
    -- creees par cette migration
    'Pâte diamantine nature', 'Pâte diamantine fromage', 'Pâte à sablé roulé',
    'Pâte à sablé prestige amande', 'Nougat tendre au miel', 'Pâte à fekkas dentelle',
    -- mig 280, bases transversales
    'Pâte feuilletée', 'Pâte sucrée', 'Pâte à choux', 'Crème pâtissière',
    'Crème diplomate', 'Caramel tendre', 'Dorure', 'Ganache chocolat au lait',
    'Ganache montée ivoire', 'Croustillant praliné feuilletine',
    -- mig 283, beldi
    'Pâte à corne de gazelle', 'Farce amande corne de gazelle', 'Pâte à ghriba bahla',
    'Pâte à ghriba louza', 'Pâte maamoul semoule', 'Farce datte maamoul',
    'Farce amande grillée briouate', 'Pâte à chebakia', 'Sirop au miel chebakia',
    'Pâte à sablé beldi', 'Pâte diamantine chocolat', 'Farce salée poulet-fromage',
    -- mig 284, sale
    'Pâte brisée salée', 'Appareil à quiche', 'Farce poulet pastilla',
    'Farce fruits de mer', 'Farce viande hachée épicée',
    -- migs 285/286/287, patisserie
    'Coque de macaron', 'Ganache framboise', 'Glaçage rocher', 'Crémeux citron',
    'Dacquoise amande', 'Appareil à financier', 'Appareil à madeleine', 'Pâte à cookies'
  )
ORDER BY r.name, (r.id::text LIKE 'fab2%') DESC, r.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _bp_rec;
  IF n <> 41 THEN
    RAISE EXCEPTION 'Preparations de base introuvables : % trouvee(s) sur 41 attendues (migs 280 a 287 appliquees ?)', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomenclature. Comme en mig 283 : elle est ecrite UNE FOIS par fiche, pour
--    1 000 g de produit fini, puis projetee sur chaque format au prorata du
--    poids vendu. Un mini plateau et un grand plateau de la meme famille ne
--    peuvent donc jamais diverger, et la somme des composants tombe exactement
--    sur le poids du format (tolerance 0).
--    Les quantites sont des poids NETS (cuits, frits, trempes) : ce qui est
--    reellement dans la boite. La perte de transformation est deja portee par
--    perte_standard_pct de chaque base.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _bp_compo;
CREATE TEMP TABLE _bp_compo (
  recette uuid     NOT NULL,
  role    text     NOT NULL,
  src_rec text,
  src_ing text,
  qte_kg  numeric  NOT NULL,   -- grammes pour 1 000 g de produit fini
  perte   numeric  NOT NULL,
  ordre   smallint NOT NULL
) ON COMMIT DROP;

INSERT INTO _bp_compo (recette, role, src_rec, src_ing, qte_kg, perte, ordre) VALUES
  -- ═══ A. LES BOITES ═══════════════════════════════════════════════════════
  -- 121 Diamantine nature : le sucre grain colle sur le boudin AVANT tranchage,
  --     il fait 4 % du poids fini. C'est lui qui donne le nom « diamant ».
  ('fab29000-0000-4000-8000-000000000121', 'biscuit', 'Pâte diamantine nature', NULL, 950, 0, 1),
  ('fab29000-0000-4000-8000-000000000121', 'decor',   NULL, 'Sucre grain CAL 10',        40, 0, 2),
  ('fab29000-0000-4000-8000-000000000121', 'decor',   NULL, 'Sucre glace',               10, 0, 3),
  -- 122 Diamantine fromage : sesame a la place du sucre grain, plus un voile de
  --     gruyere saupoudre a la sortie du four (il fond et fixe le sesame).
  ('fab29000-0000-4000-8000-000000000122', 'biscuit', 'Pâte diamantine fromage', NULL, 940, 0, 1),
  ('fab29000-0000-4000-8000-000000000122', 'decor',   NULL, 'Grains de sésame',          35, 0, 2),
  ('fab29000-0000-4000-8000-000000000122', 'decor',   NULL, 'Gruyère râpé',              25, 0, 3),
  -- 123 Sable roule : 11 % de confiture. Au dela elle deborde a la cuisson et
  --     brule sur la plaque.
  ('fab29000-0000-4000-8000-000000000123', 'biscuit',   'Pâte à sablé roulé', NULL,     870, 0, 1),
  ('fab29000-0000-4000-8000-000000000123', 'garniture', NULL, 'Confiture de framboise', 110, 0, 2),
  ('fab29000-0000-4000-8000-000000000123', 'decor',     NULL, 'Sucre glace',             20, 0, 3),
  -- 124 Sable prestige : sable amande + point de ganache lait + amande effilee
  --     torrefiee. La ganache est pochee, d'ou 2 % de perte de mise en oeuvre.
  ('fab29000-0000-4000-8000-000000000124', 'biscuit',   'Pâte à sablé prestige amande', NULL, 820, 0, 1),
  ('fab29000-0000-4000-8000-000000000124', 'garniture', 'Ganache chocolat au lait',     NULL,  80, 2, 2),
  ('fab29000-0000-4000-8000-000000000124', 'decor',     NULL, 'Amande effilée',                60, 0, 3),
  ('fab29000-0000-4000-8000-000000000124', 'decor',     NULL, 'Sucre glace',                   40, 0, 4),
  -- 125 Nougat chocolat blanc : enrobage fin (10 %) au chocolat blanc tempere,
  --     5 % de perte au trempage (ce qui reste dans la cuve).
  ('fab29000-0000-4000-8000-000000000125', 'garniture', 'Nougat tendre au miel', NULL,  880, 0, 1),
  ('fab29000-0000-4000-8000-000000000125', 'glacage',   NULL, 'Chocolat Blanc 30%',     100, 5, 2),
  ('fab29000-0000-4000-8000-000000000125', 'decor',     NULL, 'Amande concassée',        20, 0, 3),
  -- 126 Fekkas dentelle : la pate EST le produit, seul le voile de sucre s'ajoute.
  ('fab29000-0000-4000-8000-000000000126', 'biscuit', 'Pâte à fekkas dentelle', NULL,   970, 0, 1),
  ('fab29000-0000-4000-8000-000000000126', 'decor',   NULL, 'Sucre glace',               30, 0, 2),
  -- 127 Mini cookies : 8 % de pepites, dose mini (une pepite par bouchee).
  ('fab29000-0000-4000-8000-000000000127', 'biscuit', 'Pâte à cookies', NULL,           900, 0, 1),
  ('fab29000-0000-4000-8000-000000000127', 'insert',  NULL, 'Chocolat cookies drops',    80, 0, 2),
  ('fab29000-0000-4000-8000-000000000127', 'decor',   NULL, 'SUCRE CASSONADE',           20, 0, 3),
  -- 128 Cookies caramel : coeur de caramel tendre coule apres cuisson dans le
  --     creux forme a la sortie du four. 3 % de perte de coulage.
  ('fab29000-0000-4000-8000-000000000128', 'biscuit', 'Pâte à cookies', NULL,           760, 0, 1),
  ('fab29000-0000-4000-8000-000000000128', 'insert',  'Caramel tendre', NULL,           160, 3, 2),
  ('fab29000-0000-4000-8000-000000000128', 'insert',  NULL, 'Chocolat cookies drops',    60, 0, 3),
  ('fab29000-0000-4000-8000-000000000128', 'decor',   NULL, 'SUCRE CASSONADE',           20, 0, 4),
  -- 129 Financier abricot : oreillons en des poses sur l'appareil cru, ils
  --     descendent a la cuisson. Nappage neutre au pinceau (5 % de perte).
  ('fab29000-0000-4000-8000-000000000129', 'biscuit', 'Appareil à financier', NULL,     800, 0, 1),
  ('fab29000-0000-4000-8000-000000000129', 'fruits',  NULL, 'Abricot sec',              170, 0, 2),
  ('fab29000-0000-4000-8000-000000000129', 'nappage', NULL, 'Nappage neutre',            20, 5, 3),
  ('fab29000-0000-4000-8000-000000000129', 'decor',   NULL, 'Amande effilée',            10, 0, 4),
  -- 130 Financier aux dattes : des de datte entiere (pas de pate de dattes),
  --     amande concassee sur le dessus pour le contraste de texture.
  ('fab29000-0000-4000-8000-000000000130', 'biscuit', 'Appareil à financier', NULL,     730, 0, 1),
  ('fab29000-0000-4000-8000-000000000130', 'fruits',  NULL, 'Dattes dénoyautées',       190, 0, 2),
  ('fab29000-0000-4000-8000-000000000130', 'decor',   NULL, 'Amande concassée',          60, 0, 3),
  ('fab29000-0000-4000-8000-000000000130', 'nappage', NULL, 'Nappage neutre',            20, 5, 4),
  -- 131 Boite sale : quatre bouchees a parts a peu pres egales — feuillete au
  --     poulet-fromage, briouate a la viande, mini-quiche, chausson gratine.
  ('fab29000-0000-4000-8000-000000000131', 'fond',      'Pâte feuilletée', NULL,             260, 0, 1),
  ('fab29000-0000-4000-8000-000000000131', 'garniture', 'Farce salée poulet-fromage', NULL,  130, 0, 2),
  ('fab29000-0000-4000-8000-000000000131', 'fond',      NULL, 'Feuilles de pastilla',         40, 0, 3),
  ('fab29000-0000-4000-8000-000000000131', 'garniture', 'Farce viande hachée épicée', NULL,  120, 0, 4),
  ('fab29000-0000-4000-8000-000000000131', 'fond',      'Pâte brisée salée', NULL,           180, 0, 5),
  ('fab29000-0000-4000-8000-000000000131', 'garniture', 'Appareil à quiche', NULL,           180, 0, 6),
  ('fab29000-0000-4000-8000-000000000131', 'decor',     NULL, 'Gruyère râpé',                 60, 0, 7),
  ('fab29000-0000-4000-8000-000000000131', 'nappage',   'Dorure', NULL,                       30, 5, 8),

  -- ═══ B. LES PLATEAUX ═════════════════════════════════════════════════════
  --   Chaque ligne est une PREPARATION DE BASE, jamais une fiche produit fini
  --   (cf. en-tete). Une corne de gazelle du plateau, c'est 35 % de pate et
  --   65 % de farce, exactement le ratio de la fiche 283 « Corne de gazelle ».
  --
  -- 132 Plateau beldi : six classiques du beldi — corne de gazelle, ghriba
  --     bahla, ghriba louza, maamoul, briouate amande, chebakia.
  ('fab29000-0000-4000-8000-000000000132', 'biscuit',   'Pâte à corne de gazelle', NULL,       70, 0,  1),
  ('fab29000-0000-4000-8000-000000000132', 'garniture', 'Farce amande corne de gazelle', NULL,130, 0,  2),
  ('fab29000-0000-4000-8000-000000000132', 'biscuit',   'Pâte à ghriba bahla', NULL,          130, 0,  3),
  ('fab29000-0000-4000-8000-000000000132', 'biscuit',   'Pâte à ghriba louza', NULL,          110, 0,  4),
  ('fab29000-0000-4000-8000-000000000132', 'biscuit',   'Pâte maamoul semoule', NULL,          95, 0,  5),
  ('fab29000-0000-4000-8000-000000000132', 'garniture', 'Farce datte maamoul', NULL,           55, 0,  6),
  ('fab29000-0000-4000-8000-000000000132', 'fond',      NULL, 'Feuilles de pastilla',          35, 0,  7),
  ('fab29000-0000-4000-8000-000000000132', 'garniture', 'Farce amande grillée briouate', NULL,105, 0,  8),
  ('fab29000-0000-4000-8000-000000000132', 'biscuit',   'Pâte à chebakia', NULL,               90, 0,  9),
  ('fab29000-0000-4000-8000-000000000132', 'nappage',   'Sirop au miel chebakia', NULL,        60, 3, 10),
  ('fab29000-0000-4000-8000-000000000132', 'imbibage',  NULL, 'Huile de table',                30, 0, 11),
  ('fab29000-0000-4000-8000-000000000132', 'decor',     NULL, 'Amande effilée',                40, 0, 12),
  ('fab29000-0000-4000-8000-000000000132', 'decor',     NULL, 'Grains de sésame',              25, 0, 13),
  ('fab29000-0000-4000-8000-000000000132', 'decor',     NULL, 'Sucre glace',                   25, 0, 14),
  -- 133 Plateau mixte : la moitie beldi, la moitie sables et petits fours secs.
  --     C'est le plateau « tout public », le moins cher au kilo du lot.
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte à ghriba bahla', NULL,          120, 0,  1),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte à corne de gazelle', NULL,       55, 0,  2),
  ('fab29000-0000-4000-8000-000000000133', 'garniture', 'Farce amande corne de gazelle', NULL,100, 0,  3),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte maamoul semoule', NULL,          80, 0,  4),
  ('fab29000-0000-4000-8000-000000000133', 'garniture', 'Farce datte maamoul', NULL,           45, 0,  5),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte à sablé beldi', NULL,           140, 0,  6),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte à sablé roulé', NULL,           110, 0,  7),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Pâte diamantine chocolat', NULL,     100, 0,  8),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Appareil à financier', NULL,          90, 0,  9),
  ('fab29000-0000-4000-8000-000000000133', 'biscuit',   'Coque de macaron', NULL,              60, 0, 10),
  ('fab29000-0000-4000-8000-000000000133', 'garniture', 'Ganache chocolat au lait', NULL,      40, 2, 11),
  ('fab29000-0000-4000-8000-000000000133', 'garniture', NULL, 'Confiture de framboise',        25, 0, 12),
  ('fab29000-0000-4000-8000-000000000133', 'decor',     NULL, 'Amande effilée',                20, 0, 13),
  ('fab29000-0000-4000-8000-000000000133', 'decor',     NULL, 'Grains de sésame',              15, 0, 14),
  -- 134 Plateau prestige : macarons ganache framboise, croustillant praline,
  --     dacquoise amande, cornes de gazelle, sables amande, financiers.
  --     C'est le plateau le plus cher en matiere du lot (~61 DH/kg).
  ('fab29000-0000-4000-8000-000000000134', 'biscuit',      'Coque de macaron', NULL,             130, 0,  1),
  ('fab29000-0000-4000-8000-000000000134', 'garniture',    'Ganache framboise', NULL,             55, 2,  2),
  ('fab29000-0000-4000-8000-000000000134', 'croustillant', 'Croustillant praliné feuilletine', NULL, 70, 2, 3),
  ('fab29000-0000-4000-8000-000000000134', 'biscuit',      'Dacquoise amande', NULL,             110, 0,  4),
  ('fab29000-0000-4000-8000-000000000134', 'garniture',    'Ganache chocolat au lait', NULL,      90, 2,  5),
  ('fab29000-0000-4000-8000-000000000134', 'garniture',    'Farce amande corne de gazelle', NULL,120, 0,  6),
  ('fab29000-0000-4000-8000-000000000134', 'biscuit',      'Pâte à corne de gazelle', NULL,       65, 0,  7),
  ('fab29000-0000-4000-8000-000000000134', 'biscuit',      'Pâte à sablé prestige amande', NULL, 130, 0,  8),
  ('fab29000-0000-4000-8000-000000000134', 'biscuit',      'Appareil à financier', NULL,         130, 0,  9),
  ('fab29000-0000-4000-8000-000000000134', 'decor',        NULL, 'Amande effilée',                45, 0, 10),
  ('fab29000-0000-4000-8000-000000000134', 'glacage',      NULL, 'Chocolat de couverture Noir 55%', 35, 5, 11),
  ('fab29000-0000-4000-8000-000000000134', 'decor',        NULL, 'Pistache décortiquée',          10, 0, 12),
  ('fab29000-0000-4000-8000-000000000134', 'decor',        NULL, 'Sucre glace',                   10, 0, 13),
  -- 135 Plateau sable : cinq sables, dont les deux diamantines et le roule.
  --     100 % sec : c'est le seul plateau qui se garde trois semaines.
  ('fab29000-0000-4000-8000-000000000135', 'biscuit',   'Pâte à sablé beldi', NULL,           260, 0, 1),
  ('fab29000-0000-4000-8000-000000000135', 'biscuit',   'Pâte à sablé roulé', NULL,           200, 0, 2),
  ('fab29000-0000-4000-8000-000000000135', 'biscuit',   'Pâte diamantine chocolat', NULL,     180, 0, 3),
  ('fab29000-0000-4000-8000-000000000135', 'biscuit',   'Pâte diamantine nature', NULL,       150, 0, 4),
  ('fab29000-0000-4000-8000-000000000135', 'biscuit',   'Pâte à sablé prestige amande', NULL, 110, 0, 5),
  ('fab29000-0000-4000-8000-000000000135', 'garniture', NULL, 'Confiture de framboise',        45, 0, 6),
  ('fab29000-0000-4000-8000-000000000135', 'decor',     NULL, 'Amande effilée',                25, 0, 7),
  ('fab29000-0000-4000-8000-000000000135', 'decor',     NULL, 'Sucre glace',                   30, 0, 8),
  -- 136 Plateau soiree : mignardises fraiches — tartelettes citron, mini-choux
  --     diplomate, financiers, madeleines, macarons, rochers.
  --     DLC 24 h : c'est le seul plateau qui contient de la creme.
  ('fab29000-0000-4000-8000-000000000136', 'fond',      'Pâte sucrée', NULL,               120, 0,  1),
  ('fab29000-0000-4000-8000-000000000136', 'garniture', 'Crème pâtissière', NULL,          100, 3,  2),
  ('fab29000-0000-4000-8000-000000000136', 'fond',      'Pâte à choux', NULL,               80, 0,  3),
  ('fab29000-0000-4000-8000-000000000136', 'garniture', 'Crème diplomate', NULL,            90, 3,  4),
  ('fab29000-0000-4000-8000-000000000136', 'biscuit',   'Appareil à financier', NULL,      100, 0,  5),
  ('fab29000-0000-4000-8000-000000000136', 'biscuit',   'Appareil à madeleine', NULL,       80, 0,  6),
  ('fab29000-0000-4000-8000-000000000136', 'biscuit',   'Coque de macaron', NULL,          100, 0,  7),
  ('fab29000-0000-4000-8000-000000000136', 'garniture', 'Ganache framboise', NULL,          45, 2,  8),
  ('fab29000-0000-4000-8000-000000000136', 'garniture', 'Ganache montée ivoire', NULL,      60, 3,  9),
  ('fab29000-0000-4000-8000-000000000136', 'insert',    'Crémeux citron', NULL,             70, 3, 10),
  ('fab29000-0000-4000-8000-000000000136', 'glacage',   'Glaçage rocher', NULL,             55, 5, 11),
  ('fab29000-0000-4000-8000-000000000136', 'glacage',   NULL, 'Chocolat de couverture Noir 55%', 35, 5, 12),
  ('fab29000-0000-4000-8000-000000000136', 'nappage',   NULL, 'Nappage neutre',             35, 5, 13),
  ('fab29000-0000-4000-8000-000000000136', 'decor',     NULL, 'Amande effilée',             30, 0, 14),
  -- 137 Plateau sale : feuilletes, briouates, pastilla au poulet, mini-quiches,
  --     bouchees fruits de mer. 1,2 kg, servi sous cloche.
  ('fab29000-0000-4000-8000-000000000137', 'fond',      'Pâte feuilletée', NULL,            200, 0,  1),
  ('fab29000-0000-4000-8000-000000000137', 'garniture', 'Farce salée poulet-fromage', NULL, 110, 0,  2),
  ('fab29000-0000-4000-8000-000000000137', 'fond',      NULL, 'Feuilles de pastilla',        50, 0,  3),
  ('fab29000-0000-4000-8000-000000000137', 'garniture', 'Farce poulet pastilla', NULL,      110, 0,  4),
  ('fab29000-0000-4000-8000-000000000137', 'fond',      'Pâte brisée salée', NULL,          130, 0,  5),
  ('fab29000-0000-4000-8000-000000000137', 'garniture', 'Appareil à quiche', NULL,          130, 0,  6),
  ('fab29000-0000-4000-8000-000000000137', 'garniture', 'Farce fruits de mer', NULL,         90, 0,  7),
  ('fab29000-0000-4000-8000-000000000137', 'garniture', 'Farce viande hachée épicée', NULL,  90, 0,  8),
  ('fab29000-0000-4000-8000-000000000137', 'decor',     NULL, 'Gruyère râpé',                55, 0,  9),
  ('fab29000-0000-4000-8000-000000000137', 'nappage',   'Dorure', NULL,                      25, 5, 10),
  ('fab29000-0000-4000-8000-000000000137', 'decor',     NULL, 'Grains de sésame',            10, 0, 11);

-- Garde-fou 4 : chaque nomenclature somme a 1 000 g pile, sinon la projection
-- ne tomberait pas sur le poids du format.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(r.name || ' = ' || s.total || ' g', ', ') INTO bad
    FROM (SELECT recette, sum(qte_kg) AS total FROM _bp_compo GROUP BY recette) s
    JOIN recipes r ON r.id = s.recette
   WHERE s.total <> 1000;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Nomenclature qui ne somme pas a 1000 g : %', bad;
  END IF;
END $$;

-- Garde-fou 5 : toute source citee est resolue (base OU ingredient, jamais les
-- deux, jamais aucune).
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT COALESCE(k.src_rec, k.src_ing, '<ligne sans source>'), ', ') INTO bad
    FROM _bp_compo k
    LEFT JOIN _bp_rec sr ON sr.name = k.src_rec
    LEFT JOIN _bp_ing i  ON i.name  = k.src_ing
   WHERE (k.src_rec IS NULL AND k.src_ing IS NULL)
      OR (k.src_rec IS NOT NULL AND k.src_ing IS NOT NULL)
      OR (k.src_rec IS NOT NULL AND sr.id IS NULL)
      OR (k.src_ing IS NOT NULL AND i.id  IS NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Sources de nomenclature non resolues : %', bad;
  END IF;
END $$;

-- Garde-fou 6 : les 17 fiches ont bien une nomenclature.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(DISTINCT recette) INTO n FROM _bp_compo;
  IF n <> 17 THEN
    RAISE EXCEPTION 'Nomenclatures ecrites : % sur 17 fiches attendues', n;
  END IF;
END $$;

DELETE FROM recipe_format_components c
 USING recipe_formats f
 WHERE c.format_id = f.id
   AND f.recipe_id::text LIKE 'fab29000-0000-4000-8000-%';

-- Projection : nomenclature au kilo x poids vendu du format.
INSERT INTO recipe_format_components (format_id, role, source_recipe_id,
                                      source_ingredient_id, quantite, unite,
                                      perte_pct, ordre)
SELECT f.id, k.role, sr.id, i.id,
       round(k.qte_kg * f.quantite_par_format / 1000.0, 2),
       'g', k.perte, k.ordre
FROM _bp_compo k
JOIN recipe_formats f   ON f.recipe_id = k.recette
LEFT JOIN _bp_rec sr    ON sr.name = k.src_rec
LEFT JOIN _bp_ing i     ON i.name  = k.src_ing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost passe par ce miroir pour les recettes composees : sans
--    lui les 17 fiches couteraient 0, et tout parent qui les consommerait aussi.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components c
 USING recipes r
 WHERE r.id = c.recipe_id
   AND r.id::text LIKE 'fab29000-0000-4000-8000-%'
   AND NOT r.is_base;

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
JOIN recipe_formats f ON f.id = c.format_id
WHERE f.is_default
  AND f.recipe_id::text LIKE 'fab29000-0000-4000-8000-%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Etapes de production des 11 BOITES. Trois etapes par fiche : la pate, la
--    cuisson, le conditionnement. Les points de controle sont ceux qui font la
--    difference entre un sable vendable et une plaque a jeter.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes r SET etapes = v.etapes::jsonb, updated_at = NOW()
FROM (VALUES
  ('fab29000-0000-4000-8000-000000000121'::uuid, '[
    {"ordre":1,"nom":"Pâte et boudins","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Beurre pommade à 18 °C, jamais fondu : un beurre fondu donne un sablé qui s''étale",
       "Sabler farine-beurre-amande, jaunes en dernier, arrêter dès que la pâte se rassemble",
       "Rouler 4 boudins Ø 3,5 cm dans du papier cuisson, serrer aux deux bouts",
       "2 h minimum au froid : un boudin mou ne se tranche pas droit"]},
    {"ordre":2,"nom":"Sucre grain et cuisson","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
     "checklist_items":[
       "Badigeonner le boudin au blanc d''œuf puis le rouler dans le sucre grain — le sucre doit couvrir tout le tour",
       "Trancher à 1 cm au couteau-scie, tourner le boudin d''un quart après chaque tranche",
       "Cuisson 165 °C 14 min chaleur tournante, plaque perforée + papier",
       "Sortie quand le bord est blond et le centre encore pâle : la cuisson finit sur la plaque"]},
    {"ordre":3,"nom":"Refroidissement et mise en boîte","duree_estimee_min":20,"est_bloquante":false,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Refroidir complètement sur grille — un sablé tiède mis en boîte ramollit en une nuit",
       "Voile de sucre glace au tamis fin",
       "15 pièces de 13 g par boîte de 200 g, pesée obligatoire",
       "Sachet fraîcheur soudé avant fermeture du carton"]}]'),
  ('fab29000-0000-4000-8000-000000000122', '[
    {"ordre":1,"nom":"Pâte au gruyère","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Gruyère bien sec : un fromage humide détrempe la pâte et elle ne se tranche plus",
       "Sabler, puis œufs entiers — pas de jaune seul ici, il faut de l''eau pour lier",
       "Saler franchement (5 g/kg) : le sucre est réduit à 6 %, rien ne masque un manque de sel",
       "Boudins Ø 3,5 cm, 2 h au froid"]},
    {"ordre":2,"nom":"Sésame et cuisson","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
     "checklist_items":[
       "Rouler les boudins dans le sésame, trancher à 1 cm",
       "Cuisson 170 °C 13 min : le fromage doit colorer sans brûler",
       "Saupoudrer le gruyère de finition À LA SORTIE du four, il fond et fixe le sésame",
       "Contrôle : le sablé doit être doré uniformément, pas de bord noir"]},
    {"ordre":3,"nom":"Refroidissement et conditionnement","duree_estimee_min":25,"est_bloquante":false,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Refroidissement complet sur grille, à l''air, jamais en pile",
       "Boîte de 200 g, 15 pièces, avec absorbeur d''humidité",
       "DLC 10 jours seulement : le fromage limite la conservation",
       "Étiquette allergènes : gluten, lait, œuf, sésame"]}]'),
  ('fab29000-0000-4000-8000-000000000123', '[
    {"ordre":1,"nom":"Pâte et abaisse","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Pâte souple : elle doit s''enrouler sans se fendre, ne pas la corser au batteur",
       "Repos 2 h au froid en pâton aplati",
       "Abaisser à 3 mm entre deux feuilles guitare, rectangle 30 × 40 cm",
       "Remettre 20 min au froid avant de garnir"]},
    {"ordre":2,"nom":"Garnissage et roulage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Confiture détendue à la spatule, couche RÉGULIÈRE de 2 mm, bord libre de 1 cm",
       "Rouler serré en partant du grand côté, souder le bord au doigt mouillé",
       "30 min au congélateur : c''est ce qui donne la spirale nette",
       "Trancher à 12 mm, poser à plat sans écraser la spirale"]},
    {"ordre":3,"nom":"Cuisson et mise en boîte","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
     "checklist_items":[
       "Cuisson 170 °C 15 min, la confiture doit frémir sans déborder",
       "Refroidir sur plaque 5 min avant de décoller : la confiture chaude colle au papier",
       "Voile de sucre glace, 16 pièces de 12 g par boîte de 200 g",
       "DLC 21 jours en boîte hermétique"]}]'),
  ('fab29000-0000-4000-8000-000000000124', '[
    {"ordre":1,"nom":"Pâte amande et détaillage","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Ne pas foisonner le beurre : le sablé prestige doit être court, pas aéré",
       "Amande poudre tamisée avec la farine pour éviter les grumeaux gras",
       "Repos 2 h, abaisse à 6 mm, emporte-pièce cannelé Ø 4 cm",
       "Rebattre les chutes UNE seule fois : la deuxième abaisse durcit"]},
    {"ordre":2,"nom":"Cuisson et torréfaction des amandes","duree_estimee_min":30,"est_bloquante":true,
     "timer_auto":true,"controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Cuisson 160 °C 16 min : basse température, l''amande brunirait avant que le centre soit cuit",
       "Amandes effilées torréfiées à part, 150 °C 8 min, remuées à mi-cuisson",
       "Refroidissement complet avant garnissage"]},
    {"ordre":3,"nom":"Ganache et finition","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Ganache lait à 26 °C, poche douille unie n° 6, un point centré de 5 g",
       "Amandes effilées piquées immédiatement, avant cristallisation",
       "Cristallisation 1 h à 16 °C, jamais au froid positif (le beurre de cacao blanchit)",
       "Sucre glace au tamis, 14 pièces de 14 g par boîte de 200 g"]}]'),
  ('fab29000-0000-4000-8000-000000000125', '[
    {"ordre":1,"nom":"Cuisson des sucres","duree_estimee_min":35,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Sucre + glucose + eau à 145 °C au thermomètre à sonde, pas à l''œil",
       "Miel cuit à part à 125 °C : au-delà il caramélise et le nougat brunit",
       "Blancs montés mousseux AVANT que le sirop atteigne 140 °C, pas fermes",
       "Verser le sirop en filet sur la paroi de la cuve, batteur en 2e vitesse"]},
    {"ordre":2,"nom":"Assèchement et coulage","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Battre 8 min après le miel : le nougat doit filer et se détacher du fouet",
       "Test du bol d''eau froide : la boule doit être souple, pas cassante",
       "Couler entre deux feuilles azyme dans un cadre 40 × 30, égaliser au rouleau",
       "12 h à 18 °C — PAS au froid, l''humidité rendrait le nougat collant"]},
    {"ordre":3,"nom":"Détaillage et enrobage","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Couteau huilé, barres de 20 g",
       "Chocolat blanc tempéré 28-29 °C : au-dessus il reste mou et marque le doigt",
       "Trempage à la fourchette, égouttage franc, amandes concassées avant prise",
       "10 barres par boîte de 200 g, caissettes individuelles"]}]'),
  ('fab29000-0000-4000-8000-000000000126', '[
    {"ordre":1,"nom":"Pâte et précuisson","duree_estimee_min":45,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Pâte ferme, pétrissage court : le fekkas ne doit pas développer de réseau glutineux",
       "Incorporer amandes effilées et concassées À LA MAIN en fin, pour ne pas les casser",
       "Boudins de 4 cm de large, aplatis à 3 cm de haut",
       "Précuisson 170 °C 20 min : coloration blonde, le centre reste tendre"]},
    {"ordre":2,"nom":"Repos et tranchage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Repos UNE NUIT à température ambiante, boudins filmés",
       "Tranchage à 4 mm au couteau-scie, mouvement long, sans appuyer",
       "Une tranche à 4 mm, c''est la dentelle ; à 8 mm, c''est un fekkas ordinaire",
       "Écarter les tranches cassées : elles partent en chapelure, pas en boîte"]},
    {"ordre":3,"nom":"Séchage et conditionnement","duree_estimee_min":40,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Séchage 140 °C 15 min par face, retourner les tranches à la spatule",
       "Le fekkas doit sonner sec quand on le tapote",
       "Refroidissement complet sur grille",
       "36 tranches de 7 g par boîte de 250 g, absorbeur d''humidité"]}]'),
  ('fab29000-0000-4000-8000-000000000127', '[
    {"ordre":1,"nom":"Pâte et pépites","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Beurre pommade + cassonade crémés 4 min, pas plus : trop d''air fait gonfler puis retomber",
       "Pépites à la corne, en 2 fois, pâte encore froide",
       "Bouler à 10 g à la cuillère à pomme parisienne : la régularité fait la boîte",
       "30 min au froid avant cuisson"]},
    {"ordre":2,"nom":"Cuisson","duree_estimee_min":25,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
     "checklist_items":[
       "Espacer de 4 cm : un mini cookie s''étale de 2,5 fois son diamètre",
       "Cuisson 175 °C 8 min, bord pris et centre encore blond",
       "Taper la plaque sur le plan à la sortie : le cookie retombe et se craquelle",
       "Cassonade saupoudrée à chaud"]},
    {"ordre":3,"nom":"Mise en boîte","duree_estimee_min":15,"est_bloquante":false,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Refroidir 10 min sur plaque puis sur grille",
       "20 mini cookies de 10 g par boîte de 200 g",
       "DLC 12 jours ; au-delà le cookie sèche et perd son moelleux",
       "Allergènes : gluten, œuf, lait, soja (lécithine des pépites)"]}]'),
  ('fab29000-0000-4000-8000-000000000128', '[
    {"ordre":1,"nom":"Caramel tendre","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Caramel à sec 185 °C, décuit à la crème CHAUDE en 3 fois — froide, il fige en bloc",
       "Beurre à 40 °C en fin, mixer sans incorporer d''air",
       "Le caramel doit napper la spatule et faire un ruban qui se replie",
       "Refroidir à 30 °C avant garnissage"]},
    {"ordre":2,"nom":"Cookies et creux","duree_estimee_min":30,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Bouler à 25 g, espacer de 6 cm",
       "Cuisson 175 °C 11 min",
       "À la SORTIE du four, creuser le centre au dos d''une cuillère à café — le cookie est encore souple 30 secondes",
       "Laisser prendre 10 min avant de garnir"]},
    {"ordre":3,"nom":"Garnissage et finition","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Caramel à la poche dans le creux, 20 g par cookie, arasé au bord",
       "Fleur de sel ou cassonade sur le caramel encore souple",
       "Prise complète 2 h à 18 °C avant emballage",
       "8 cookies de 25 g par boîte de 200 g, caissettes"]}]'),
  ('fab29000-0000-4000-8000-000000000129', '[
    {"ordre":1,"nom":"Appareil à financier","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Beurre noisette à 165 °C, chinoisé, refroidi à 45 °C avant incorporation",
       "Blancs NON montés, juste détendus à la fourchette",
       "Repos de l''appareil 12 h à +4 °C : c''est ce qui donne le moelleux",
       "Détendre à la maryse avant dressage, ne jamais refouetter"]},
    {"ordre":2,"nom":"Abricots et cuisson","duree_estimee_min":35,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Oreillons secs détaillés en dés de 8 mm, roulés dans un peu de farine pour qu''ils ne coulent pas au fond",
       "Moules beurrés-farinés, appareil aux 3/4, dés d''abricot posés sur le dessus",
       "Cuisson 180 °C 18 min, puis 160 °C 6 min",
       "Contrôle : lame propre au centre, bord caramélisé"]},
    {"ordre":3,"nom":"Nappage et emballage","duree_estimee_min":20,"est_bloquante":false,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Démouler à chaud sur grille",
       "Nappage neutre au pinceau à 60 °C sur financier tiède",
       "Barquette de 100 g, 4 pièces de 25 g, filmée",
       "DLC 6 jours ; ne pas mettre au froid, le financier durcit"]}]'),
  ('fab29000-0000-4000-8000-000000000130', '[
    {"ordre":1,"nom":"Appareil et dattes","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Beurre noisette chinoisé à 45 °C, appareil reposé 12 h à +4 °C",
       "Dattes DÉNOYAUTÉES entières coupées en dés de 8 mm, pas de pâte de dattes",
       "Rouler les dés dans la farine de l''appareil : sinon ils tombent au fond du moule",
       "Contrôle : dénoyautage vérifié pièce par pièce"]},
    {"ordre":2,"nom":"Dressage et cuisson","duree_estimee_min":35,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Moules aux 3/4, dés de datte répartis puis amandes concassées",
       "Cuisson 180 °C 18 min puis 160 °C 6 min",
       "La datte caramélise vite : surveiller le dessus à partir de 20 min",
       "Lame propre au centre"]},
    {"ordre":3,"nom":"Finition et emballage","duree_estimee_min":20,"est_bloquante":false,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Démoulage à chaud, refroidissement sur grille",
       "Nappage neutre à 60 °C au pinceau",
       "Barquette de 100 g, 4 pièces de 25 g",
       "DLC 6 jours ; allergènes : gluten, œuf, lait, fruits à coque"]}]'),
  ('fab29000-0000-4000-8000-000000000131', '[
    {"ordre":1,"nom":"Farces et fonds","duree_estimee_min":60,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Farces REFROIDIES à +4 °C avant montage : une farce tiède détrempe le feuilletage",
       "Pâte feuilletée abaissée à 2,5 mm, pâte brisée à 2 mm",
       "Détailler les fonds et les remettre au froid 20 min avant garnissage",
       "Contrôle température des farces au thermomètre, tracé sur la fiche HACCP"]},
    {"ordre":2,"nom":"Façonnage des quatre bouchées","duree_estimee_min":70,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Feuilletés poulet-fromage : 26 g de pâte + 13 g de farce, soudure au doigt mouillé",
       "Briouates viande : feuille de pastilla pliée en triangle, 3 plis, jamais 2",
       "Mini-quiches : fond brisé foncé en caissette, appareil coulé à ras",
       "Chaussons gratinés : gruyère AU-DESSUS, il doit colorer"]},
    {"ordre":3,"nom":"Dorure, cuisson et conditionnement","duree_estimee_min":45,"est_bloquante":true,
     "timer_auto":true,"controle_qualite":true,"est_repetable":true,"nb_repetitions":2,"responsable_role":null,
     "checklist_items":[
       "Dorure en 2 passes, la seconde après 10 min de froid",
       "Cuisson 190 °C 18 min pour le feuilleté, 180 °C 22 min pour les quiches",
       "Refroidissement rapide en cellule à +4 °C en moins de 2 h (HACCP)",
       "Barquette de 250 g, 10 bouchées de 25 g, 2 à 3 de chaque sorte. DLC 48 h à +4 °C"]}]')
) AS v (id, etapes)
WHERE r.id = v.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Etapes de production des 6 PLATEAUX. Un plateau n'est pas une recette au
--    sens du labo : c'est une commande de sous-productions puis un dressage.
--    Les etapes le disent — d'abord ce qu'on sort du stock, ensuite le montage,
--    enfin le controle avant depart. La duree de dressage (40 a 70 min) est le
--    vrai poste de cout d'un plateau, celui que le ratio matiere ne montre pas.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes r SET etapes = v.etapes::jsonb, updated_at = NOW()
FROM (VALUES
  ('fab29000-0000-4000-8000-000000000132'::uuid, '[
    {"ordre":1,"nom":"Sortie des préparations beldi","duree_estimee_min":30,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Six familles à sortir : corne de gazelle, ghriba bahla, ghriba louza, maamoul, briouate amande, chebakia",
       "Contrôler la fraîcheur de chaque lot : rien de plus de 8 jours sur un plateau",
       "Écarter les pièces cassées ou mal calibrées AVANT le dressage, pas pendant",
       "Peser chaque famille séparément : 1 kg de plateau = 8 familles pesées, pas une estimation"]},
    {"ordre":2,"nom":"Miellage et finitions","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Chebakia trempée dans le sirop à 70 °C, 3 min, égouttée 20 min sur grille",
       "Sésame sur la chebakia encore tiède, il ne tient pas sur du froid",
       "Sucre glace sur les ghribas et le maamoul, jamais sur ce qui est miellé",
       "Amandes effilées torréfiées 150 °C 8 min"]},
    {"ordre":3,"nom":"Dressage du plateau","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Caissettes papier sous les pièces miellées, sinon elles collent au carton",
       "Alterner les couleurs : jamais deux pièces claires côte à côte",
       "Les pièces les plus hautes au centre, montage en dôme léger",
       "Pesée finale du plateau garni : 1 000 g ± 20 g (mini : 500 g ± 15 g)"]},
    {"ordre":4,"nom":"Filmage et contrôle départ","duree_estimee_min":10,"est_bloquante":false,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Film étirable posé sans écraser le dôme, ou cloche pour les grands plateaux",
       "Étiquette : composition, allergènes (gluten, œuf, lait, fruits à coque, sésame), DLC",
       "DLC 10 jours à température ambiante",
       "Photo du plateau avant départ (traçabilité présentation)"]}]'),
  ('fab29000-0000-4000-8000-000000000133', '[
    {"ordre":1,"nom":"Sortie des deux gammes","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Moitié beldi (corne, ghriba, maamoul) et moitié sec (sablés, diamantines, financiers, macarons)",
       "Vérifier que les sablés n''ont pas pris l''humidité : ils doivent claquer sous le doigt",
       "Les macarons sortent du froid 1 h avant, jamais dressés glacés",
       "Peser famille par famille"]},
    {"ordre":2,"nom":"Garnissage des macarons et sablés","duree_estimee_min":30,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Ganache lait à 26 °C, poche n° 8, coques appairées par taille",
       "Sablés roulés garnis de confiture, essuyer les bavures au bord",
       "Maturation des macarons 12 h à +4 °C avant dressage — sinon la coque est sèche",
       "Amandes effilées torréfiées, sésame grillé à sec"]},
    {"ordre":3,"nom":"Dressage","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Séparer visuellement les deux gammes : beldi d''un côté, petits fours de l''autre",
       "Caissettes pour tout ce qui est garni",
       "Ne pas poser un macaron contre une pièce miellée : il ramollit en 2 h",
       "Pesée finale : 1 000 g ± 20 g (mini : 500 g ± 15 g)"]},
    {"ordre":4,"nom":"Filmage et étiquetage","duree_estimee_min":10,"est_bloquante":false,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Film ou cloche selon la taille",
       "Allergènes : gluten, œuf, lait, fruits à coque, sésame, soja",
       "DLC 5 jours à +4 °C à cause des macarons garnis",
       "Contrôle visuel final par le chef de partie"]}]'),
  ('fab29000-0000-4000-8000-000000000134', '[
    {"ordre":1,"nom":"Sortie et tempérage","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Coques de macaron, dacquoise amande, croustillant praliné, sablés amande, financiers, cornes de gazelle",
       "Croustillant détaillé congelé au couteau chaud, puis tempéré 30 min",
       "Ganaches sorties 1 h avant : une ganache à 4 °C ne se poche pas",
       "Contrôle calibre : sur un plateau prestige, deux pièces de tailles différentes se voient"]},
    {"ordre":2,"nom":"Garnissage et enrobage","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Macarons ganache framboise, appairés, maturation 12 h à +4 °C",
       "Croustillant enrobé au chocolat noir tempéré 31-32 °C, égouttage franc",
       "Dacquoise garnie de ganache lait, montée en bandes puis détaillée à la lame chaude",
       "Pistaches concassées et amandes effilées posées avant cristallisation"]},
    {"ordre":3,"nom":"Dressage du plateau prestige","duree_estimee_min":55,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Caissettes plissées noires sous chaque pièce enrobée",
       "Rangées régulières, une famille par rangée, pas de mélange aléatoire",
       "Compter les pièces : un client qui paie 250 DH compte ce qu''il a",
       "Pesée finale : 1 000 g ± 20 g (mini : 500 g ± 15 g)"]},
    {"ordre":4,"nom":"Cloche et contrôle départ","duree_estimee_min":10,"est_bloquante":false,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Cloche transparente, jamais de film sur du chocolat enrobé (il marque)",
       "Étiquette allergènes : gluten, œuf, lait, fruits à coque, soja",
       "DLC 4 jours à +4 °C",
       "Validation chef obligatoire avant départ"]}]'),
  ('fab29000-0000-4000-8000-000000000135', '[
    {"ordre":1,"nom":"Sortie des cinq sablés","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Sablé beldi, sablé roulé, diamantine chocolat, diamantine nature, sablé prestige amande",
       "Tous doivent claquer sous le doigt : un sablé mou est un sablé à jeter",
       "Vérifier l''absorbeur d''humidité des bacs de stock",
       "Peser chaque sorte séparément"]},
    {"ordre":2,"nom":"Finitions","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Sablés roulés garnis de confiture le jour même, pas la veille",
       "Amandes effilées torréfiées 150 °C 8 min",
       "Sucre glace au tamis fin, uniquement sur les sablés clairs",
       "Écarter les pièces ébréchées"]},
    {"ordre":3,"nom":"Dressage","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Rangées alternées clair/foncé — c''est un plateau qui se juge à l''œil",
       "Diamantines couchées sur la tranche pour montrer le sucre grain",
       "Papier dentelle sous les sablés, pas de caissette (ils sont secs)",
       "Pesée finale : 1 000 g ± 20 g (mini : 500 g ± 15 g)"]},
    {"ordre":4,"nom":"Filmage","duree_estimee_min":8,"est_bloquante":false,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Film étirable serré + absorbeur d''humidité glissé sous le papier dentelle",
       "Allergènes : gluten, œuf, lait, fruits à coque",
       "DLC 21 jours à température ambiante — le plateau le plus solide de la gamme",
       "Ne jamais stocker au froid : les sablés reprennent l''humidité"]}]'),
  ('fab29000-0000-4000-8000-000000000136', '[
    {"ordre":1,"nom":"Sortie et montage des mignardises","duree_estimee_min":45,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Fonds de tartelette sucrée précuits, mini-choux, coques de macaron, financiers, madeleines",
       "Chablonner les fonds de tartelette au beurre de cacao : sans ça le crémeux les détrempe en 3 h",
       "Crèmes lissées à la maryse puis mises en poche, jamais refouettées",
       "Contrôle température : toutes les crèmes à +4 °C au départ"]},
    {"ordre":2,"nom":"Garnissage","duree_estimee_min":45,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Tartelettes citron : crémeux poché à ras, lissé à la palette coudée",
       "Mini-choux : garnis par le dessous à la douille n° 4, glaçage rocher par trempage",
       "Macarons ganache framboise, maturation 12 h à +4 °C",
       "Ganache montée ivoire pochée en rosace sur les financiers"]},
    {"ordre":3,"nom":"Dressage du plateau soirée","duree_estimee_min":45,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Caissettes plissées obligatoires : tout est garni de crème",
       "Nappage neutre au pinceau sur les fruits et les crémeux, il tient la brillance 24 h",
       "Ne pas dresser plus de 3 h avant le départ",
       "Pesée finale : 1 000 g ± 20 g (mini : 500 g ± 15 g)"]},
    {"ordre":4,"nom":"Froid et contrôle départ","duree_estimee_min":10,"est_bloquante":true,
     "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Cloche, stockage immédiat en vitrine réfrigérée +4 °C",
       "DLC 24 H — c''est le seul plateau de la gamme qui contient de la crème pâtissière",
       "Allergènes : gluten, œuf, lait, fruits à coque, soja",
       "Consigne client écrite sur l''étiquette : à consommer dans la journée"]}]'),
  ('fab29000-0000-4000-8000-000000000137', '[
    {"ordre":1,"nom":"Farces et fonds","duree_estimee_min":75,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Cinq garnitures : poulet-fromage, poulet pastilla, fruits de mer, viande hachée, appareil à quiche",
       "Refroidissement en cellule de toutes les farces à +4 °C en moins de 2 h — point HACCP bloquant",
       "Feuilletage abaissé à 2,5 mm, brisée à 2 mm, détaillés puis remis au froid",
       "Relevés de température tracés sur la fiche du jour"]},
    {"ordre":2,"nom":"Façonnage","duree_estimee_min":80,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Feuilletés poulet-fromage soudés au doigt mouillé, chiquetés à la pince",
       "Briouates pastilla : 3 plis, jamais 2, sinon la farce sort à la cuisson",
       "Bouchées fruits de mer en caissette feuilletée, garnies à ras",
       "Mini-quiches : appareil coulé à 2 mm du bord, il gonfle"]},
    {"ordre":3,"nom":"Dorure et cuisson","duree_estimee_min":45,"est_bloquante":true,"timer_auto":true,
     "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
     "checklist_items":[
       "Dorure en 2 passes, la seconde après 10 min de froid",
       "Gruyère et sésame posés après la seconde dorure",
       "Feuilletés 190 °C 18 min, quiches 180 °C 22 min, briouates 200 °C 12 min",
       "Cuisson à cœur 75 °C au thermomètre sur une pièce témoin de chaque sorte"]},
    {"ordre":4,"nom":"Dressage et départ","duree_estimee_min":40,"est_bloquante":true,"timer_auto":false,
     "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
     "checklist_items":[
       "Refroidissement rapide puis dressage sur plateau froid",
       "Cinq zones, une par garniture, étiquette de composition côté client",
       "Pesée finale : 1 200 g ± 25 g",
       "DLC 48 h à +4 °C. Allergènes : gluten, œuf, lait, poisson et crustacés, sésame"]}]')
) AS v (id, etapes)
WHERE r.id = v.id;

-- Garde-fou 7 : les 17 fiches ont bien recu leurs etapes.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM recipes
   WHERE id::text LIKE 'fab29000-0000-4000-8000-0000000001%'
     AND NOT is_base AND jsonb_array_length(etapes) >= 3;
  IF n <> 17 THEN
    RAISE EXCEPTION 'Etapes posees sur % fiches sur 17', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Conservation, DLC, allergenes, rendement — sur les 17 fiches.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes r SET instructions = v.txt, updated_at = NOW()
FROM (VALUES
  ('fab29000-0000-4000-8000-000000000121'::uuid,
   'Rendement : boite de 200 g, 15 diamants de 13 g.
Composition au kilo : 950 g de pate diamantine nature, 40 g de sucre grain, 10 g de sucre glace.
Conservation : 21 jours en boite hermetique avec absorbeur d''humidite, a l''abri de la lumiere.
Ne jamais stocker au froid : le sable reprend l''humidite et perd son croquant.
Allergenes : gluten, oeuf, lait, fruits a coque (amande).'),
  ('fab29000-0000-4000-8000-000000000122',
   'Rendement : boite de 200 g, 15 diamants de 13 g.
Composition au kilo : 940 g de pate diamantine fromage, 35 g de sesame, 25 g de gruyere de finition.
Conservation : 10 jours seulement — le fromage limite la DLC bien avant le sable.
Servir a temperature ambiante, en aperitif.
Allergenes : gluten, oeuf, lait, sesame.'),
  ('fab29000-0000-4000-8000-000000000123',
   'Rendement : boite de 200 g, 16 escargots de 12 g.
Composition au kilo : 870 g de pate a sable roule, 110 g de confiture de framboise, 20 g de sucre glace.
Une couche de confiture de plus de 2 mm deborde a la cuisson et brule sur la plaque.
Conservation : 21 jours en boite hermetique.
Allergenes : gluten, oeuf, lait, fruits a coque (amande).'),
  ('fab29000-0000-4000-8000-000000000124',
   'Rendement : boite de 200 g, 14 sables de 14 g.
Composition au kilo : 820 g de pate sable prestige amande, 80 g de ganache chocolat lait, 60 g d''amande effilee, 40 g de sucre glace.
Conservation : 12 jours a 18 °C. Pas de froid positif : le beurre de cacao de la ganache blanchit.
Allergenes : gluten, oeuf, lait, fruits a coque (amande), soja (lecithine).'),
  ('fab29000-0000-4000-8000-000000000125',
   'Rendement : boite de 200 g, 10 barres de 20 g.
Composition au kilo : 880 g de nougat tendre, 100 g de chocolat blanc d''enrobage, 20 g d''amande concassee.
PRIX A ARBITRER : vendu 15,00 DH la boite de 200 g, ce produit ressort a 39 % de cout matiere,
contre 20-31 % pour les autres boites du lot. Soit le prix est a revoir (25 DH aligne la gamme),
soit le grammage affiche est faux. La recette n''a pas ete appauvrie pour masquer l''ecart.
Conservation : 3 semaines a 18 °C, en caissettes individuelles, JAMAIS au froid (le nougat colle).
Allergenes : oeuf (blancs), lait (chocolat blanc), fruits a coque (amande).'),
  ('fab29000-0000-4000-8000-000000000126',
   'Rendement : boite de 250 g, 36 tranches de 7 g.
Composition au kilo : 970 g de pate a fekkas dentelle, 30 g de sucre glace.
La finesse de la tranche EST le produit : 4 mm au couteau-scie apres une nuit de repos.
Double cuisson : precuisson 170 °C 20 min, sechage 140 °C 15 min par face.
Conservation : 30 jours en boite hermetique avec absorbeur.
Allergenes : gluten, oeuf, lait, fruits a coque (amande), sesame.'),
  ('fab29000-0000-4000-8000-000000000127',
   'Rendement : boite de 200 g, 20 mini cookies de 10 g.
Composition au kilo : 900 g de pate a cookies, 80 g de pepites, 20 g de cassonade.
Conservation : 12 jours. Au-dela le cookie seche et perd le moelleux qui fait le produit.
Allergenes : gluten, oeuf, lait, soja (lecithine des pepites).'),
  ('fab29000-0000-4000-8000-000000000128',
   'Rendement : boite de 200 g, 8 cookies de 25 g.
Composition au kilo : 760 g de pate a cookies, 160 g de caramel tendre, 60 g de pepites, 20 g de cassonade.
Le creux se fait a la SORTIE du four, le cookie reste souple 30 secondes.
Conservation : 8 jours a 18 °C, caissettes individuelles (le caramel colle).
Allergenes : gluten, oeuf, lait, soja.'),
  ('fab29000-0000-4000-8000-000000000129',
   'Rendement : barquette de 100 g, 4 financiers de 25 g.
Composition au kilo : 800 g d''appareil a financier, 170 g d''abricot sec en des, 20 g de nappage, 10 g d''amande effilee.
Appareil repose 12 h a +4 °C avant dressage : c''est le repos qui fait le moelleux.
Conservation : 6 jours a 18 °C. Pas de froid : le financier durcit.
Allergenes : gluten, oeuf, lait, fruits a coque (amande), sulfites (abricot sec).'),
  ('fab29000-0000-4000-8000-000000000130',
   'Rendement : barquette de 100 g, 4 financiers de 25 g.
Composition au kilo : 730 g d''appareil a financier, 190 g de dattes denoyautees en des, 60 g d''amande concassee, 20 g de nappage.
Dattes ENTIERES denoyautees taillees en des, pas de pate de dattes : la pate fondrait dans l''appareil.
Conservation : 6 jours a 18 °C.
Allergenes : gluten, oeuf, lait, fruits a coque (amande).'),
  ('fab29000-0000-4000-8000-000000000131',
   'Rendement : barquette de 250 g, 10 bouchees de 25 g — 2 a 3 de chacune des 4 sortes.
Composition au kilo : 260 g de feuilletage + 130 g de farce poulet-fromage, 40 g de feuilles de pastilla
+ 120 g de farce viande hachee, 180 g de brisee salee + 180 g d''appareil a quiche, 60 g de gruyere, 30 g de dorure.
HACCP : refroidissement rapide en cellule a +4 °C en moins de 2 h apres cuisson, tracabilite obligatoire.
Conservation : 48 h a +4 °C. Rechauffage 160 °C 6 min avant service.
Allergenes : gluten, oeuf, lait, sesame.'),
  ('fab29000-0000-4000-8000-000000000132',
   'Deux references : MINI PLATEAU BELDI (500 g, 115 DH) et PLATEAU BELDI GRAND (1 000 g, 230 DH).
Composition au kilo : corne de gazelle (70 g de pate + 130 g de farce amande), ghriba bahla 130 g,
ghriba louza 110 g, maamoul (95 g de pate + 55 g de farce datte), briouate amande (35 g de feuille
+ 105 g de farce + 30 g d''huile), chebakia (90 g de pate + 60 g de sirop au miel),
amande effilee 40 g, sesame 25 g, sucre glace 25 g. Environ 50 pieces au kilo.
NOTE DE MODELISATION : le plateau est monte sur les PREPARATIONS DE BASE (pate + farce), jamais sur
les fiches produit fini de la mig 283 dont le rendement est exprime en PIECES. Meme matiere, meme cout,
sans l''erreur d''unite qu''une reference croisee introduirait dans v_recipe_total_cost.
Conservation : 10 jours a temperature ambiante, sous film.
Allergenes : gluten, oeuf, lait, fruits a coque (amande), sesame.'),
  ('fab29000-0000-4000-8000-000000000133',
   'Deux references : MINI PLATEAU MIXTE (500 g, 95 DH) et PLATEAU MIXTE (1 000 g, 190 DH).
Moitie beldi, moitie petits fours secs. C''est le plateau d''entree de gamme : le moins cher au kilo du lot.
Composition au kilo : ghriba bahla 120 g, corne de gazelle (55 + 100 g), maamoul (80 + 45 g),
sable beldi 140 g, sable roule 110 g, diamantine chocolat 100 g, financier 90 g,
macaron (60 g de coque + 40 g de ganache lait), confiture 25 g, amande effilee 20 g, sesame 15 g.
Monte sur les preparations de base (cf. plateau beldi).
Conservation : 5 jours a +4 °C a cause des macarons garnis.
Allergenes : gluten, oeuf, lait, fruits a coque, sesame, soja.'),
  ('fab29000-0000-4000-8000-000000000134',
   'Deux references : MINI PLATEAU PRESTIGE (500 g, 130 DH) et PLATEAU PRESTIGE (1 000 g, 250 DH).
Le plateau le plus riche du lot (~61 DH de matiere au kilo).
Composition au kilo : macaron (130 g de coque + 55 g de ganache framboise), croustillant praline 70 g,
dacquoise amande 110 g + 90 g de ganache lait, corne de gazelle (65 + 120 g),
sable prestige amande 130 g, financier 130 g, amande effilee 45 g, chocolat noir d''enrobage 35 g,
pistache 10 g, sucre glace 10 g.
Monte sur les preparations de base (cf. plateau beldi).
Conservation : 4 jours a +4 °C, sous cloche (jamais de film sur du chocolat enrobe).
Allergenes : gluten, oeuf, lait, fruits a coque (amande, noisette, pistache), soja.'),
  ('fab29000-0000-4000-8000-000000000135',
   'Deux references : MINI PLATEAU SABLE (500 g, 75 DH) et PLATEAU SABLE (1 000 g, 150 DH).
Cinq sables : beldi 260 g, roule 200 g, diamantine chocolat 180 g, diamantine nature 150 g,
prestige amande 110 g, plus 45 g de confiture, 25 g d''amande effilee et 30 g de sucre glace au kilo.
Le seul plateau 100 % sec de la gamme, et donc le seul qui se garde trois semaines.
Conservation : 21 jours a temperature ambiante, sous film, avec absorbeur d''humidite.
NE PAS stocker au froid : les sables reprennent l''humidite.
Allergenes : gluten, oeuf, lait, fruits a coque (amande).'),
  ('fab29000-0000-4000-8000-000000000136',
   'Deux references : MINI PLATEAU SOIREE (500 g, 120 DH) et PLATEAU SOIREE (1 000 g, 230 DH).
Mignardises fraiches : tartelettes citron (120 g de pate sucree + 70 g de cremeux), mini-choux
(80 g de pate a choux + 90 g de diplomate + 55 g de glacage rocher), financiers 100 g + 60 g de
ganache montee ivoire, madeleines 80 g, macarons (100 g de coque + 45 g de ganache framboise),
creme patissiere 100 g, chocolat noir 35 g, nappage 35 g, amande effilee 30 g.
Chablonner les fonds de tartelette au beurre de cacao, sinon le cremeux les detrempe en 3 heures.
DLC 24 H a +4 °C : c''est le seul plateau de la gamme qui contient de la creme patissiere.
Allergenes : gluten, oeuf, lait, fruits a coque, soja.'),
  ('fab29000-0000-4000-8000-000000000137',
   'Une seule reference : PLATEAU SALEE (1 200 g, 250 DH). Pas de mini au catalogue.
Composition au kilo : feuilletage 200 g + farce poulet-fromage 110 g, feuilles de pastilla 50 g +
farce poulet pastilla 110 g, brisee salee 130 g + appareil a quiche 130 g, farce fruits de mer 90 g,
farce viande hachee 90 g, gruyere 55 g, dorure 25 g, sesame 10 g. Environ 60 bouchees de 20 g.
HACCP : refroidissement rapide des farces a +4 °C en moins de 2 h, cuisson a coeur 75 °C verifiee
au thermometre sur une piece temoin de chaque sorte.
Conservation : 48 h a +4 °C, sous cloche. Rechauffage 160 °C 8 min avant service.
Allergenes : gluten, oeuf, lait, poisson et crustaces, sesame.')
) AS v (id, txt)
WHERE r.id = v.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Controles finaux. Ils echouent la migration plutot que de laisser passer
--     une fiche a cout nul ou une conversion d'unite ratee — les deux modes de
--     panne silencieuse du modele.
-- ─────────────────────────────────────────────────────────────────────────────

-- 11.1 Aucune conversion d'unite en echec sur les 22 formats. Une conversion
--      ratee (g -> unit) ne leve pas d'erreur : elle coute 1 000 fois trop cher.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT r.name || ' / ' || f.quantite_par_format || ' g', ', ') INTO bad
    FROM v_recipe_component_cost v
    JOIN recipe_formats f ON f.id = v.format_id
    JOIN recipes r        ON r.id = f.recipe_id
   WHERE f.recipe_id::text LIKE 'fab29000-0000-4000-8000-%'
     AND v.conversion_ok IS FALSE;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Conversions d''unite en echec sur les formats : %', bad;
  END IF;
END $$;

-- 11.2 Aucun cout nul, NULL ou negatif sur les 23 recettes du lot.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(r.name || ' = ' || COALESCE(v.total_cost::text, 'NULL'), ', ') INTO bad
    FROM recipes r
    LEFT JOIN v_recipe_total_cost v ON v.id = r.id
   WHERE r.id::text LIKE 'fab29000-0000-4000-8000-%'
     AND (v.total_cost IS NULL OR v.total_cost <= 0);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Recettes a cout nul ou NULL : %', bad;
  END IF;
END $$;

-- 11.3 Les 22 references du catalogue sont couvertes, chacune par un format
--      actif et un seul (contrainte uq_recipe_formats_product).
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
    FROM recipe_formats f
    JOIN products p ON p.id = f.product_id
   WHERE f.id::text LIKE 'fab29000-0000-4000-8000-0000000002%'
     AND f.is_active;
  IF n <> 22 THEN
    RAISE EXCEPTION 'Formats lies a un produit actif : % sur 22 attendus', n;
  END IF;
END $$;

-- 11.4 Aucun doublon de nom sur les preparations de base actives : une base en
--      double pollue la liste du chef et la validation la rejette.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(name || ' x' || n, ', ') INTO bad
    FROM (SELECT name, count(*) AS n FROM recipes
           WHERE is_base AND archived_at IS NULL GROUP BY name HAVING count(*) > 1) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Doublons de preparations de base : %', bad;
  END IF;
END $$;

-- 11.5 La somme des composants de chaque format tombe sur le poids vendu.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(r.name || ' ' || f.quantite_par_format || ' g -> ' || s.total || ' g', ', ') INTO bad
    FROM (SELECT format_id, sum(quantite) AS total
            FROM recipe_format_components GROUP BY format_id) s
    JOIN recipe_formats f ON f.id = s.format_id
    JOIN recipes r        ON r.id = f.recipe_id
   WHERE f.id::text LIKE 'fab29000-0000-4000-8000-0000000002%'
     AND abs(s.total - f.quantite_par_format) > f.quantite_par_format * 0.03;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Formats dont la nomenclature ne tombe pas sur le poids vendu : %', bad;
  END IF;
END $$;
