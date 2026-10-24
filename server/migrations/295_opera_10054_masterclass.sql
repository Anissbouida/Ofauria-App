-- Migration 295 : Opéra (SKU 10054) — intégration de la fiche masterclass V1
--
-- POURQUOI
--   Nouvelle fiche masterclass Opéra (cadre 40 × 30 × 2,5 cm → 24 parts de 100 g)
--   rédigée par le chef, bilingue FR/darija, avec pesées, points de contrôle et
--   pannes. Elle remplace l'ancienne fiche Opéra (mig 273, cadre 60 × 40 → 70
--   pièces) : structure de couches différente (ajout d'un CHABLON, punch vanillé,
--   ganache 60 %, glaçage pâte-à-glacer + huile), pesées différentes.
--
--   État de départ : la recette produit Opéra `0be7a000-…-001` a été SUPPRIMÉE
--   sur cet environnement (bulk-archive du 23/08), et ses 5 bases `0be7a000-…-`
--   sont archivées et plus référencées par aucune recette active (vérifié).
--   Ce namespace est donc réutilisable sans effet de bord : on recrée la recette
--   produit et on réécrit/désarchive les bases sur la nouvelle formule.
--
--   Convention établie (migs 291-294) :
--     - étapes de FABRICATION d'une base → sur la base (biscuit, punch, crème,
--       ganache, glaçage) ; étapes d'ASSEMBLAGE → sur le produit (chablonnage,
--       montage, glaçage, parage/découpe, décor) ;
--     - darija dans des champs SÉPARÉS du JSONB : `nom_ar` + `checklist_items_ar`
--       (jamais fusionnée dans checklist_items, sinon rendue en Helvetica → points).
--
--   quantite_par_format (mig 273) = somme des composants / nb de pièces :
--     (80 chablon + 1050 biscuit + 330 punch + 600 crème + 400 ganache
--      + 300 glaçage) = 2 760 g / 24 = 115 g. Parage -310 g → cadre paré 2 450 g.
--
-- PORTÉE
--   + 1 contenant « Cadre opéra 40x30x2,5 cm » (24 parts)
--   + recette produit `0be7a000-…-001` (recréée, compose)
--   + 5 bases `0be7a000-…-00[2-6]` désarchivées + réécrites (formule fiche 10054)
--   + 1 format + 6 composants (5 sous-recettes + chablon en ingrédient direct)
--   + miroir recipe_components
--   + étapes bilingues : 5 sur les bases, 5 sur le produit + instructions
--   Idempotent : ON CONFLICT DO NOTHING / DELETE+INSERT ciblés.
--
-- INVERSION
--   DELETE FROM recipes WHERE id = '0be7a000-0000-4000-8000-000000000001';
--   Ré-archiver les bases et restaurer la formule mig 273 si besoin.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Résolution des ingrédients (doublons : on préfère le kg le plus utilisé).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _op295_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Amande poudre', 'Sucre glace', 'Oeufs entiers liquides', 'Farine Fleur',
  'Blancs d''œufs liquides pasteurisés', 'Sucre semoule', 'Beurre',
  'Sel de table fin', 'Extrait de café liquide', 'Arôme vanille intense 1022',
  'Crème fraîche', 'Chocolat de couverture Noir 55%', 'GLAÇAGE CHOCOLAT',
  'Huile de table'
)
ORDER BY i.name,
         (i.unit = 'kg') DESC,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _op295_ing;
  IF n <> 14 THEN
    RAISE EXCEPTION 'Opéra 10054 : % ingrédient(s) résolus sur 14 attendus', n;
  END IF;
END $$;

-- Densités défensives (unités en litre coûtées comme des grammes sinon).
UPDATE ingredients SET densite_kg_l = 1.000
 WHERE name = 'Extrait de café liquide' AND densite_kg_l IS NULL;
UPDATE ingredients SET densite_kg_l = 0.920
 WHERE name = 'Huile de table' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Contenant Cadre opéra 40x30x2,5 cm (24 parts).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production_contenants
  (nom, type_production, unite_lancement, quantite_theorique,
   longueur_cm, largeur_cm, profondeur_cm, type_decoupe, nb_pieces_decoupe, is_active)
SELECT 'Cadre opéra 40x30x2,5 cm', 2, 'cadre', 24, 40, 30, 2.5, 'damier', 24, true
WHERE NOT EXISTS (
  SELECT 1 FROM production_contenants WHERE nom = 'Cadre opéra 40x30x2,5 cm'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bases : désarchivage + upsert (formule fiche 10054).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct)
