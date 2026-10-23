-- Migration 276 : Opera classique — reprise sur la fiche masterclass Ofauria
--
-- POURQUOI
--   La recette injectee par les mig 273/275 venait d'un CSV generique. La fiche
--   « Masterclass » elaboree pour Ofauria donne les pesees reelles du labo, et
--   elle est physiquement coherente la ou le CSV ne l'etait pas :
--
--     nomenclature CSV      -> 5 800 g dans un cadre de 7 200 cm3 (75 % rempli)
--     fiche masterclass     -> 7 160 g dans le meme cadre         (99 % rempli)
--
--   Le CSV sous-remplissait le cadre d'un tiers. On reprend donc les quantites,
--   et on ajoute ce que le CSV ignorait completement.
--
-- ─── LECTURE DE LA FICHE : PESEES vs QUANTITE MISE EN OEUVRE ───
--   La masterclass liste les PESEES (poids crus) d'une fournee. Ce qui entre
--   dans le cadre, c'est le NET, apres perte de transformation :
--     Biscuit Joconde       2 820 g pesee - 15 % = 2 397 g au cadre
--     Sirop imbibage cafe   1 440 g pesee -  5 % = 1 368 g
--     Creme au beurre cafe  1 400 g pesee -  1 % = 1 386 g
--     Ganache chocolat noir 1 050 g pesee -  2 % = 1 029 g
--     Glacage opera           880 g pesee -  0 % =   880 g
--     Chablonnage             100 g de chocolat, sans transformation
--                                                  ────────
--                                                   7 160 g
--   D'ou : recipes.yield_quantity = la pesee, recipe_format_components.quantite
--   = le net. Une fournee de chaque preparation couvre donc exactement un cadre
--   60x40x3 — c'est ainsi que la fiche est ecrite.
--
-- ─── CE QUE LA MASTERCLASS AJOUTE ───
--   1. Le CHABLONNAGE (100 g de chocolat noir sous le premier biscuit) —
--      absent du CSV. C'est lui qui empeche le sirop de traverser le fond.
--   2. Le GLACAGE devient une vraie recette : pate a glacer 400 + chocolat 400
--      + huile 80, au lieu d'un unique « GLACAGE CHOCOLAT ».
--   3. Les CREMES sont reformulees : la creme au beurre gagne 150 g d'oeufs
--      entiers (pate a bombe), la ganache passe a 1:1 chocolat/creme.
--   4. Les 5 ETAPES de production, avec temperatures, durees et points de
--      controle. La recette n'en avait aucune.
--   5. Conservation, rendement de decoupe et allergenes, en instructions.
--
--   Les pertes de mise en oeuvre par ligne (5 % creme, 2 % ganache, 5 % glacage)
--   viennent du premier fichier du chef ; la masterclass ne les contredit pas,
--   elles sont conservees.
--
-- PORTEE
--   Reecriture des 5 preparations et des 3 nomenclatures de l'Opera classique,
--   + 2 roles de composant manquants au referentiel, + les etapes et notes.
--   Rejouable. Aucune autre recette touchee.
--
-- INVERSION
--   Rejouer la mig 275 (elle repart des memes UUID et fait DELETE puis INSERT).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Roles de composant manquants. `role` est un VARCHAR libre qui reference
--    ref_entries « souplement » : « imbibage » etait deja utilise en donnee sans
--    exister au referentiel, donc absent du menu deroulant de l'editeur.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('component_roles', 'imbibage',    'Imbibage',    'Sirop ou punch appliqué sur un biscuit',            25, true),
  ('component_roles', 'chablonnage', 'Chablonnage', 'Fine couche de chocolat qui imperméabilise un fond', 26, true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ingredients. Doublons resolus par usage reel, comme en mig 275.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _mc_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande poudre', 'Sucre glace', 'Farine Fleur', 'Oeufs entiers liquides',
  'Blancs d''œufs liquides pasteurisés', 'Sucre semoule', 'Beurre', 'Eau',
  'Extrait de café liquide', 'Crème fraîche', 'Chocolat de couverture Noir 55%',
  'Oeufs Jaune', 'GLAÇAGE CHOCOLAT', 'Huile de table'
)
ORDER BY i.name,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _mc_ing;
  IF n <> 14 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 14 attendus', n;
  END IF;
