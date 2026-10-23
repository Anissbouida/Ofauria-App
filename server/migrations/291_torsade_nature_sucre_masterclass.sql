-- Migration 291 : Torsade nature sucre (SKU 10009) — reprise sur la fiche masterclass
--
-- POURQUOI
--   La fiche technique masterclass de la Torsade nature sucre est le référentiel
--   à intégrer. Elle décrit :
--     - un pâton de 90 g cru (PLF nature, pas complète),
--     - 8 g de sucre semoule saupoudré à l'intérieur avant torsion (cœur du
--       produit « nature sucre »),
--     - 3 g de dorure (2 passes fines),
--     - 4 g de sirop 30°B en nappage POST-cuisson (brillance).
--
--   La mig 282 était censée créer la recette et le format (UUID fab28200-…-127
--   et fab28200-…-227), mais l'insertion a été partielle sur certains
--   environnements (9/43 recettes fab28200 seulement en local). Cette migration
--   est donc AUTO-SUFFISANTE : elle crée la recette et le format s'ils
--   n'existent pas, puis pose la composition, les étapes et les instructions.
--
--   Convention quantite_par_format (mig 282) : somme des composants du format /
--   nb de pièces. Le nappage est inclus (cf. Croissant bicolore = 90 + 4 = 94).
--     Nouveau : 90 (PLF) + 8 (sucre) + 3 (dorure) + 4 (sirop nappage) = 105 g
--
-- PORTÉE
--   + recette fab28200-…-127 (Torsade nature sucre, compose, mode viennoiserie)
--   + format fab28200-…-227 (Plaque 60x40 viennoiseries (15), 105 g/pièce, 15 p.)
--   + 4 composants (fond PLF + garniture sucre + decor dorure + nappage sirop)
--   + miroir recipe_components (recette 127, format par défaut)
--   + 11 étapes JSONB + instructions détaillées (rendement, planning, conservation)
--   Idempotent : ON CONFLICT DO NOTHING sur les UUID + DELETE ciblés.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Recette Torsade nature sucre (crée si absente).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit,
                     perte_standard_pct, category_id, product_id)
SELECT 'fab28200-0000-4000-8000-000000000127'::uuid,
       'Torsade nature sucre',
       false, 'compose', 15, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'viennoiserie'),
       'e6ca6c64-0054-4f02-af57-0fb735b78d38'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM recipes WHERE id = 'fab28200-0000-4000-8000-000000000127'
);

-- Si la recette existait déjà (mig 282 partielle), on garantit qu'elle porte
-- bien le product_id — sinon UNIQUE (product_id) bloquera la mise à jour d'un
-- éventuel doublon. On ne touche pas au product_id si déjà lié à un autre
-- product (cas improbable), pour laisser l'admin trancher.
UPDATE recipes
   SET product_id = 'e6ca6c64-0054-4f02-af57-0fb735b78d38'::uuid,
       name       = 'Torsade nature sucre',
       mode_cout  = 'compose',
       yield_quantity = 15,
       yield_unit = 'unit',
       category_id = (SELECT id FROM recipe_categories WHERE code = 'viennoiserie')
 WHERE id = 'fab28200-0000-4000-8000-000000000127'
   AND (product_id IS NULL OR product_id = 'e6ca6c64-0054-4f02-af57-0fb735b78d38'::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Format Plaque 60x40 viennoiseries (15) — 105 g/pièce, 15 pièces.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default,
                            ordre, product_id, is_active)
SELECT 'fab28200-0000-4000-8000-000000000227'::uuid,
       'fab28200-0000-4000-8000-000000000127'::uuid,
       c.id, 105, 'g', 15, true, 1,
       'e6ca6c64-0054-4f02-af57-0fb735b78d38'::uuid, true
  FROM production_contenants c
 WHERE c.nom = 'Plaque 60x40 viennoiseries (15)'
   AND NOT EXISTS (
     SELECT 1 FROM recipe_formats WHERE id = 'fab28200-0000-4000-8000-000000000227'
   );