VALUES
  ('0be7a000-0000-4000-8000-000000000005', 'Biscuit Joconde',       true, 'ratio_poids', 1262, 'g', 17),
  ('0be7a000-0000-4000-8000-000000000002', 'Punch café Opéra',      true, 'ratio_poids',  418, 'g',  5),
  ('0be7a000-0000-4000-8000-000000000003', 'Crème au beurre café',  true, 'ratio_poids',  703, 'g',  1),
  ('0be7a000-0000-4000-8000-000000000006', 'Ganache chocolat noir', true, 'ratio_poids',  490, 'g',  2),
  ('0be7a000-0000-4000-8000-000000000004', 'Glaçage opéra',         true, 'ratio_poids',  440, 'g',  0)
ON CONFLICT (id) DO NOTHING;

UPDATE recipes
   SET archived_at = NULL, is_base = true, mode_cout = 'ratio_poids', yield_unit = 'g',
       yield_quantity = v.yq, perte_standard_pct = v.perte, name = v.nom, updated_at = NOW()
FROM (VALUES
  ('0be7a000-0000-4000-8000-000000000005'::uuid, 'Biscuit Joconde',       1262::numeric, 17::numeric),
  ('0be7a000-0000-4000-8000-000000000002',       'Punch café Opéra',       418,          5),
  ('0be7a000-0000-4000-8000-000000000003',       'Crème au beurre café',   703,          1),
  ('0be7a000-0000-4000-8000-000000000006',       'Ganache chocolat noir',  490,          2),
  ('0be7a000-0000-4000-8000-000000000004',       'Glaçage opéra',          440,          0)
) AS v (id, nom, yq, perte)
WHERE recipes.id = v.id;

DELETE FROM recipe_ingredients
 WHERE recipe_id IN (
   '0be7a000-0000-4000-8000-000000000005', '0be7a000-0000-4000-8000-000000000002',
   '0be7a000-0000-4000-8000-000000000003', '0be7a000-0000-4000-8000-000000000006',
   '0be7a000-0000-4000-8000-000000000004'
 );

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.rid::uuid, ing.id, v.qte, 'g'
FROM (VALUES
  -- Biscuit Joconde — 1262 g cru (3 feuilles 40x30), perte cuisson 17 %
  ('0be7a000-0000-4000-8000-000000000005', 'Amande poudre',                      260::numeric),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre glace',                        260),
  ('0be7a000-0000-4000-8000-000000000005', 'Oeufs entiers liquides',             350),
  ('0be7a000-0000-4000-8000-000000000005', 'Farine Fleur',                        70),
  ('0be7a000-0000-4000-8000-000000000005', 'Blancs d''œufs liquides pasteurisés', 230),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre semoule',                       40),
  ('0be7a000-0000-4000-8000-000000000005', 'Beurre',                              50),
  ('0be7a000-0000-4000-8000-000000000005', 'Sel de table fin',                     2),
  -- Punch café Opéra — 418 g, perte 5 % à l'ébullition
  ('0be7a000-0000-4000-8000-000000000002', 'Eau',                                250),
  ('0be7a000-0000-4000-8000-000000000002', 'Sucre semoule',                      150),
  ('0be7a000-0000-4000-8000-000000000002', 'Extrait de café liquide',             15),
  ('0be7a000-0000-4000-8000-000000000002', 'Arôme vanille intense 1022',           3),
  -- Crème au beurre café — 703 g, perte 1 %
  ('0be7a000-0000-4000-8000-000000000003', 'Sucre semoule',                      200),
  ('0be7a000-0000-4000-8000-000000000003', 'Eau',                                 65),
  ('0be7a000-0000-4000-8000-000000000003', 'Oeufs Jaune',                         80),
  ('0be7a000-0000-4000-8000-000000000003', 'Beurre',                             340),
  ('0be7a000-0000-4000-8000-000000000003', 'Extrait de café liquide',             18),
  -- Ganache chocolat noir — 490 g, perte 2 % (choc 60 % → couverture 55 % au réf.)
  ('0be7a000-0000-4000-8000-000000000006', 'Crème fraîche',                      200),
  ('0be7a000-0000-4000-8000-000000000006', 'Chocolat de couverture Noir 55%',    250),
  ('0be7a000-0000-4000-8000-000000000006', 'Beurre',                              40),
  -- Glaçage opéra — 440 g, pas de perte
  ('0be7a000-0000-4000-8000-000000000004', 'Chocolat de couverture Noir 55%',    250),
  ('0be7a000-0000-4000-8000-000000000004', 'GLAÇAGE CHOCOLAT',                    150),
  ('0be7a000-0000-4000-8000-000000000004', 'Huile de table',                      40)
) AS v (rid, ingredient, qte)
JOIN (
  SELECT name, id FROM _op295_ing
  UNION ALL
  SELECT i.name, i.id FROM ingredients i
   WHERE i.name IN ('Eau', 'Oeufs Jaune')
) ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recette produit Opéra (composée : coût via la nomenclature du format).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct)
VALUES ('0be7a000-0000-4000-8000-000000000001', 'Opéra', false, 'compose', 24, 'unit', 0)
ON CONFLICT (id) DO NOTHING;