END $$;

-- L'huile est stockee en litres, la recette la pese en grammes : sans densite,
-- 80 g seraient coutes comme 80 L. Meme piege que l'extrait de cafe (mig 275).
UPDATE ingredients SET densite_kg_l = 0.920
 WHERE name = 'Huile de table' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rendements des preparations = les pesees de la masterclass.
--    « Pate a glacer opera » devient « Glacage opera » : ce n'est plus un
--    produit unique mais un melange de trois composants.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET yield_quantity = 2820, yield_unit = 'g', perte_standard_pct = 15, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000005';   -- Biscuit Joconde
UPDATE recipes SET yield_quantity = 1440, yield_unit = 'g', perte_standard_pct = 5,  updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000002';   -- Sirop imbibage cafe
UPDATE recipes SET yield_quantity = 1400, yield_unit = 'g', perte_standard_pct = 1,  updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000003';   -- Creme au beurre cafe
UPDATE recipes SET yield_quantity = 1050, yield_unit = 'g', perte_standard_pct = 2,  updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000006';   -- Ganache chocolat noir
UPDATE recipes SET yield_quantity = 880,  yield_unit = 'g', perte_standard_pct = 0,
                   name = 'Glaçage opéra', updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000004';   -- Pate a glacer -> Glacage

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Compositions reecrites d'apres les pesees de la fiche.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_ingredients
 WHERE recipe_id IN ('0be7a000-0000-4000-8000-000000000002', '0be7a000-0000-4000-8000-000000000003',
                     '0be7a000-0000-4000-8000-000000000004', '0be7a000-0000-4000-8000-000000000005',
                     '0be7a000-0000-4000-8000-000000000006');

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette_id, ing.id, v.qte, 'g'
FROM (VALUES
  -- Biscuit Joconde — pesee 2 820 g
  ('0be7a000-0000-4000-8000-000000000005'::uuid, 'Amande poudre',                      600::numeric),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre glace',                              600),
  ('0be7a000-0000-4000-8000-000000000005', 'Oeufs entiers liquides',                   750),
  ('0be7a000-0000-4000-8000-000000000005', 'Farine Fleur',                             150),
  ('0be7a000-0000-4000-8000-000000000005', 'Blancs d''œufs liquides pasteurisés',      500),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre semoule',                            100),
  ('0be7a000-0000-4000-8000-000000000005', 'Beurre',                                   120),
  -- Sirop imbibage cafe — pesee 1 440 g
  ('0be7a000-0000-4000-8000-000000000002', 'Eau',                                     1000),
  ('0be7a000-0000-4000-8000-000000000002', 'Sucre semoule',                            400),
  ('0be7a000-0000-4000-8000-000000000002', 'Extrait de café liquide',                   40),
  -- Creme au beurre cafe — pesee 1 400 g (pate a bombe : oeufs entiers + jaunes)
  ('0be7a000-0000-4000-8000-000000000003', 'Eau',                                      120),
  ('0be7a000-0000-4000-8000-000000000003', 'Sucre semoule',                            400),
  ('0be7a000-0000-4000-8000-000000000003', 'Oeufs entiers liquides',                   150),
  ('0be7a000-0000-4000-8000-000000000003', 'Oeufs Jaune',                              100),
  ('0be7a000-0000-4000-8000-000000000003', 'Beurre',                                   600),
  ('0be7a000-0000-4000-8000-000000000003', 'Extrait de café liquide',                   30),
  -- Ganache chocolat noir — pesee 1 050 g, ratio 1:1 chocolat/creme
  ('0be7a000-0000-4000-8000-000000000006', 'Chocolat de couverture Noir 55%',          500),
  ('0be7a000-0000-4000-8000-000000000006', 'Crème fraîche',                            500),
  ('0be7a000-0000-4000-8000-000000000006', 'Beurre',                                    50),
  -- Glacage opera — pesee 880 g
  ('0be7a000-0000-4000-8000-000000000004', 'GLAÇAGE CHOCOLAT',                         400),
  ('0be7a000-0000-4000-8000-000000000004', 'Chocolat de couverture Noir 55%',          400),
  ('0be7a000-0000-4000-8000-000000000004', 'Huile de table',                            80)
) AS v (recette_id, ingredient, qte)
JOIN _mc_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Nomenclature par format — quantites NETTES.
--    Le cadre opera porte les valeurs de la fiche ; les deux autres cadres
--    suivent le rapport de SURFACE deja retenu par le fichier d'origine :
--      60x40 = 2 400 cm2 (x1) · 40x30 = 1 200 cm2 (x0,5) · 60x15 = 900 cm2 (x0,375)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id IN ('0be7a000-0000-4000-8000-0000000000f1',
                     '0be7a000-0000-4000-8000-0000000000f2',
                     '0be7a000-0000-4000-8000-0000000000f3');