-- Format déjà présent : on aligne les champs sur la fiche masterclass.
UPDATE recipe_formats
   SET quantite_par_format = 105,
       quantite_par_format_unite = 'g',
       nb_par_defaut = 15,
       is_default = true,
       is_active  = true,
       product_id = 'e6ca6c64-0054-4f02-af57-0fb735b78d38'::uuid,
       updated_at = NOW()
 WHERE id = 'fab28200-0000-4000-8000-000000000227';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Composants du format — nomenclature nette pour la plaque entière.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id = 'fab28200-0000-4000-8000-000000000227';

-- 3a. Sous-recettes : PLF nature, dorure, sirop de finition.
INSERT INTO recipe_format_components (format_id, role, source_recipe_id,
                                      quantite, unite, perte_pct, ordre)
VALUES
  -- Pâton PLF nature — 15 × 90 g
  ('fab28200-0000-4000-8000-000000000227', 'fond',
   'fab28000-0000-4000-8000-000000000104', 1350, 'g', 0, 1),
  -- Dorure fine en 2 passes — 15 × 3 g
  ('fab28200-0000-4000-8000-000000000227', 'decor',
   'fab28000-0000-4000-8000-000000000101',   45, 'g', 0, 3),
  -- Sirop 30°B en nappage post-cuisson — 15 × 4 g (brillance)
  ('fab28200-0000-4000-8000-000000000227', 'nappage',
   'fab28000-0000-4000-8000-000000000102',   60, 'g', 0, 4);

-- 3b. Ingrédient direct : sucre semoule saupoudré avant torsion (8 g/pièce).
--     Le référentiel comporte 2 entrées « Sucre semoule » (kg) — on prend la
--     plus ancienne (id stable) : ORDER BY unit puis id.
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id,
                                      quantite, unite, perte_pct, ordre)
SELECT 'fab28200-0000-4000-8000-000000000227'::uuid, 'garniture', i.id,
       120, 'g', 0, 2
  FROM ingredients i
 WHERE lower(i.name) = lower('Sucre semoule')
 ORDER BY (i.unit = 'kg') DESC, i.id
 LIMIT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Miroir recipe_components — la recette 127 pointe sur le format par défaut.
--    v_recipe_total_cost lit ce miroir pour les recettes composées.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components
 WHERE recipe_id = 'fab28200-0000-4000-8000-000000000127';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT f.recipe_id, c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
  FROM recipe_format_components c
  JOIN recipe_formats f ON f.id = c.format_id
 WHERE f.recipe_id = 'fab28200-0000-4000-8000-000000000127'
   AND f.is_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Étapes détaillées + instructions de la fiche masterclass.