UPDATE recipes
   SET archived_at = NULL, name = 'Opéra', is_base = false, mode_cout = 'compose',
       yield_quantity = 24, yield_unit = 'unit', perte_standard_pct = 0, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-000000000001';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Format Cadre 40x30 → 24 parts, 115 g/part (poids nomenclature / nb).
--
--    En prod la recette Opéra n'a jamais été supprimée : elle porte encore les
--    3 formats de la mig 273 (f1 cadre 60x40 par défaut, f2, f3), et l'index
--    unique uq_recipe_formats_default (un seul format par défaut par recette)
--    refusait l'insertion du cadre 40x30 -> « duplicate key value violates
--    unique constraint "uq_recipe_formats_default" ». Comme en mig 303, on
--    retire d'abord le défaut aux autres formats : la fiche masterclass devient
--    le format par défaut, les anciens cadres restent disponibles.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipe_formats
   SET is_default = false, updated_at = NOW()
 WHERE recipe_id = '0be7a000-0000-4000-8000-000000000001'
   AND is_default
   AND id <> '0be7a000-0000-4000-8000-0000000000f4';

INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre)
SELECT '0be7a000-0000-4000-8000-0000000000f4'::uuid,
       '0be7a000-0000-4000-8000-000000000001'::uuid, c.id, 115, 'g', 24, true, 1
FROM production_contenants c
WHERE c.nom = 'Cadre opéra 40x30x2,5 cm'
  AND NOT EXISTS (SELECT 1 FROM recipe_formats WHERE id = '0be7a000-0000-4000-8000-0000000000f4');

UPDATE recipe_formats
   SET quantite_par_format = 115, quantite_par_format_unite = 'g',
       nb_par_defaut = 24, is_default = true, is_active = true, updated_at = NOW()
 WHERE id = '0be7a000-0000-4000-8000-0000000000f4';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Nomenclature du format (consommation par cadre, fiche §2.1).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id = '0be7a000-0000-4000-8000-0000000000f4';