-- Sous-recettes
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES
  -- Cadre opera 60x40x3 — 7 160 g
  ('0be7a000-0000-4000-8000-0000000000f1', 'biscuit',   '0be7a000-0000-4000-8000-000000000005', 2397.00, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f1', 'imbibage',  '0be7a000-0000-4000-8000-000000000002', 1368.00, 'g', 0, 3),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', '0be7a000-0000-4000-8000-000000000003', 1386.00, 'g', 5, 4),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', '0be7a000-0000-4000-8000-000000000006', 1029.00, 'g', 2, 5),
  ('0be7a000-0000-4000-8000-0000000000f1', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  880.00, 'g', 5, 6),
  -- Cadre demi 40x30x4,5 — x0,5
  ('0be7a000-0000-4000-8000-0000000000f2', 'biscuit',   '0be7a000-0000-4000-8000-000000000005', 1198.50, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f2', 'imbibage',  '0be7a000-0000-4000-8000-000000000002',  684.00, 'g', 0, 3),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', '0be7a000-0000-4000-8000-000000000003',  693.00, 'g', 5, 4),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', '0be7a000-0000-4000-8000-000000000006',  514.50, 'g', 2, 5),
  ('0be7a000-0000-4000-8000-0000000000f2', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  440.00, 'g', 5, 6),
  -- Cadre bande 60x15x4,5 — x0,375
  ('0be7a000-0000-4000-8000-0000000000f3', 'biscuit',   '0be7a000-0000-4000-8000-000000000005',  898.88, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f3', 'imbibage',  '0be7a000-0000-4000-8000-000000000002',  513.00, 'g', 0, 3),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', '0be7a000-0000-4000-8000-000000000003',  519.75, 'g', 5, 4),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', '0be7a000-0000-4000-8000-000000000006',  385.88, 'g', 2, 5),
  ('0be7a000-0000-4000-8000-0000000000f3', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  330.00, 'g', 5, 6);

-- Chablonnage : chocolat fondu applique tel quel, donc INGREDIENT direct et non
-- sous-recette. Pose en ordre 2, entre le biscuit et l'imbibage — c'est sa place
-- au montage : il rend le fond etanche avant que le sirop arrive.
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT v.format_id, 'chablonnage', ing.id, v.qte, 'g', 0, 2
FROM (VALUES
  ('0be7a000-0000-4000-8000-0000000000f1'::uuid, 100.00::numeric),
  ('0be7a000-0000-4000-8000-0000000000f2',        50.00),
  ('0be7a000-0000-4000-8000-0000000000f3',        37.50)
) AS v (format_id, qte)
JOIN _mc_ing ing ON ing.name = 'Chocolat de couverture Noir 55%';