--    11 étapes couvrant J-1 (pétrissage, pointage, blocage) et J (tourage,
--    façonnage, apprêt, dorure, cuisson, finition). Les checklists reprennent
--    les points de contrôle du chef (température, tests, pièges classiques).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET etapes = '[
  {"ordre":1,"nom":"Température de l''eau (base 54)","duree_estimee_min":2,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mesurer T° du labo et T° de la farine",
     "T° des liquides = 54 − (T° labo + T° farine)",
     "Si < 4 °C, remplacer une part du lait par de la glace pilée PESÉE",
     "Objectif : pâte à 22-24 °C en fin de pétrissage"]},
  {"ordre":2,"nom":"Pétrissage","duree_estimee_min":12,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ordre cuve : lait froid + eau glacée + œufs, puis farine + lait poudre + sucre + malt",
     "Levure émiettée d''un côté, sel de l''autre — JAMAIS en contact",
     "Frasage 4 min en 1ʳᵉ vitesse (pâte grumeleuse, normal)",
     "Ajouter sel puis beurre pommade en morceaux",
     "5-6 min en 2ᵉ vitesse — arrêter dès pâte lisse, PAS de voile élastique",
     "Sonder : 22-24 °C obligatoire, noter sur la fiche de production"]},
  {"ordre":3,"nom":"Pointage et blocage","duree_estimee_min":780,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":false,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Aplatir en rectangle de 4 cm sur plaque, filmer au contact (sans air)",
     "Pointage : 30 min à 24-26 °C",
     "Blocage : 40 min à −18 °C (stoppe la fermentation à cœur)",
     "Repos : 12 h minimum à 4 °C — sortir ferme et froide (4-6 °C)"]},
  {"ordre":4,"nom":"Beurre de tourage (test 90°)","duree_estimee_min":10,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sortir le beurre 30 min avant, taper en carré 20 × 20 cm entre 2 feuilles guitare",
     "Sonder : 13-15 °C",
     "TEST plier à 90° — casse = trop froid (10 min hors froid) ; empreinte doigt = trop chaud (10 min au froid)",
     "OK = se plie sans casser, texture pâte à modeler",
     "RÈGLE D''OR : beurre et pâte à la MÊME dureté au doigt"]},
  {"ordre":5,"nom":"Enchâssage et tours (1 double + 1 simple)","duree_estimee_min":75,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Abaisser détrempe en carré 40 × 40 cm, poser le beurre en losange (45°)",
     "Rabattre les 4 pointes au centre, pincer TOUTES les jointures",
     "Tour DOUBLE : bande 60 × 25 (~8 mm), rabat haut au tiers + bas jusqu''à joindre, fermer en deux → 30 min à 4 °C",
     "Tour SIMPLE : bande 60 × 25, rabat haut au tiers puis bas par-dessus → 30 min à 4 °C",
     "Résultat : 12 couches de beurre",
     "Si la pâte se rétracte : STOP, retour 15 min au froid"]},
  {"ordre":6,"nom":"Abaisse et détaillage","duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Détendre 15 min après le dernier tour",
     "Abaisser par paliers de 2 mm, ¼ de tour à chaque passage, jusqu''à 3,5 mm",
     "Rectangle final ≈ 52 × 120 cm",
     "REPOS 20 min à 4 °C, à plat — indispensable, sinon rétraction en étuve",
     "Parer les 4 bords (1 cm) — bords soudés = étages qui ne s''ouvrent pas",
     "Détailler bandes 10 × 26 cm, peser les 3 premières : 90 g ± 2 g"]},
  {"ordre":7,"nom":"Façonnage (30 s/pièce)","duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":true,"nb_repetitions":24,"responsable_role":null,
   "checklist_items":[
     "Bande dans le sens de la longueur, pulvérisation LÉGÈRE d''eau",
     "Saupoudrer 8 g de sucre semoule sur la moitié basse, 1,5 cm de marge (sinon caramélise sur la plaque)",
     "Rabattre en deux dans la longueur → bande 5 × 26 cm, souder au rouleau",
     "Fendre dans la longueur, laisser 2 cm non coupés en haut",
     "Torsader 3 tours COMPLETS, faces coupées visibles dessus (vitrine)",
     "Poser sur plaque, PRESSER LES DEUX EXTRÉMITÉS au pouce (sinon la torsade se déroule)",
     "Espacement 6 cm — ≈ 12 pièces sur plaque 60 × 40"]},
  {"ordre":8,"nom":"Apprêt","duree_estimee_min":135,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-27 °C — MAXIMUM 28 °C (le beurre fond à 30)",
     "Hygrométrie 75 %",
     "Durée 2 h à 2 h 30",
     "3 repères : volume doublé + pièce qui tremble à la secousse + couches de beurre visibles sur la tranche",
     "PLUTÔT LENT que rapide : 3 h à 25 °C >>> 1 h 30 à 30 °C"]},
  {"ordre":9,"nom":"Dorure (2 passes)","duree_estimee_min":5,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure FINE avant étuve (empêche le croûtage)",
     "2ᵉ passe après étuve, juste avant le four (3 g/pièce)",
     "Pinceau souple, dans le sens de la torsade",
     "JAMAIS sur les tranches coupées — la dorure colle les feuillets et le feuilletage ne s''ouvre pas",
     "Pas de flaque dans les creux (points noirs à la cuisson)"]},
  {"ordre":10,"nom":"Cuisson (four ventilé 165-170 °C)","duree_estimee_min":18,"est_bloquante":true,"timer_auto":true,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Enfourner buée FERMÉE, ouvrir le clapet à 8 min",
     "Ventilé 165-170 °C : 16-18 min ; sole/voûte 190/180 °C : 18-20 min",
     "Si le four est déséquilibré : tourner les plaques à mi-cuisson",
     "Contrôle : dessus acajou uniforme + SOULEVER 1 pièce, le dessous doit être BIEN COLORÉ",
     "Dessous blanc = intérieur cru — remettre 2-3 min"]},
  {"ordre":11,"nom":"Finition (sirop + ressuage)","duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,
   "controle_qualite":true,"est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "À la sortie du four (encore brûlant) : siroper au pinceau (4 g/pièce)",
     "Transférer IMMÉDIATEMENT sur grille (pas sur plaque : vapeur → dessous mou)",
     "Refroidir 30 min minimum",
     "Sucre glace éventuel : UNIQUEMENT une fois complètement froid",
     "Ne JAMAIS filmer une pièce tiède"]}
]'::jsonb,
       instructions = 'FICHE MASTERCLASS TORSADE NATURE SUCRE (SKU 10009) — V3 août 2026.