-- 5a. Sous-recettes.
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES
  ('0be7a000-0000-4000-8000-0000000000f4', 'biscuit',   '0be7a000-0000-4000-8000-000000000005', 1050, 'g', 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f4', 'imbibage',  '0be7a000-0000-4000-8000-000000000002',  330, 'g', 0, 3),
  ('0be7a000-0000-4000-8000-0000000000f4', 'garniture', '0be7a000-0000-4000-8000-000000000003',  600, 'g', 0, 4),
  ('0be7a000-0000-4000-8000-0000000000f4', 'garniture', '0be7a000-0000-4000-8000-000000000006',  400, 'g', 0, 5),
  ('0be7a000-0000-4000-8000-0000000000f4', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  300, 'g', 0, 6);

-- 5b. Chablon = ingrédient direct (80 g de chocolat noir 55 % fondu).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT '0be7a000-0000-4000-8000-0000000000f4'::uuid, 'chablonnage', ing.id, 80, 'g', 0, 1
FROM _op295_ing ing WHERE ing.name = 'Chocolat de couverture Noir 55%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Miroir recipe_components (le format par défaut).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components WHERE recipe_id = '0be7a000-0000-4000-8000-000000000001';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT '0be7a000-0000-4000-8000-000000000001', c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
WHERE c.format_id = '0be7a000-0000-4000-8000-0000000000f4';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Étapes de FABRICATION sur les bases (bilingues FR + darija).
-- ─────────────────────────────────────────────────────────────────────────────

-- 7a. Biscuit Joconde.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Biscuit Joconde","nom_ar":"البيسكوي جوكوند","duree_estimee_min":50,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Préchauffer le four à 230 °C, 20 min — four TRÈS chaud, essentiel",
     "Chemiser 3 plaques 40 × 30 de papier, tamiser la farine, beurre fondu à 45 °C",
     "Monter amande + sucre glace + œufs entiers + sel au fouet vitesse max 8-10 min : ruban, volume doublé, couleur pâle",
     "Blancs en cuve propre et SÈCHE : monter vitesse moyenne, serrer avec le sucre semoule en 3 fois → bec d''oiseau souple (pas ferme)",
     "Incorporer la farine tamisée à la maryse, puis 1/3 des blancs (énergique), puis le reste délicatement — de bas en haut, 20-25 mouvements",
     "Beurre 45 °C : mélanger d''abord avec une louche d''appareil, puis reverser",
     "400 g par plaque, étaler fin et RÉGULIER à la palette longue (épaisseur égale partout)",
     "Cuisson 230 °C, 6-8 min : doré clair (pas brun), surface qui revient, bords décollés, souple sans casser",
     "Sortir AUSSITÔT de la plaque (avec le papier), refroidir, puis couper au format cadre 40 × 30"],
   "checklist_items_ar":[
     "شعل الفران على 230 درجة وخليه يسخن 20 دقيقة — الفران خاصو يكون سخون بزاف",
     "بطن 3 بلاطوات 40 × 30 بورق الطياب، غربل الفارينة، ذوّب الزبدة حتى 45 درجة",
     "اضرب اللوز المطحون + السكر الگلاصي + البيض + الملحة بالفوي فالسرعة القصوى 8-10 دقايق : الروبان، الحجم تضاعف، اللون فاتح",
     "البياض فكيوف نقي ونشف : اضرب فالسرعة المتوسطة، زيد السكر الرقيق على 3 مرات حتى منقار الطير الطري (ماشي قاسح)",
     "زيد الفارينة المغربلة بالماريز، ومن بعد ثلث البياض بصح، ومن بعد الباقي بالرفق — من تحت لفوق، 20-25 حركة",
     "الزبدة (45 درجة) : خلطها أولاً مع مغرفة ديال الخليط، ومن بعد رجعها للسلطانية",
     "400 غرام فكل بلاطو، فرشها رقيقة ومتساوية بالپاليط الطويل (السماكة بحال بحال من كل جيهة)",
     "الطياب 230 درجة، 6-8 دقايق : ذهبي فاتح ماشي بني، الوجه كيرجع، الجنابات مفكوكين، كيتحنى بلا ما يتكسر",
     "خرجو دغيا من البلاطو بالورق، خليه يبرد، ومن بعد قصو على قياس الكادر 40 × 30"]}
]'::jsonb,
  instructions = 'Biscuit Joconde Opéra — 1 262 g cru pour 3 feuilles de 40 × 30 (400 g d''appareil/feuille), perte cuisson ~17 % → 3 feuilles nettes ≈ 1 050 g.
Amande + farine faible = biscuit fin, souple, non cassant. Ne pas modifier les ratios.
Conservation : 48 h à 4 °C filmé, 1 mois à −18 °C.
🇲🇦 البيسكوي جوكوند ماشي جينواز : اللوز بزاف والفارينة قليلة، ولهذا كيكون رقيق وطري ومرن. ما تبدلش النسب.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000005';

-- 7b. Punch café.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Punch café","nom_ar":"السيرو ديال القهوة","duree_estimee_min":15,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":false,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Bouillir eau + sucre jusqu''à dissolution complète du sucre",
     "Hors du feu, ajouter le café soluble + la vanille, remuer jusqu''à dissolution",
     "Refroidir COMPLÈTEMENT avant usage — un sirop chaud ferait fondre la crème au beurre de la couche du dessous",
     "Se conserve 1 semaine au frigo"],
   "checklist_items_ar":[
     "غلي الما والسكر حتى يذوب السكر كامل",
     "حيدو من على العافية، زيد القهوة الذوابة والفانيّة وحرك حتى يذوب كلشي",
     "خليه يبرد نهائياً قبل ما تخدم بيه — السيرو السخون كيذوّب الكريم بالزبدة لي تحت",
     "كيتحفظ سيمانة فالفريكو"]}
]'::jsonb,
  instructions = 'Punch café — 418 g. Consommation : 110 g par biscuit × 3 = 330 g.