-- Poids d'une piece = nomenclature du format / nb de pieces.
UPDATE recipe_formats SET quantite_par_format = 102.29, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-0000000000f1';   -- 7 160 / 70
UPDATE recipe_formats SET quantite_par_format = 111.88, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-0000000000f2';   -- 3 580 / 32
UPDATE recipe_formats SET quantite_par_format = 149.17, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-0000000000f3';   -- 2 685 / 18

-- Miroir du format par defaut (mig 205/218), relu par v_recipe_total_cost.
DELETE FROM recipe_components WHERE recipe_id = '0be7a000-0000-4000-8000-000000000001';
INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT '0be7a000-0000-4000-8000-000000000001', c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
WHERE c.format_id = '0be7a000-0000-4000-8000-0000000000f1';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les 5 etapes de la masterclass, avec leurs points de controle.
--    Les checklists reprennent les « astuces de pro » : ce sont elles qui font
--    la difference entre un opera correct et un opera net.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Biscuit Joconde","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":3,"responsable_role":null,
   "checklist_items":[
     "Tamiser poudre d''amande + sucre glace ensemble",
     "Monter au ruban 10 min avec les œufs entiers tempérés à 20 °C",
     "Blancs au bec d''oiseau : souples, jamais fermes — sinon ils grainent à l''incorporation",
     "Beurre fondu à 45 °C : pré-émulsionner avec 2 cuillères de pâte avant de reverser",
     "Cuisson 200 °C / 7 min sur plaques doublées, couleur blond doré",
     "Sortie immédiate sur grille"]},
  {"ordre":2,"nom":"Chablonnage et imbibage","duree_estimee_min":20,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Chocolat noir fondu à 45 °C sur le premier biscuit",
     "Racler fermement : la couche doit être quasi transparente, elle bouche les pores",
     "Sirop tiède 30-35 °C sur biscuit FROID",
     "Peser le sirop et le diviser par 3 : même quantité sur chaque couche"]},
  {"ordre":3,"nom":"Émulsions : ganache et crème au beurre","duree_estimee_min":40,"est_bloquante":true,
   "timer_auto":false,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ganache : crème chaude versée en 3 fois, frictionner au centre pour créer le noyau élastique",
     "Mixeur plongeant gardé au fond : zéro bulle d''air",
     "Crème au beurre : sirop à 118 °C versé sur la pâte à bombe",
     "Pâte à bombe ET beurre pommade à 24 °C tous les deux",
     "Si la crème graine : coup de chalumeau très rapide sur la cuve, en fouettant"]},
  {"ordre":4,"nom":"Montage dans le cadre","duree_estimee_min":30,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ordre : biscuit chablonné › crème › biscuit › ganache › biscuit › crème",
     "Tasser chaque biscuit avec une plaque propre pour une planéité absolue",
     "Ganache : 15 min de cristallisation à l''air libre, JAMAIS au frigo (condensation)",
     "Lissage final à la règle aluminium 60 cm posée sur les bords du cadre"]},
  {"ordre":5,"nom":"Surgélation, glaçage et découpe","duree_estimee_min":240,"est_bloquante":true,
   "timer_auto":true,"controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Surgélation à cœur à -18 °C",
     "Glaçage chinoisé, coulé à 32-35 °C",
     "Palette plus large que le cadre, tirer vers soi en UN SEUL GESTE — retoucher rend le glaçage mat",
     "Découpe : lame trempée dans l''eau très chaude puis ESSUYÉE SÈCHE à chaque coupe",
     "70 parts de 8 × 3,8 cm"]}
]'::jsonb,
instructions = 'Rendement : 70 parts de 8 × 3,8 cm sur cadre 60x40x3 cm.

Conservation : 3 jours à +4 °C. 2 mois à -18 °C AVANT glaçage.

Ordre de montage : biscuit chablonné › crème au beurre › biscuit › ganache › biscuit › crème au beurre › glaçage.

Allergènes : gluten (farine), œufs, lait et beurre, fruits à coque (amande), soja (lécithine du chocolat).

Source : fiche technique Masterclass Ôfauria.',
updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000001';