Pâton 90 g cru par pièce, sucre semoule 8 g/pièce à l''intérieur, dorure 3 g/pièce (2 passes), sirop 30°B 4 g/pièce en nappage à la sortie du four. Longueur 13-15 cm.

Rendement : 1 kg de farine (détrempe 1 850 g + tourage 500 g = pâton 2 350 g, ~5 % de chutes) → 24 pièces de 90 g cru. Perte de cuisson 14 % → pièce cuite ~77 g → pièce finie sirotée ~81 g.

Planning J-1 : pétrissage 15 h, pointage 30 min, blocage 40 min à −18 °C, froid 4 °C toute la nuit. Sirop et dorure préparés le J-1 (dorure reposée 2 h au frigo, tamisée).

Planning J : tourage 4 h, abaisse+détaillage+façonnage 5 h 30, étuve 6 h, cuisson+sirop 8 h 15, vitrine 9 h.

Sirop 30°B (base) : 500 g eau + 650 g sucre + 50 g glucose, porté à ébullition, refroidi à 60 °C. Se garde 15 jours au froid.

Conservation : vente le jour même (DLC vitrine 24 h). Ne jamais mettre en sachet une pièce tiède (vapeur → mie collante).
Surgélation crue possible après façonnage (−35 °C / 40 min puis bac hermétique, 3 semaines max à −18 °C), remise en étuve directe 3 h à 26 °C.
Surgélation précuite (80 % de cuisson, 12 min) : 6 semaines à −18 °C, finition 7-8 min à 180 °C + sirop.

Défauts rédhibitoires (retirés de la vente) : beurre coulé sur la plaque · torsade détordue · dessous blanc · sucre caramélisé et collé.

Allergènes : gluten (farine), œufs (dorure + détrempe), lait et beurre (détrempe + tourage).

Source : fiche masterclass Ôfauria V3, août 2026.',
       updated_at = NOW()
 WHERE id = 'fab28200-0000-4000-8000-000000000127';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Contrôles finaux.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_comp INT;
  qpf    NUMERIC;
BEGIN
  SELECT count(*) INTO n_comp
    FROM recipe_format_components
   WHERE format_id = 'fab28200-0000-4000-8000-000000000227';
  IF n_comp <> 4 THEN
    RAISE EXCEPTION 'Torsade nature sucre : % composants insérés, 4 attendus (fond+garniture+decor+nappage)', n_comp;
  END IF;

  SELECT quantite_par_format INTO qpf
    FROM recipe_formats
   WHERE id = 'fab28200-0000-4000-8000-000000000227';
  IF qpf <> 105 THEN
    RAISE EXCEPTION 'Torsade nature sucre : quantite_par_format = %, 105 attendu', qpf;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM recipes
     WHERE id = 'fab28200-0000-4000-8000-000000000127'
       AND jsonb_array_length(etapes) = 11
  ) THEN
    RAISE EXCEPTION 'Torsade nature sucre : etapes non posées (11 attendues)';
  END IF;
END $$;