Goût plus fort : remplacer l''eau par 150 g d''espresso fort + 100 g d''eau.
🇲🇦 السيرو خاصو يكون بارد نيشان قبل الاستعمال. كيتحفظ سيمانة فالفريكو.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000002';

-- 7c. Crème au beurre café.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Crème au beurre café (pâte à bombe)","nom_ar":"الكريم بالزبدة بالقهوة","duree_estimee_min":30,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sucre + eau chauffés SANS remuer jusqu''à 118 °C (nettoyer les parois au pinceau mouillé)",
     "En parallèle, blanchir les jaunes au batteur, vitesse moyenne",
     "À 118 °C, verser en filet fin sur le CÔTÉ de la cuve — jamais sur le fouet (fils de sucre durs)",
     "Battre vitesse max jusqu''au refroidissement à 25 °C (8-10 min) — sonder",
     "Passer à la feuille, incorporer le beurre à 20 °C morceau par morceau (attendre que chaque morceau disparaisse)",
     "Ajouter l''extrait de café, battre 1 min",
     "Lisse/pâle/aéré = OK · granuleux = beurre trop froid (chauffer la cuve au chalumeau) · liquide = trop chaud (15 min frigo + refouetter)"],
   "checklist_items_ar":[
     "السكر والما بلا ما تحرك حتى 118 درجة (نقي الجنابات بشيتا مبللة)",
     "فنفس الوقت ضرب الصفار فالباتور فالسرعة المتوسطة حتى يبيّض",
     "منين السكر يوصل 118، صبو على الصفار فخيط رقيق على الجنب ديال الكيوف — ماشي فوق الفوي",
     "كمل الضرب فالسرعة القصوى حتى يبرد ويوصل 25 درجة (8-10 دقايق) — قيس",
     "بدل بالفوي المسطح، زيد الزبدة (20 درجة) قطعة بقطعة، استنى تختفي كل وحدة",
     "زيد خلاصة القهوة وضرب دقيقة",
     "أملس فاتح منتفخ = مزيان · مقطع بحبات = الزبدة باردة (سخن السلطانية بالشالوميو) · سايل = سخون (15 دقيقة فريكو وعاود ضربو)"]}
]'::jsonb,
  instructions = 'Crème au beurre café — 703 g. Consommation : 380 g (couche intérieure) + 220 g (couche supérieure) = 600 g.
Beurre à 20 °C EXACTEMENT — sortir 2 h avant (hiver) / 1 h (été). À utiliser le jour même.
🇲🇦 الزبدة ف 20 درجة بالضبط، ماشي باردة وماشي ذايبة. خدم بالكريم نفس النهار.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000003';

-- 7d. Ganache chocolat noir.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Ganache chocolat","nom_ar":"الگاناش ديال الشوكلاط","duree_estimee_min":20,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Couper le chocolat en petits morceaux",
     "Chauffer la crème jusqu''au frémissement — pas d''ébullition forte",
     "Verser sur le chocolat en 3 fois, remuer à la maryse depuis le CENTRE en petits cercles (émulsion : lisse et brillant au centre)",
     "À 40 °C, ajouter le beurre, mélanger jusqu''à disparition",
     "Refroidir à 30-32 °C avant de couler (trop chaud fait fondre la crème dessous, trop froid laisse des creux)"],
   "checklist_items_ar":[
     "قطع الشوكلاط قطع صغار",
     "سخن الكريمة حتى تبدا تفور — ماشي غليان قوي",
     "صبها على الشوكلاط على 3 مرات، حرك بالماريز من الوسط فدوائر صغار (الإمولسيون : لامع وأملس من الوسط)",
     "منين يوصل 40 درجة زيد الزبدة وحرك حتى تختفي",
     "خليه يبرد حتى 30-32 درجة قبل ما تصبو (سخون كيذوّب الكريم لي تحت، بارد كيخلي حفر)"]}
]'::jsonb,
  instructions = 'Ganache chocolat noir — 490 g. Consommation : 400 g. Chocolat noir 60 % (couverture 55 % au référentiel).
Conservation : 3 jours à 4 °C, réchauffer à 32 °C avant coulage.
🇲🇦 الگاناش : 3 أيام فالفريكو، سخنو ل 32 درجة قبل ما تصبو.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000006';

-- 7e. Glaçage opéra (fabrication du mélange ; l''application est sur le produit).
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Glaçage opéra (préparation)","nom_ar":"الگلاساج (التحضير)","duree_estimee_min":10,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Fondre le chocolat + la pâte à glacer au bain-marie à 45 °C",
     "Ajouter l''huile, mélanger jusqu''à lisse et brillant",
     "Refroidir à 30-32 °C — trop chaud (> 35) fait fondre la crème, trop froid (< 28) fige et ne s''étale pas"],
   "checklist_items_ar":[
     "ذوّب الشوكلاط والپات آ گلاسي فالبان ماري حتى 45 درجة",
     "زيد الزيت وحرك حتى يولي أملس ولامع",
     "خليه يبرد حتى 30-32 درجة — سخون بزاف (فوق 35) كيذوّب الكريم، بارد بزاف (تحت 28) كيقسح وما يتفرشش"]}
]'::jsonb,
  instructions = 'Glaçage opéra — 440 g. Consommation : 300 g. Sans pâte à glacer : 400 g chocolat noir + 60 g huile (glaçage un peu plus dur).
Conservation : 1 mois au sec, réchauffer à 32 °C.
🇲🇦 التسخين ديال الگلاساج : 30-32 درجة عند الصب، ماشي فوق 35.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000004';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Étapes d'ASSEMBLAGE sur le produit Opéra (bilingues).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Chablonnage","nom_ar":"الشابلون","duree_estimee_min":15,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Fondre 80 g de chocolat noir au bain-marie",
     "Retourner le biscuit n°1 (la face qui était sur le papier vers le haut)",
     "Étaler le chocolat TRÈS fin (1 mm) à la palette, sur toute la surface",
     "Faire prendre au frigo 15 min, puis retourner : la face chocolat ira EN DESSOUS au montage",
     "Indispensable : sans chablon, le fond se détrempe, la part ne tient pas, l''opéra colle au carton"],
   "checklist_items_ar":[
     "ذوّب 80 غرام ديال الشوكلاط الكحل فالبان ماري",
     "قلب البيسكوي رقم 1 — الجيهة لي كانت فوق الورق تولي لفوق",
     "فرش الشوكلاط رقيق بزاف (1 مم) بالپاليط على الوجه كامل",
     "خليه يجمد فالفريكو 15 دقيقة، ومن بعد قلبو : الجيهة ديال الشوكلاط تولي لتحت فالمونطاج",
     "إجباري : بلا الشابلون القاع كيتبلل، الحصة ما كتوقفش، والأوپيرا كيلصق فالكارتون"]},
  {"ordre":2,"nom":"Montage du cadre","nom_ar":"المونطاج","duree_estimee_min":45,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cadre 40 × 30 sur plaque plate + papier/rhodoïd, TOUT préparé à portée (la crème fige, la ganache prend)",
     "Couche 1 : biscuit n°1 face chablon EN DESSOUS, puncher 110 g (réparti, un peu plus sur les bords)",
     "Couche 2 : 380 g crème au beurre, étaler plat à la palette longue (4,5 mm, jusqu''aux coins)",
     "Couche 3 : biscuit n°2, presser doucement, puncher 110 g → bloquer 20 min au frigo",
     "Couche 4 : 400 g ganache (30-32 °C), étaler 4 mm plat → bloquer 20 min",
     "Couche 5 : biscuit n°3, presser, puncher 110 g",
     "Couche 6 : 220 g crème au beurre, étaler fin et PLAT (3 mm) — c''est la surface du glaçage, aucun défaut toléré",
     "Bloquer la nuit (12 h) au frigo, ou 2 h en cellule",
     "Contrôle avant glaçage : hauteur 2,4 cm, surface plane, ferme au toucher"],
   "checklist_items_ar":[
     "الكادر 40 × 30 فوق بلاطو مسطح + ورق ولا رودويد، وجد كلشي قدامك (الكريم كيقسح والگاناش كيجمد)",
     "الطبقة 1 : البيسكوي 1 والجيهة ديال الشابلون لتحت، سقيه بـ110 غرام (موزعين، شوية زايدين فالجنابات)",
     "الطبقة 2 : 380 غرام كريم بالزبدة، فرشو مسطح بالپاليط الطويل (4,5 مم، حتى للزوايا)",
     "الطبقة 3 : البيسكوي 2، اضغط بالرفق، سقي بـ110 غرام ← بلوكاج 20 دقيقة فالفريكو",
     "الطبقة 4 : 400 غرام گاناش (30-32 درجة)، فرشو 4 مم مسطح ← بلوكاج 20 دقيقة",
     "الطبقة 5 : البيسكوي 3، اضغط، سقي بـ110 غرام",
     "الطبقة 6 : 220 غرام كريم بالزبدة، فرشو رقيق ومسطح (3 مم) — هادي هي الطبقة لي غادي يجي فوقها الگلاساج، بلا عيوب",
     "بلوكاج الليل كامل (12 ساعة) فالفريكو، ولا ساعتين فالسيليل",
     "المراقبة قبل الگلاساج : العلو 2,4 سم، الوجه مسطح، قاسح للمس"]},
  {"ordre":3,"nom":"Glaçage","nom_ar":"الگلاساج","duree_estimee_min":20,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sortir le cadre du frigo",
     "Verser le glaçage (30-32 °C) au centre, EN UNE FOIS, 300 g",
     "Étaler en UN SEUL geste long et droit à la palette longue (une passe, deux maximum)",
     "Chaque passage de plus fige le glaçage et laisse des traces — l''opéra doit être un miroir",
     "Frigo 30 min pour figer"],
   "checklist_items_ar":[
     "خرج الكادر من الفريكو",
     "صب الگلاساج (30-32 درجة) فالوسط مرة وحدة، 300 غرام",
     "فرشو بحركة وحدة طويلة ومستقيمة بالپاليط الطويل — حركة وحدة ولا جوج ماكسيموم",
     "كل مرة تعاود تمر، الگلاساج كيقسح وكيخلي خطوط — الأوپيرا خاصو يكون كالمرايا",
     "دخلو للفريكو 30 دقيقة باش يشد"]},
  {"ordre":4,"nom":"Parage et découpe","nom_ar":"التقصيص والتقطاع","duree_estimee_min":30,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Chauffer légèrement le cadre (chiffon chaud ou chalumeau rapide), retirer le cadre vers le haut",
     "Parer 1 cm sur les 4 côtés au couteau long chauffé et essuyé → 38 × 28 cm",
     "Marquer à la règle : 4 colonnes de 9,5 cm, 6 rangées de 4,5 cm",
     "Couper au couteau chaud et SEC, nettoyer et essuyer entre CHAQUE coupe, un seul geste du haut vers le bas",
     "Contrôle : 7 couches nettes et parallèles, côtés propres, glaçage non fissuré, 9,5 × 4,5 cm, hauteur 2,5 cm",
     "Glaçage qui craque = opéra trop froid : sortir 10 min avant (froid mais pas gelé)"],
   "checklist_items_ar":[
     "سخن الكادر بشوية (شيفون سخون ولا شالوميو بسرعة)، رفع الكادر لفوق نيشان",
     "قص صونتيم من كل جيهة بالموس الطويل السخون والنشف ← 38 × 28 سم",
     "علّم بالمسطرة : 4 أعمدة ديال 9,5 سم، 6 صفوف ديال 4,5 سم",
     "قطع بالموس السخون والنشف، نقيه ونشفو بعد كل قطعة، حركة وحدة من فوق لتحت",
     "المراقبة : 7 طبقات نقيين متوازيين، جنابات نقية، الگلاساج ما تشققش، 9,5 × 4,5 سم، العلو 2,5 سم",
     "الگلاساج كيتشقق = الأوپيرا بارد بزاف : خرجو 10 دقايق قبل التقطاع (بارد ولكن ماشي مجمد)"]},
  {"ordre":5,"nom":"Décor","nom_ar":"الزواق","duree_estimee_min":20,
   "est_bloquante":false,"timer_auto":false,"controle_qualite":false,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Écrire « Opéra » au cornet (chocolat blanc ou noir), au centre ou sur le bord — tester d''abord sur papier",
     "Feuille d''or (facultatif) : petit carré sur un coin. Peu vaut mieux que trop",
     "Mettre en vitrine réfrigérée < 4 °C"],
   "checklist_items_ar":[
     "الكتابة «Opéra» بالكورني بالشوكلاط الأبيض ولا الكحل، فوسط ولا على الطرف — جرب أولاً على ورقة",
     "ورق الذهب (اختياري) : مربع صغير على زاوية وحدة. قليل خير من بزاف",
     "حط الحصص فالفيترينة الباردة أقل من 4 درجات"]}
]'::jsonb,
  instructions = 'OPÉRA (SKU 10054) — assemblage. La fabrication des composants est décrite sur leurs fiches (Biscuit Joconde, Punch café, Crème au beurre café, Ganache chocolat noir, Glaçage opéra).

━━━ FR ━━━

Format : cadre 40 × 30 × 2,5 cm → 24 parts de 9,5 × 4,5 cm, 100 g la part. Cadre paré : 2 450 g (brut 2 760 g − 310 g de parage).

Structure (bas → haut, 7 couches + chablon + glaçage) :
1. Chablon chocolat (80 g) — 2. Biscuit + punch (350 + 110 g) — 3. Crème au beurre (380 g) — 4. Biscuit + punch — 5. Ganache (400 g) — 6. Biscuit + punch — 7. Crème au beurre fine (220 g) — 8. Glaçage (300 g) — 9. Décor.

4 températures critiques : sucre cuit 118 °C · pâte à bombe 25 °C · ganache 30-32 °C · glaçage 30-32 °C.

Contrôle rendement : peser le cadre avant découpe. 2 400-2 500 g = OK ; < 2 300 g = couches trop fines ; > 2 600 g = trop épaisses.

DLC : 72 h à + 4 °C, vitrine < 4 °C. Sortir la part 20 min avant dégustation. Cadre entier (non coupé) : 1 mois à −18 °C avant glaçage. Parts coupées : ne se congèlent pas.

Allergènes : gluten (blé), œufs, lait, fruits à coque (amandes), soja. AUCUN alcool.

━━━ 🇲🇦 بالدارجة ━━━

الفورما : كادر 40 × 30 × 2,5 سم ← 24 حصة ديال 9,5 × 4,5 سم، 100 غرام الحصة. الكادر مقصص : 2 450 غرام (خام 2 760 ناقص 310 ديال التقصيص).

البنية من تحت لفوق : شابلون (80 غ) — بيسكوي + سيرو — كريم بالزبدة (380 غ) — بيسكوي + سيرو — گاناش (400 غ) — بيسكوي + سيرو — كريم بالزبدة رقيق (220 غ) — گلاساج (300 غ) — زواق.

4 ديال الحرارات الحساسة : السكر 118 · البات آ بومب 25 · الگاناش 30-32 · الگلاساج 30-32.

مراقبة التخراج : وزن الكادر قبل التقطاع. 2 400-2 500 غ = مزيان ؛ تحت 2 300 = الطبقات رقاق ؛ فوق 2 600 = غلاظ.

الصلاحية : 72 ساعة ف 4 درجات، الفيترينة تحت 4. خرج الحصة 20 دقيقة قبل الأكل. الكادر الكامل بلا تقطاع : شهر ف −18 قبل الگلاساج. الحصص المقطعة ما كيتفرّزوش.

المواد المسببة للحساسية : الگلوتين، البيض، الحليب، اللوز، الصوجا. بلا كحول.

Source · المصدر : fiche masterclass Ôfauria V1, août 2026.',
  updated_at = NOW()
WHERE id = '0be7a000-0000-4000-8000-000000000001';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Contrôles finaux.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_comp INT; n_ing INT; qpf NUMERIC; n_et INT;
BEGIN
  SELECT count(*) INTO n_comp FROM recipe_format_components
   WHERE format_id = '0be7a000-0000-4000-8000-0000000000f4';
  IF n_comp <> 6 THEN
    RAISE EXCEPTION 'Opéra : % composants de format, 6 attendus', n_comp;
  END IF;

  SELECT count(*) INTO n_ing FROM recipe_ingredients
   WHERE recipe_id IN ('0be7a000-0000-4000-8000-000000000005','0be7a000-0000-4000-8000-000000000002',
     '0be7a000-0000-4000-8000-000000000003','0be7a000-0000-4000-8000-000000000006',
     '0be7a000-0000-4000-8000-000000000004');
  IF n_ing <> 23 THEN
    RAISE EXCEPTION 'Opéra : % lignes d''ingrédients de bases, 23 attendues', n_ing;
  END IF;

  SELECT quantite_par_format INTO qpf FROM recipe_formats
   WHERE id = '0be7a000-0000-4000-8000-0000000000f4';
  IF qpf <> 115 THEN
    RAISE EXCEPTION 'Opéra : quantite_par_format = %, 115 attendu', qpf;
  END IF;

  SELECT jsonb_array_length(etapes) INTO n_et FROM recipes
   WHERE id = '0be7a000-0000-4000-8000-000000000001';
  IF n_et <> 5 THEN
    RAISE EXCEPTION 'Opéra produit : % étapes, 5 attendues', n_et;
  END IF;
END $$;
