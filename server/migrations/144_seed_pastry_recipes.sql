-- Migration 144: Seed 60 pastry recipes from manuscript book (v2 — generic base recipes)
-- Generated automatically from Classeur_recettes_professionnelles_Brioche.docx
-- Each unique component name → ONE shared base recipe (is_base=true)
-- Each entremets = product + final recipe linking to those generic bases

BEGIN;

-- ============================================================
-- 0. NEW INGREDIENTS
-- ============================================================

INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('2d4788ca-92c7-5e4e-9aaf-9375d76e0df8', 'Arôme coco', 'kg', 150.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('207f88ed-af91-528a-bf22-39325af3ee0c', 'Caramel / colorant caramel', 'kg', 50.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('ed375a73-0f94-5b7f-82b9-6a7efde8fa86', 'Colorant jaune liposoluble', 'kg', 1500.0, 'Colorant') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('18bac65e-4c9e-5767-b6cb-210827041c0d', 'Colorant poudre jaune', 'kg', 1500.0, 'Colorant') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('8df03e21-b077-5f20-9295-bb50cc72d1ca', 'Colorant vert hydrosoluble', 'kg', 1500.0, 'Colorant') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('0141b1a5-5e5f-5c43-b176-70cae945da41', 'Cream cheese', 'kg', 70.0, 'Crémerie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('fd7a6731-f3f1-51c1-a99a-12d67bb72fb6', 'Crème cheese 33 %', 'kg', 70.0, 'Crémerie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('2210a4b4-8ca0-51e4-9afe-6d99824e9a19', 'Flocons d’avoine / graines floconnées', 'kg', 18.0, 'Sec') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('456834f5-e414-57a8-af5b-be038fd272e8', 'Glaçage rocher au lait', 'kg', 90.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('15310d93-f4d0-546c-883e-d8983819e2c6', 'Grand Marnier pour imbibage', 'l', 90.0, 'Liquoriste') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('e0b0a1a6-a984-558b-91af-0a4bd7010a0a', 'Lait de coco', 'l', 25.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('a974f4ab-01af-5f11-9985-2d26828d6dce', 'Pâte de pistache', 'kg', 280.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('11441c2b-901b-5ae1-a265-92c72b52a89f', 'Purée de poire', 'l', 85.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('21a31838-79de-584e-ac3e-d1c6d5555e1f', 'Purée passion', 'l', 95.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;
INSERT INTO ingredients (id, name, unit, unit_cost, supplier) VALUES ('73b83d3a-dbd0-5fc2-bd26-8a4ec979b6ac', 'Spéculoos', 'kg', 50.0, 'Pâtisserie') ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 1. GENERIC BASE RECIPES (deduplicated by component name)
-- ============================================================

INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d359b304-9204-5071-8dde-e8321d8d6063', NULL, 'Caramel noix / macadamia', 'Recette de base partagée. Utilisée dans : #11.

Procédé :
1. Cuire le sucre et le glucose en caramel.
2. Décuire avec la crème chaude.
3. Cuire jusqu’à texture caramel souple.
4. Ajouter les noix ou macadamias torréfiées si prévu.', 1.0, 'kg', true, '[{"ordre": 1, "nom": "Cuire le sucre et le glucose en caramel.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Décuire avec la crème chaude.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Cuire jusqu’à texture caramel souple.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter les noix ou macadamias torréfiées si prévu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d359b304-9204-5071-8dde-e8321d8d6063', '2a634f35-27c6-40ae-b68d-71b7274c359c', 606.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d359b304-9204-5071-8dde-e8321d8d6063', '942672ed-6b5b-4165-9e68-3706c98b163b', 303.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d359b304-9204-5071-8dde-e8321d8d6063', '70f2a5d3-d651-47c1-9dc5-fb15c7ec8bf0', 91.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d8385726-400b-5808-ac66-19ebb9cbc5d8', NULL, 'Banane', 'Recette de base partagée. Utilisée dans : #12.

Procédé :
1. Détailler et disposer sur la crème selon le montage.', 800, 'g', true, '[{"ordre": 1, "nom": "Détailler et disposer sur la crème selon le montage.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d8385726-400b-5808-ac66-19ebb9cbc5d8', '12871934-9984-4a1f-be6d-c3f90e78df63', 800.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('ddd3399e-0b19-5d35-b87c-136eef7ff468', NULL, 'Garniture cacao/lait', 'Recette de base partagée. Utilisée dans : #12.

Procédé :
1. Chauffer le lait.
2. Ajouter sucre et cacao mélangés.
3. Cuire légèrement jusqu’à texture homogène.', 212, 'g', true, '[{"ordre": 1, "nom": "Chauffer le lait.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter sucre et cacao mélangés.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Cuire légèrement jusqu’à texture homogène.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ddd3399e-0b19-5d35-b87c-136eef7ff468', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 20.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ddd3399e-0b19-5d35-b87c-136eef7ff468', '942672ed-6b5b-4165-9e68-3706c98b163b', 32.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ddd3399e-0b19-5d35-b87c-136eef7ff468', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 160.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', NULL, 'Topping pommes', 'Recette de base partagée. Utilisée dans : #13.

Procédé :
1. Mélanger les ingrédients secs.
2. Ajouter le beurre.
3. Incorporer les pommes en morceaux.
4. Garder une texture irrégulière.
5. Note : Dosage indicatif : 44 g par tarte.
6. Napper légèrement après cuisson et refroidissement.', 360, 'g', true, '[{"ordre": 1, "nom": "Mélanger les ingrédients secs.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer les pommes en morceaux.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Garder une texture irrégulière.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Note : Dosage indicatif : 44 g par tarte.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Napper légèrement après cuisson et refroidissement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 0.5000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '2210a4b4-8ca0-51e4-9afe-6d99824e9a19', 32.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '4e1b2877-c7d5-4cdf-94ba-57257a216f4c', 31.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '942672ed-6b5b-4165-9e68-3706c98b163b', 53.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '12871934-9984-4a1f-be6d-c3f90e78df63', 168.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '2a44fd1a-1787-49cb-a492-c776cb200a50', 32.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '27baa522-3b64-4a25-8919-c894a90a92be', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 38.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b3df13a-c8c0-539f-856d-c27b899cb2fa', '620a54ef-2ab8-4011-9b9d-e0df9ad9a326', 5.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('c8cdd202-e398-5163-b9b2-3ae08d99d482', NULL, 'Base spéculoos', 'Recette de base partagée. Utilisée dans : #24.

Procédé :
1. Préparer selon la recette de base spéculoos utilisée au laboratoire.', 250, 'g', true, '[{"ordre": 1, "nom": "Préparer selon la recette de base spéculoos utilisée au laboratoire.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c8cdd202-e398-5163-b9b2-3ae08d99d482', '73b83d3a-dbd0-5fc2-bd26-8a4ec979b6ac', 250.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', NULL, 'Brownie', 'Recette de base partagée. Utilisée dans : #28.

Procédé :
1. Faire fondre beurre et chocolat.
2. Mélanger œufs et sucre.
3. Ajouter chocolat/beurre.
4. Incorporer farine et cacao tamisés.
5. Ajouter les noix.
6. Cuire à 170°C pendant 40 min.', 998, 'g', true, '[{"ordre": 1, "nom": "Faire fondre beurre et chocolat.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Mélanger œufs et sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter chocolat/beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Incorporer farine et cacao tamisés.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Ajouter les noix.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Cuire à 170°C pendant 40 min.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 263.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '7b836f07-22f7-48ca-a307-ba47617e2350', 52.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 35.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '0b316449-a0ac-471f-9c41-3dd87680f832', 105.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '2a44fd1a-1787-49cb-a492-c776cb200a50', 105.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', 'ab27e0de-004c-4711-a606-deb44108584a', 175.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f0d4010e-4dd3-51d3-b894-2d898657a630', '942672ed-6b5b-4165-9e68-3706c98b163b', 263.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('7bd5dc64-333e-5d6c-80ef-d316c0e55649', NULL, 'Amandes caramélisées', 'Recette de base partagée. Utilisée dans : #30.

Procédé :
1. Cuire sucre et eau.
2. Ajouter les amandes.
3. Caraméliser et refroidir.', 340, 'g', true, '[{"ordre": 1, "nom": "Cuire sucre et eau.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter les amandes.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Caraméliser et refroidir.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('7bd5dc64-333e-5d6c-80ef-d316c0e55649', '61e062e1-981f-4e89-bf11-9afb60b6dcde', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('7bd5dc64-333e-5d6c-80ef-d316c0e55649', '942672ed-6b5b-4165-9e68-3706c98b163b', 100.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('7bd5dc64-333e-5d6c-80ef-d316c0e55649', '00000000-0000-4000-a000-000000000001', 40.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', NULL, 'Base brownie carrée', 'Recette de base partagée. Utilisée dans : #32.

Procédé :
1. Procédé identique au brownie carré : fondre, mélanger, couler, cuire.
2. Note : Cette fiche semble doublonner la base brownie carré; elle est conservée comme référence séparée.', 998, 'g', true, '[{"ordre": 1, "nom": "Procédé identique au brownie carré : fondre, mélanger, couler, cuire.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Note : Cette fiche semble doublonner la base brownie carré; elle est conservée comme référence séparée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 263.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '7b836f07-22f7-48ca-a307-ba47617e2350', 52.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 35.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '0b316449-a0ac-471f-9c41-3dd87680f832', 105.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '2a44fd1a-1787-49cb-a492-c776cb200a50', 105.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', 'ab27e0de-004c-4711-a606-deb44108584a', 175.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4a773f02-8ab3-5148-abb5-d6e6c8f675b7', '942672ed-6b5b-4165-9e68-3706c98b163b', 263.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', NULL, 'Nougatine amandes effilées', 'Recette de base partagée. Utilisée dans : #5.

Procédé :
1. Cuire les ingrédients selon un procédé de nougatine fine.
2. Étaler finement et refroidir avant utilisation.', 1.002, 'kg', true, '[{"ordre": 1, "nom": "Cuire les ingrédients selon un procédé de nougatine fine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Étaler finement et refroidir avant utilisation.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', 'a1d676b6-4724-4bce-add2-0c019f7fed2e', 235.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', '70f2a5d3-d651-47c1-9dc5-fb15c7ec8bf0', 117.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 3.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', '942672ed-6b5b-4165-9e68-3706c98b163b', 353.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('013e167a-c108-5f7d-890f-110fcce77d21', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 294.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', NULL, 'Assemblage', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Mélanger les œufs avec le sucre.
2. Incorporer le beurre fondu puis les poudres tamisées.
3. Ajouter les carottes râpées et les noix.
4. Couler dans le moule et cuire jusqu’à coloration et cuisson à cœur.
5. Crème Jebli / finition carrot cake - partielle
6. Détendre le cream cheese avec le sucre glace.
7. Ajouter l’arôme vanille et la crème fraîche.
8. Monter ou lisser selon la texture désirée.
9. La fiche imprimée est partiellement masquée ; les quantités sont à contrôler.', 3.341, 'kg', true, '[{"ordre": 1, "nom": "Mélanger les œufs avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Incorporer le beurre fondu puis les poudres tamisées.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter les carottes râpées et les noix.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Couler dans le moule et cuire jusqu’à coloration et cuisson à cœur.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Crème Jebli / finition carrot cake - partielle", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Détendre le cream cheese avec le sucre glace.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 7, "nom": "Ajouter l’arôme vanille et la crème fraîche.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 8, "nom": "Monter ou lisser selon la texture désirée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 9, "nom": "La fiche imprimée est partiellement masquée ; les quantités sont à contrôler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '2a634f35-27c6-40ae-b68d-71b7274c359c', 864.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '215ae5ee-5048-4062-8f5b-4edafad17e94', 8.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '7b836f07-22f7-48ca-a307-ba47617e2350', 44.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '942672ed-6b5b-4165-9e68-3706c98b163b', 232.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', 'ab27e0de-004c-4711-a606-deb44108584a', 116.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '16d4f275-e95a-4f8d-9361-4a2e28586b4b', 162.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '2a44fd1a-1787-49cb-a492-c776cb200a50', 232.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '27baa522-3b64-4a25-8919-c894a90a92be', 3.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 116.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', 'd36fa75b-eb52-4fb9-bced-050c414759f8', 309.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '96299373-816e-4426-9a32-b019a8fc120d', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '2a634f35-27c6-40ae-b68d-71b7274c359c', 425.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', 'fd7a6731-f3f1-51c1-a99a-12d67bb72fb6', 442.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', '620a54ef-2ab8-4011-9b9d-e0df9ad9a326', 387.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', NULL, 'Finition Élégance individuel', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Faire fondre le chocolat avec le beurre.
2. Monter les blancs avec le sucre.
3. Incorporer les œufs et jaunes au chocolat tiède.
4. Ajouter délicatement les blancs montés.
5. Étaler en cadre ou sur plaque et cuire selon le four.
6. Carrot cake 10 parts - fiche AtelierCroc', 2.429, 'kg', true, '[{"ordre": 1, "nom": "Faire fondre le chocolat avec le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Monter les blancs avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer les œufs et jaunes au chocolat tiède.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter délicatement les blancs montés.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Étaler en cadre ou sur plaque et cuire selon le four.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Carrot cake 10 parts - fiche AtelierCroc", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', '942672ed-6b5b-4165-9e68-3706c98b163b', 357.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 685.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', 'ab27e0de-004c-4711-a606-deb44108584a', 306.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 265.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', '86f36fd5-9812-447b-9c5e-c26622f837f3', 612.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cffcbd13-c97a-56c7-91d4-0073b9469c90', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 204.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('9d833394-64e5-550a-a541-5a26d4a51325', NULL, 'Base pâte pistache maison', 'Recette de base partagée. Utilisée dans : #19.

Procédé :
1. Réaliser une base praliné/pâte pistache selon le procédé habituel.', 1.5, 'kg', true, '[{"ordre": 1, "nom": "Réaliser une base praliné/pâte pistache selon le procédé habituel.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9d833394-64e5-550a-a541-5a26d4a51325', '2f24bc5f-e4dd-4088-bfea-0f0054c04dca', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9d833394-64e5-550a-a541-5a26d4a51325', '942672ed-6b5b-4165-9e68-3706c98b163b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', NULL, 'Bavaroise noisette', 'Recette de base partagée. Utilisée dans : #4, #17.

Procédé :
1. Chauffer le lait et/ou la crème avec l’arôme.
2. Blanchir les jaunes avec le sucre.
3. Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.
4. Ajouter la gélatine hydratée.
5. Refroidir avant incorporation de la crème montée si la recette le prévoit.', 2.21, 'kg', true, '[{"ordre": 1, "nom": "Chauffer le lait et/ou la crème avec l’arôme.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Blanchir les jaunes avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Refroidir avant incorporation de la crème montée si la recette le prévoit.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 720.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 195.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 45.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', '2a634f35-27c6-40ae-b68d-71b7274c359c', 750.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9b1b7ee4-88c9-5268-8105-831c4f02102a', '306c5e57-1077-4b0c-a1c8-b7e520f6c2d6', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', NULL, 'Bavaroise pistache', 'Recette de base partagée. Utilisée dans : #19, #29.

Procédé :
1. Chauffer le lait et/ou la crème avec l’arôme.
2. Blanchir les jaunes avec le sucre.
3. Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.
4. Ajouter la gélatine hydratée.
5. Refroidir avant incorporation de la crème montée si la recette le prévoit.', 1.657, 'kg', true, '[{"ordre": 1, "nom": "Chauffer le lait et/ou la crème avec l’arôme.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Blanchir les jaunes avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Refroidir avant incorporation de la crème montée si la recette le prévoit.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', '2a634f35-27c6-40ae-b68d-71b7274c359c', 624.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 33.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', '942672ed-6b5b-4165-9e68-3706c98b163b', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 600.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43027e07-ef43-5c93-a019-b222948a9467', 'a974f4ab-01af-5f11-9985-2d26828d6dce', 100.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', NULL, 'Bavaroise vanille', 'Recette de base partagée. Utilisée dans : #16, #25.

Procédé :
1. Chauffer le lait et/ou la crème avec l’arôme.
2. Blanchir les jaunes avec le sucre.
3. Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.
4. Ajouter la gélatine hydratée.
5. Refroidir avant incorporation de la crème montée si la recette le prévoit.', 1.267, 'kg', true, '[{"ordre": 1, "nom": "Chauffer le lait et/ou la crème avec l’arôme.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Blanchir les jaunes avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser le liquide chaud sur les jaunes, puis cuire à 82-84°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Refroidir avant incorporation de la crème montée si la recette le prévoit.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '2a634f35-27c6-40ae-b68d-71b7274c359c', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '96299373-816e-4426-9a32-b019a8fc120d', 5.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 102.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 22.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '2a634f35-27c6-40ae-b68d-71b7274c359c', 416.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '942672ed-6b5b-4165-9e68-3706c98b163b', 102.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01838a41-1523-50b1-b067-1a0d8e647287', '371dd8a6-0170-4f85-8108-b79d36c3a636', 220.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', NULL, 'Biscuit / dacquoise amande', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Monter les blancs avec le sucre semoule.
2. Incorporer les poudres tamisées.
3. Étaler et cuire jusqu’à coloration légère.', 887, 'g', true, '[{"ordre": 1, "nom": "Monter les blancs avec le sucre semoule.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Incorporer les poudres tamisées.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Étaler et cuire jusqu’à coloration légère.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', '942672ed-6b5b-4165-9e68-3706c98b163b', 100.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 280.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', '2a44fd1a-1787-49cb-a492-c776cb200a50', 57.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', '942672ed-6b5b-4165-9e68-3706c98b163b', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('05943ab6-30fa-56af-a7fc-8b2a1cf026cc', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 250.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', NULL, 'Biscuit brownie spécial', 'Recette de base partagée. Utilisée dans : #20.

Procédé :
1. Fondre chocolat et beurre.
2. Ajouter œufs et sucre.
3. Incorporer farine.
4. Cuire à 170°C pendant 30 min.', 551, 'g', true, '[{"ordre": 1, "nom": "Fondre chocolat et beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter œufs et sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer farine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Cuire à 170°C pendant 30 min.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', '942672ed-6b5b-4165-9e68-3706c98b163b', 162.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', 'ab27e0de-004c-4711-a606-deb44108584a', 93.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', '2a44fd1a-1787-49cb-a492-c776cb200a50', 58.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', '86f36fd5-9812-447b-9c5e-c26622f837f3', 92.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bad8b5f0-b281-5a87-abed-3d22a8adfc62', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 146.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('0975e302-992e-5817-b624-149e0876e978', NULL, 'Biscuit chocolat moelleux', 'Recette de base partagée. Utilisée dans : #2, #16.

Procédé :
1. Monter légèrement œufs et sucre.
2. Ajouter les poudres tamisées.
3. Incorporer lait et beurre fondu.
4. Ajouter les amandes.
5. Cuire à 160°C pendant 9 min.', 1.068, 'kg', true, '[{"ordre": 1, "nom": "Monter légèrement œufs et sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter les poudres tamisées.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer lait et beurre fondu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter les amandes.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Cuire à 160°C pendant 9 min.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '215ae5ee-5048-4062-8f5b-4edafad17e94', 18.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '942672ed-6b5b-4165-9e68-3706c98b163b', 170.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', 'ab27e0de-004c-4711-a606-deb44108584a', 255.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 42.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 154.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '2a44fd1a-1787-49cb-a492-c776cb200a50', 213.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 146.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0975e302-992e-5817-b624-149e0876e978', 'facc7ab5-fe8a-4c86-824c-f9d9801024dc', 70.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', NULL, 'Biscuit génoise chocolat', 'Recette de base partagée. Utilisée dans : #4, #5, #25.

Procédé :
1. Monter les œufs avec le sucre jusqu’au ruban.
2. Incorporer délicatement la farine tamisée.
3. Étaler régulièrement sur plaque ou couler dans le moule prévu.
4. Cuire selon l’épaisseur, puis refroidir avant découpe.', 812, 'g', true, '[{"ordre": 1, "nom": "Monter les œufs avec le sucre jusqu’au ruban.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Incorporer délicatement la farine tamisée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Étaler régulièrement sur plaque ou couler dans le moule prévu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Cuire selon l’épaisseur, puis refroidir avant découpe.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', '942672ed-6b5b-4165-9e68-3706c98b163b', 191.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', 'ab27e0de-004c-4711-a606-deb44108584a', 382.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 38.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', '2a44fd1a-1787-49cb-a492-c776cb200a50', 194.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('01b3d463-860c-510a-b104-9bb39602de1d', '215ae5ee-5048-4062-8f5b-4edafad17e94', 7.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('04a787c7-00fe-51de-9c12-cbeec1519af2', NULL, 'Biscuit génoise nature / pistache', 'Recette de base partagée. Utilisée dans : #19.', 1.027, 'kg', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('04a787c7-00fe-51de-9c12-cbeec1519af2', 'ab27e0de-004c-4711-a606-deb44108584a', 270.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('04a787c7-00fe-51de-9c12-cbeec1519af2', '2a44fd1a-1787-49cb-a492-c776cb200a50', 541.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('04a787c7-00fe-51de-9c12-cbeec1519af2', '942672ed-6b5b-4165-9e68-3706c98b163b', 216.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', NULL, 'Biscuit Joconde', 'Recette de base partagée. Utilisée dans : #26.

Procédé :
1. Monter œufs, poudre d’amande, sucre et trimoline.
2. Monter les blancs avec le sucre.
3. Incorporer les blancs au premier mélange.
4. Ajouter la farine tamisée.
5. Étaler et cuire à 180°C.
6. Note : Poids total noté : environ 2,114 kg, soit 3 biscuits de 700 g.', 2.11, 'kg', true, '[{"ordre": 1, "nom": "Monter œufs, poudre d’amande, sucre et trimoline.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Monter les blancs avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer les blancs au premier mélange.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la farine tamisée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Étaler et cuire à 180°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Note : Poids total noté : environ 2,114 kg, soit 3 biscuits de 700 g.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', 'ab27e0de-004c-4711-a606-deb44108584a', 612.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', '2a44fd1a-1787-49cb-a492-c776cb200a50', 120.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 458.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', '942672ed-6b5b-4165-9e68-3706c98b163b', 458.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', 'cc637d74-6d1d-402a-9fc6-9e26a115f7ff', 15.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 367.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('92716ed5-29fe-5c1b-a757-fdd6644d51c9', '942672ed-6b5b-4165-9e68-3706c98b163b', 80.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', NULL, 'Biscuit moelleux chocolat', 'Recette de base partagée. Utilisée dans : #17.

Procédé :
1. Procéder comme un biscuit moelleux chocolat.', 999, 'g', true, '[{"ordre": 1, "nom": "Procéder comme un biscuit moelleux chocolat.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '215ae5ee-5048-4062-8f5b-4edafad17e94', 18.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '942672ed-6b5b-4165-9e68-3706c98b163b', 171.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', 'ab27e0de-004c-4711-a606-deb44108584a', 252.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 42.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 155.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '2a44fd1a-1787-49cb-a492-c776cb200a50', 214.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('87141de8-ef1c-5b61-9f68-d8ea8d6fd643', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 147.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', NULL, 'Biscuit Oreo', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. 1. Crémer le beurre avec le sucre semoule jusqu’à obtention d’une texture homogène.
2. 2. Ajouter les œufs progressivement, puis incorporer le lait.
3. 3. Tamiser ensemble la farine, la poudre de cacao et la levure chimique.
4. 4. Incorporer les poudres au mélange sans trop travailler la pâte.
5. 5. Étaler ou détailler selon le format prévu en production.
6. 6. Cuisson : température et durée non visibles sur la fiche source, à confirmer avant production.', 662, 'g', true, '[{"ordre": 1, "nom": "1. Crémer le beurre avec le sucre semoule jusqu’à obtention d’une texture homogène.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "2. Ajouter les œufs progressivement, puis incorporer le lait.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "3. Tamiser ensemble la farine, la poudre de cacao et la levure chimique.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "4. Incorporer les poudres au mélange sans trop travailler la pâte.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "5. Étaler ou détailler selon le format prévu en production.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "6. Cuisson : température et durée non visibles sur la fiche source, à confirmer avant production.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '215ae5ee-5048-4062-8f5b-4edafad17e94', 12.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '942672ed-6b5b-4165-9e68-3706c98b163b', 113.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', 'ab27e0de-004c-4711-a606-deb44108584a', 169.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 28.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 102.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '2a44fd1a-1787-49cb-a492-c776cb200a50', 141.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25f67ea0-869f-590c-bc53-f8bc3dcd098e', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 97.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', NULL, 'Compotée framboise', 'Recette de base partagée. Utilisée dans : #6.

Procédé :
1. Mélanger la pectine avec les 50 g de sucre.
2. Chauffer la purée de framboise avec le glucose.
3. Ajouter le mélange sucre/pectine.
4. Ajouter les framboises fraîches.
5. Cuire avec le reste du sucre jusqu’à texture compotée.
6. Refroidir rapidement.', 1.001, 'kg', true, '[{"ordre": 1, "nom": "Mélanger la pectine avec les 50 g de sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Chauffer la purée de framboise avec le glucose.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le mélange sucre/pectine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter les framboises fraîches.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Cuire avec le reste du sucre jusqu’à texture compotée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Refroidir rapidement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', 'a96cd029-24a3-4086-9edb-ae7f1fd36200', 30.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', 'aa6f489c-197c-493b-b989-3cb5dd4ae397', 252.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', '70f2a5d3-d651-47c1-9dc5-fb15c7ec8bf0', 101.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', '8f2939d6-aa6c-4e1e-a960-8ccaafed2328', 302.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', '942672ed-6b5b-4165-9e68-3706c98b163b', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 14.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('872c85ec-43f9-5f40-9487-db627abc3883', '942672ed-6b5b-4165-9e68-3706c98b163b', 252.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', NULL, 'Confit framboise après cuisson', 'Recette de base partagée. Utilisée dans : #31.

Procédé :
1. Mélanger le sucre avec la pectine NH.
2. Chauffer la purée et l’eau.
3. Ajouter le mélange sucre/pectine en pluie.
4. Porter à ébullition en fouettant.
5. Couler en insert et surgeler.
6. Finir sur entremets congelé, puis poser les décors.', 169, 'g', true, '[{"ordre": 1, "nom": "Mélanger le sucre avec la pectine NH.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Chauffer la purée et l’eau.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le mélange sucre/pectine en pluie.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Porter à ébullition en fouettant.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler en insert et surgeler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "Finir sur entremets congelé, puis poser les décors.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', '942672ed-6b5b-4165-9e68-3706c98b163b', 13.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', 'aa6f489c-197c-493b-b989-3cb5dd4ae397', 0.2300, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', '00000000-0000-4000-a000-000000000001', 0.0770, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('43b1e9a1-d1ff-58e4-9469-d2444364b29a', '620a54ef-2ab8-4011-9b9d-e0df9ad9a326', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', NULL, 'Crème amande chocolat', 'Recette de base partagée. Utilisée dans : #12, #14.

Procédé :
1. Crémer le beurre avec le sucre.
2. Ajouter poudre d’amande et cacao.
3. Incorporer les œufs progressivement.
4. Garnir le fond de tarte.', 430, 'g', true, '[{"ordre": 1, "nom": "Crémer le beurre avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter poudre d’amande et cacao.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer les œufs progressivement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Garnir le fond de tarte.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', '942672ed-6b5b-4165-9e68-3706c98b163b', 170.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', 'ab27e0de-004c-4711-a606-deb44108584a', 72.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 120.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 56.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('499b4f0b-b4a8-5f13-b586-4e2d14a42211', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 12.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', NULL, 'Crème amande nature', 'Recette de base partagée. Utilisée dans : #13.

Procédé :
1. Crémer beurre et sucre.
2. Ajouter poudre d’amande puis œufs.
3. Incorporer la crème pâtissière.
4. Note : Dosage indicatif : 33 g par tarte individuelle.', 1.598, 'kg', true, '[{"ordre": 1, "nom": "Crémer beurre et sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter poudre d’amande puis œufs.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer la crème pâtissière.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Note : Dosage indicatif : 33 g par tarte individuelle.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', '942672ed-6b5b-4165-9e68-3706c98b163b', 294.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 234.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 294.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', 'ab27e0de-004c-4711-a606-deb44108584a', 176.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cd60a259-88cf-506b-b8ad-809f2b865d97', 'be5b721e-996d-4019-8cba-39f78b8168a8', 600.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', NULL, 'Crème au beurre noisette', 'Recette de base partagée. Utilisée dans : #26.

Procédé :
1. Cuire sucre et eau à 118°C.
2. Verser sur les blancs montés pour obtenir une meringue italienne.
3. Incorporer le beurre pommade.
4. Ajouter le praliné noisette.', 5.5, 'kg', true, '[{"ordre": 1, "nom": "Cuire sucre et eau à 118°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Verser sur les blancs montés pour obtenir une meringue italienne.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer le beurre pommade.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter le praliné noisette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 750.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', '942672ed-6b5b-4165-9e68-3706c98b163b', 1.5000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 2.2500, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', '00000000-0000-4000-a000-000000000001', 500.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('fd22e915-60d2-52d9-bceb-ade9009d1ba1', '306c5e57-1077-4b0c-a1c8-b7e520f6c2d6', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', NULL, 'Crème au beurre spéciale', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Cuire l’eau et le sucre puis verser sur les blancs montés.
2. Laisser refroidir en mélangeant.
3. Incorporer le beurre pommade progressivement.
4. Ajouter la crème pour ajuster la texture.', 1.1, 'kg', true, '[{"ordre": 1, "nom": "Cuire l’eau et le sucre puis verser sur les blancs montés.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Laisser refroidir en mélangeant.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer le beurre pommade progressivement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la crème pour ajuster la texture.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 450.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', '942672ed-6b5b-4165-9e68-3706c98b163b', 250.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', '00000000-0000-4000-a000-000000000001', 100.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', '2a634f35-27c6-40ae-b68d-71b7274c359c', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', NULL, 'Crème citron', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Chauffer le jus de citron avec une partie du sucre.
2. Blanchir les œufs, les jaunes et le reste du sucre.
3. Verser le liquide chaud sur le mélange œufs/sucre puis cuire à la nappe, sans faire bouillir.
4. Hors du feu, incorporer le beurre et mixer pour obtenir une crème lisse.
5. Refroidir rapidement puis garnir les fonds de tarte.
6. La fiche manuscrite indique également une meringue suisse, mais les quantités de sucre et blancs d’œufs ne sont pas lisibles.', 1.167, 'kg', true, '[{"ordre": 1, "nom": "Chauffer le jus de citron avec une partie du sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Blanchir les œufs, les jaunes et le reste du sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser le liquide chaud sur le mélange œufs/sucre puis cuire à la nappe, sans faire bouillir.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Hors du feu, incorporer le beurre et mixer pour obtenir une crème lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Refroidir rapidement puis garnir les fonds de tarte.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 6, "nom": "La fiche manuscrite indique également une meringue suisse, mais les quantités de sucre et blancs d’œufs ne sont pas lisibles.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', 'a96cd029-24a3-4086-9edb-ae7f1fd36200', 387.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', '942672ed-6b5b-4165-9e68-3706c98b163b', 166.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', 'ab27e0de-004c-4711-a606-deb44108584a', 209.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 222.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25b37bb6-2156-567f-9f48-102f6a05fc80', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 183.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('dda9ce1b-1a22-5016-b0ba-591a2c104077', NULL, 'Crème pâtissière chocolat - base', 'Recette de base partagée. Utilisée dans : #14.

Procédé :
1. Réaliser une crème pâtissière classique aromatisée cacao.', 660, 'g', true, '[{"ordre": 1, "nom": "Réaliser une crème pâtissière classique aromatisée cacao.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dda9ce1b-1a22-5016-b0ba-591a2c104077', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 500.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dda9ce1b-1a22-5016-b0ba-591a2c104077', '942672ed-6b5b-4165-9e68-3706c98b163b', 90.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dda9ce1b-1a22-5016-b0ba-591a2c104077', 'bbf9dbc1-7d3b-462a-8f31-dfb12f1b3590', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dda9ce1b-1a22-5016-b0ba-591a2c104077', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 20.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', NULL, 'Crémeux caramel', 'Recette de base partagée. Utilisée dans : #16, #26.

Procédé :
1. Réaliser un caramel avec le sucre.
2. Décuire avec la crème chaude.
3. Ajouter le lait.
4. Cuire avec les jaunes comme une crème anglaise légère.
5. Ajouter gélatine et beurre, puis mixer.', 1.583, 'kg', true, '[{"ordre": 1, "nom": "Réaliser un caramel avec le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Décuire avec la crème chaude.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le lait.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Cuire avec les jaunes comme une crème anglaise légère.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Ajouter gélatine et beurre, puis mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', '942672ed-6b5b-4165-9e68-3706c98b163b', 315.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', '2a634f35-27c6-40ae-b68d-71b7274c359c', 545.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 525.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 100.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 13.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433321cd-5cf9-5c44-aac5-b564af961045', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 85.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('77b23532-51a6-5250-afdc-52d0ffcd9334', NULL, 'Crémeux chocolat au lait', 'Recette de base partagée. Utilisée dans : #2, #22.

Procédé :
1. Chauffer le lait et le sucre.
2. Verser sur les chocolats.
3. Mixer et réserver au froid.', 1.08, 'kg', true, '[{"ordre": 1, "nom": "Chauffer le lait et le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Verser sur les chocolats.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mixer et réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('77b23532-51a6-5250-afdc-52d0ffcd9334', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 500.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('77b23532-51a6-5250-afdc-52d0ffcd9334', '942672ed-6b5b-4165-9e68-3706c98b163b', 70.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('77b23532-51a6-5250-afdc-52d0ffcd9334', 'a35e1140-ce4e-4eb0-9af6-4509ee4d43d1', 380.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('77b23532-51a6-5250-afdc-52d0ffcd9334', 'baec2b8b-1504-4f06-8305-f57ef702ba70', 130.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', NULL, 'Crémeux chocolat au lait Élégance', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Réaliser une crème anglaise avec le lait, les jaunes et le sucre.
2. Ajouter la gélatine hydratée.
3. Verser sur le chocolat et mixer.
4. Couler en insert ou utiliser comme couche de montage.', 1.33, 'kg', true, '[{"ordre": 1, "nom": "Réaliser une crème anglaise avec le lait, les jaunes et le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat et mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Couler en insert ou utiliser comme couche de montage.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', '942672ed-6b5b-4165-9e68-3706c98b163b', 117.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 117.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 419.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', 'b2110e5b-3581-431d-be42-736913cb16f7', 435.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 5.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('313a005b-1a82-5887-9077-714d53ec5cd3', '2a634f35-27c6-40ae-b68d-71b7274c359c', 237.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', NULL, 'Crémeux chocolat blanc', 'Recette de base partagée. Utilisée dans : #19, #29.

Procédé :
1. Faire une base crème anglaise.
2. Ajouter gélatine et verser sur chocolat blanc.
3. Mixer et réserver.', 665, 'g', true, '[{"ordre": 1, "nom": "Faire une base crème anglaise.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter gélatine et verser sur chocolat blanc.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mixer et réserver.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', '2a634f35-27c6-40ae-b68d-71b7274c359c', 280.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 100.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 80.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('bfb656f1-40e7-5522-a99a-db8776c850d9', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 5.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('c090015f-2fa8-5a87-a2df-43121a0891cf', NULL, 'Crémeux citron', 'Recette de base partagée. Utilisée dans : #21.

Procédé :
1. Chauffer le jus de citron.
2. Blanchir œufs et sucre.
3. Cuire comme un crémeux.
4. Ajouter la gélatine hydratée.
5. Note : La fiche ne mentionne pas clairement de beurre; à confirmer selon la texture recherchée.', 357, 'g', true, '[{"ordre": 1, "nom": "Chauffer le jus de citron.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Blanchir œufs et sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Cuire comme un crémeux.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Note : La fiche ne mentionne pas clairement de beurre; à confirmer selon la texture recherchée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c090015f-2fa8-5a87-a2df-43121a0891cf', 'a96cd029-24a3-4086-9edb-ae7f1fd36200', 163.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c090015f-2fa8-5a87-a2df-43121a0891cf', 'ab27e0de-004c-4711-a606-deb44108584a', 105.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c090015f-2fa8-5a87-a2df-43121a0891cf', '942672ed-6b5b-4165-9e68-3706c98b163b', 83.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c090015f-2fa8-5a87-a2df-43121a0891cf', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('e39b8229-d057-5225-9908-b7610a012f74', NULL, 'Crémeux pistache', 'Recette de base partagée. Utilisée dans : #1.

Procédé :
1. Chauffer la crème.
2. Ajouter la gélatine hydratée.
3. Verser sur le chocolat blanc.
4. Ajouter la pâte de pistache et mixer.
5. Couler en insert et surgeler.', 264, 'g', true, '[{"ordre": 1, "nom": "Chauffer la crème.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la pâte de pistache et mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler en insert et surgeler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e39b8229-d057-5225-9908-b7610a012f74', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 136.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e39b8229-d057-5225-9908-b7610a012f74', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 3.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e39b8229-d057-5225-9908-b7610a012f74', '2a634f35-27c6-40ae-b68d-71b7274c359c', 110.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e39b8229-d057-5225-9908-b7610a012f74', 'a974f4ab-01af-5f11-9985-2d26828d6dce', 15.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', NULL, 'Croustillant praliné', 'Recette de base partagée. Utilisée dans : #17.

Procédé :
1. Fondre chocolat et beurre.
2. Ajouter le praliné.
3. Incorporer la feuilletine et étaler.', 820, 'g', true, '[{"ordre": 1, "nom": "Fondre chocolat et beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le praliné.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer la feuilletine et étaler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 120.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', '4a0ee08e-8b4d-4398-b4b3-a88f5fb6f07c', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', '306c5e57-1077-4b0c-a1c8-b7e520f6c2d6', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('be9d1e6e-4e44-5332-8ecc-b7b70502def5', NULL, 'Croustillant praliné noisette', 'Recette de base partagée. Utilisée dans : #4.

Procédé :
1. Faire fondre le chocolat au lait avec le beurre.
2. Ajouter le praliné noisette.
3. Incorporer la feuilletine.
4. Étaler et réserver au froid.', 870, 'g', true, '[{"ordre": 1, "nom": "Faire fondre le chocolat au lait avec le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le praliné noisette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer la feuilletine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Étaler et réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('be9d1e6e-4e44-5332-8ecc-b7b70502def5', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 170.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('be9d1e6e-4e44-5332-8ecc-b7b70502def5', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('be9d1e6e-4e44-5332-8ecc-b7b70502def5', '4a0ee08e-8b4d-4398-b4b3-a88f5fb6f07c', 150.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('be9d1e6e-4e44-5332-8ecc-b7b70502def5', '306c5e57-1077-4b0c-a1c8-b7e520f6c2d6', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('6fe27312-2815-5e31-9084-dcb6de7e411e', NULL, 'Enrobage chocolat lait', 'Recette de base partagée. Utilisée dans : #3.

Procédé :
1. Faire fondre le chocolat et le beurre de cacao.
2. Ajouter le colorant liposoluble.
3. Mixer soigneusement sans incorporer trop d’air.
4. Utiliser au pistolet sur pièces congelées, autour de 35-40°C.', 2.0, 'kg', true, '[{"ordre": 1, "nom": "Faire fondre le chocolat et le beurre de cacao.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le colorant liposoluble.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mixer soigneusement sans incorporer trop d’air.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Utiliser au pistolet sur pièces congelées, autour de 35-40°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6fe27312-2815-5e31-9084-dcb6de7e411e', 'edaf477e-5762-41d8-a6f1-f53a6ae16193', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6fe27312-2815-5e31-9084-dcb6de7e411e', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('b0e4ea57-d8e0-55d4-bfc6-00027fd65fda', NULL, 'Enrobage vert', 'Recette de base partagée. Utilisée dans : #15.', 1.0, 'kg', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('b0e4ea57-d8e0-55d4-bfc6-00027fd65fda', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('b0e4ea57-d8e0-55d4-bfc6-00027fd65fda', 'edaf477e-5762-41d8-a6f1-f53a6ae16193', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', NULL, 'Ganache chocolat noir', 'Recette de base partagée. Utilisée dans : #11, #26.

Procédé :
1. Chauffer la crème avec la trimoline.
2. Ajouter la gélatine hydratée.
3. Verser sur le chocolat noir.
4. Mixer, puis ajouter le beurre à 35-40°C.
5. Couler dans les fonds cuits.', 1.726, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la crème avec la trimoline.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat noir.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Mixer, puis ajouter le beurre à 35-40°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler dans les fonds cuits.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', 'cc637d74-6d1d-402a-9fc6-9e26a115f7ff', 86.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', '2a634f35-27c6-40ae-b68d-71b7274c359c', 852.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', '0b316449-a0ac-471f-9c41-3dd87680f832', 480.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 300.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a17605a3-ccf3-5962-88ab-5bd2d158fc12', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 8.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('e37298f7-c28b-52d6-99d4-97381e0f6e52', NULL, 'Ganache montée chocolat - partielle', 'Recette de base partagée. Utilisée dans : #60.', 763, 'g', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e37298f7-c28b-52d6-99d4-97381e0f6e52', '2a634f35-27c6-40ae-b68d-71b7274c359c', 510.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e37298f7-c28b-52d6-99d4-97381e0f6e52', 'b2110e5b-3581-431d-be42-736913cb16f7', 253.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('0e23cefe-1404-5516-b930-961799866f9e', NULL, 'Ganache montée chocolat au lait', 'Recette de base partagée. Utilisée dans : #16.

Procédé :
1. Chauffer une partie de la crème.
2. Ajouter la gélatine.
3. Verser sur le chocolat.
4. Ajouter le reste de crème froide.
5. Mixer, réserver une nuit et monter avant utilisation.', 984, 'g', true, '[{"ordre": 1, "nom": "Chauffer une partie de la crème.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter le reste de crème froide.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Mixer, réserver une nuit et monter avant utilisation.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0e23cefe-1404-5516-b930-961799866f9e', '2a634f35-27c6-40ae-b68d-71b7274c359c', 648.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0e23cefe-1404-5516-b930-961799866f9e', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 324.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0e23cefe-1404-5516-b930-961799866f9e', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 12.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('a6ad08d9-3664-5556-b20e-25dcdb7a8af2', NULL, 'Génoise verte', 'Recette de base partagée. Utilisée dans : #29.

Procédé :
1. Monter les œufs avec le sucre jusqu’au ruban.
2. Incorporer délicatement la farine tamisée.
3. Étaler régulièrement sur plaque ou couler dans le moule prévu.
4. Cuire selon l’épaisseur, puis refroidir avant découpe.
5. Note : Rendement noté : 3 biscuits verts de 700 g.', 2.197, 'kg', true, '[{"ordre": 1, "nom": "Monter les œufs avec le sucre jusqu’au ruban.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Incorporer délicatement la farine tamisée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Étaler régulièrement sur plaque ou couler dans le moule prévu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Cuire selon l’épaisseur, puis refroidir avant découpe.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Note : Rendement noté : 3 biscuits verts de 700 g.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a6ad08d9-3664-5556-b20e-25dcdb7a8af2', 'ab27e0de-004c-4711-a606-deb44108584a', 1.1500, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a6ad08d9-3664-5556-b20e-25dcdb7a8af2', '2a44fd1a-1787-49cb-a492-c776cb200a50', 463.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a6ad08d9-3664-5556-b20e-25dcdb7a8af2', '942672ed-6b5b-4165-9e68-3706c98b163b', 580.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('a6ad08d9-3664-5556-b20e-25dcdb7a8af2', '8df03e21-b077-5f20-9295-bb50cc72d1ca', 4.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', NULL, 'Glaçage blanc', 'Recette de base partagée. Utilisée dans : #23.

Procédé :
1. Chauffer glucose et lait.
2. Ajouter la gélatine.
3. Verser sur le chocolat blanc.
4. Ajouter la crème et mixer.', 1.341, 'kg', true, '[{"ordre": 1, "nom": "Chauffer glucose et lait.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la crème et mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', '70f2a5d3-d651-47c1-9dc5-fb15c7ec8bf0', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 330.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 25.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c4d4df58-48db-5a11-bcf3-ff444fcd3069', '2a634f35-27c6-40ae-b68d-71b7274c359c', 286.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', NULL, 'Glaçage cake fruits secs', 'Recette de base partagée. Utilisée dans : #7.

Procédé :
1. Chauffer la crème avec la trimoline.
2. Ajouter la gélatine.
3. Verser sur le chocolat blanc.
4. Ajouter le beurre et mixer.
5. Utiliser tiède sur cake refroidi.', 259, 'g', true, '[{"ordre": 1, "nom": "Chauffer la crème avec la trimoline.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter le beurre et mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Utiliser tiède sur cake refroidi.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', 'cc637d74-6d1d-402a-9fc6-9e26a115f7ff', 18.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', '2a634f35-27c6-40ae-b68d-71b7274c359c', 106.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 36.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 95.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 3.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('6f4f0f3d-56f0-5fdd-8602-419896cafb6c', '207f88ed-af91-528a-bf22-39325af3ee0c', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', NULL, 'Glaçage chocolat noir', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Chauffer l’eau, la crème et le sucre.
2. Ajouter le cacao tamisé et porter à ébullition.
3. Ajouter la gélatine hydratée.
4. Mixer sans incorporer d’air et réserver au froid.
5. Utiliser sur entremets congelé à la température adaptée à la texture.', 600, 'g', true, '[{"ordre": 1, "nom": "Chauffer l’eau, la crème et le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le cacao tamisé et porter à ébullition.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Mixer sans incorporer d’air et réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Utiliser sur entremets congelé à la température adaptée à la texture.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', '942672ed-6b5b-4165-9e68-3706c98b163b', 204.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 73.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', '00000000-0000-4000-a000-000000000001', 165.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 19.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('2c744e5a-608a-5581-95d6-ba366c3f7b02', '2a634f35-27c6-40ae-b68d-71b7274c359c', 139.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', NULL, 'Glaçage jaune', 'Recette de base partagée. Utilisée dans : #20.', 262, 'g', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', '942672ed-6b5b-4165-9e68-3706c98b163b', 73.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', '00000000-0000-4000-a000-000000000001', 0.0370, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', '70f2a5d3-d651-47c1-9dc5-fb15c7ec8bf0', 73.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', '2a634f35-27c6-40ae-b68d-71b7274c359c', 37.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('1b793476-3b88-553e-b9c6-ece16f1ff49c', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 73.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', NULL, 'Glaçage noir', 'Recette de base partagée. Utilisée dans : #5.

Procédé :
1. Chauffer l’eau, la crème et le sucre.
2. Ajouter le cacao tamisé.
3. Porter à ébullition.
4. Ajouter la gélatine hydratée.
5. Mixer et utiliser autour de 30-35°C.', 1.01, 'kg', true, '[{"ordre": 1, "nom": "Chauffer l’eau, la crème et le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le cacao tamisé.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Porter à ébullition.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Mixer et utiliser autour de 30-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', '00000000-0000-4000-a000-000000000001', 290.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', '2a634f35-27c6-40ae-b68d-71b7274c359c', 234.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 18.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 117.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('5fd02d65-4673-52eb-8441-cdd993f5eeff', '942672ed-6b5b-4165-9e68-3706c98b163b', 351.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('9001fb40-ecce-55f4-832a-b55a2a4a2033', NULL, 'Glaçage rocher', 'Recette de base partagée. Utilisée dans : #16.', 500, 'g', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9001fb40-ecce-55f4-832a-b55a2a4a2033', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d0e9ffad-f405-5c8d-98c3-5a65b2bd4207', NULL, 'Glaçage rocher lait', 'Recette de base partagée. Utilisée dans : #4.

Procédé :
1. Fondre le chocolat.
2. Ajouter l’huile et les amandes.
3. Utiliser tiède sur entremets congelé.', 1.3, 'kg', true, '[{"ordre": 1, "nom": "Fondre le chocolat.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter l’huile et les amandes.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Utiliser tiède sur entremets congelé.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d0e9ffad-f405-5c8d-98c3-5a65b2bd4207', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d0e9ffad-f405-5c8d-98c3-5a65b2bd4207', '5f8fa66f-0587-4201-951c-3eab63f7291d', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d0e9ffad-f405-5c8d-98c3-5a65b2bd4207', 'facc7ab5-fe8a-4c86-824c-f9d9801024dc', 100.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', NULL, 'Insert ananas-mangue', 'Recette de base partagée. Utilisée dans : #3.

Procédé :
1. Mélanger le sucre avec la pectine NH.
2. Chauffer la purée et l’eau.
3. Ajouter le mélange sucre/pectine en pluie.
4. Porter à ébullition en fouettant.
5. Couler en insert et surgeler.', 918, 'g', true, '[{"ordre": 1, "nom": "Mélanger le sucre avec la pectine NH.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Chauffer la purée et l’eau.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le mélange sucre/pectine en pluie.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Porter à ébullition en fouettant.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler en insert et surgeler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', 'e0ecef6f-e495-48a2-957e-24fca75a42eb', 242.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', '942672ed-6b5b-4165-9e68-3706c98b163b', 81.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', '00000000-0000-4000-a000-000000000001', 89.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', 'f08812cf-132d-4f1c-9752-6e704419761b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', NULL, 'Insert framboise', 'Recette de base partagée. Utilisée dans : #8.

Procédé :
1. Mélanger le sucre avec la pectine NH.
2. Chauffer la purée et l’eau.
3. Ajouter le mélange sucre/pectine en pluie.
4. Porter à ébullition en fouettant.
5. Couler en insert et surgeler.', 400, 'g', true, '[{"ordre": 1, "nom": "Mélanger le sucre avec la pectine NH.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Chauffer la purée et l’eau.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le mélange sucre/pectine en pluie.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Porter à ébullition en fouettant.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler en insert et surgeler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', '942672ed-6b5b-4165-9e68-3706c98b163b', 21.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', 'aa6f489c-197c-493b-b989-3cb5dd4ae397', 242.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', '00000000-0000-4000-a000-000000000001', 81.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('ee341f04-c45e-54a5-98b8-db899175ffc1', '8f2939d6-aa6c-4e1e-a960-8ccaafed2328', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', NULL, 'Insert poire', 'Recette de base partagée. Utilisée dans : #15.

Procédé :
1. Mélanger le sucre avec la pectine NH.
2. Chauffer la purée et l’eau.
3. Ajouter le mélange sucre/pectine en pluie.
4. Porter à ébullition en fouettant.
5. Couler en insert et surgeler.', 351, 'g', true, '[{"ordre": 1, "nom": "Mélanger le sucre avec la pectine NH.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Chauffer la purée et l’eau.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter le mélange sucre/pectine en pluie.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Porter à ébullition en fouettant.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Couler en insert et surgeler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', '942672ed-6b5b-4165-9e68-3706c98b163b', 21.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', '11441c2b-901b-5ae1-a265-92c72b52a89f', 242.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', '00000000-0000-4000-a000-000000000001', 81.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', 'bd2be10d-1930-4e4f-b0c1-a68a8427b96e', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('0a59883f-917d-5a1b-8b49-cb07bd8ed238', '96299373-816e-4426-9a32-b019a8fc120d', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', NULL, 'Mousse chocolat Élégance - fiche partiellement lisible', 'Recette de base partagée. Utilisée dans : #60.', 1.846, 'kg', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', '942672ed-6b5b-4165-9e68-3706c98b163b', 317.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 669.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', 'ab27e0de-004c-4711-a606-deb44108584a', 306.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 265.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', '00000000-0000-4000-a000-000000000001', 228.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 61.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', NULL, 'Mousse chocolat lait', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Réaliser une crème anglaise avec le lait, les jaunes et le sucre.
2. Ajouter la gélatine hydratée puis verser sur le chocolat lait.
3. Mixer et laisser redescendre en température.
4. Incorporer la crème montée.', 1.026, 'kg', true, '[{"ordre": 1, "nom": "Réaliser une crème anglaise avec le lait, les jaunes et le sucre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine hydratée puis verser sur le chocolat lait.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mixer et laisser redescendre en température.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Incorporer la crème montée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 40.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', '942672ed-6b5b-4165-9e68-3706c98b163b', 20.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 6.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', '2a634f35-27c6-40ae-b68d-71b7274c359c', 370.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('c123b103-e917-5e0a-a212-27367a027ddd', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 390.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', NULL, 'Mousse chocolat noir', 'Recette de base partagée. Utilisée dans : #25.

Procédé :
1. Cuire eau et sucre à 118°C.
2. Verser sur œufs et jaunes montés.
3. Incorporer le chocolat noir fondu.
4. Ajouter délicatement la crème montée.', 1.081, 'kg', true, '[{"ordre": 1, "nom": "Cuire eau et sucre à 118°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Verser sur œufs et jaunes montés.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer le chocolat noir fondu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter délicatement la crème montée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', 'ab27e0de-004c-4711-a606-deb44108584a', 90.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 107.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', '942672ed-6b5b-4165-9e68-3706c98b163b', 125.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', '00000000-0000-4000-a000-000000000001', 40.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', 'baec2b8b-1504-4f06-8305-f57ef702ba70', 282.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('433152d7-364e-596d-8ede-d0ff1c2000c7', '2a634f35-27c6-40ae-b68d-71b7274c359c', 437.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', NULL, 'Mousse citron', 'Recette de base partagée. Utilisée dans : #1.

Procédé :
1. Chauffer la partie liquide avec le sucre ou les purées selon la recette.
2. Ajouter la gélatine préalablement hydratée.
3. Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.
4. Refroidir la base à environ 32-35°C.
5. Incorporer délicatement la crème montée et utiliser immédiatement.', 1.745, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la partie liquide avec le sucre ou les purées selon la recette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine préalablement hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Refroidir la base à environ 32-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Incorporer délicatement la crème montée et utiliser immédiatement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', '942672ed-6b5b-4165-9e68-3706c98b163b', 89.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', 'a96cd029-24a3-4086-9edb-ae7f1fd36200', 400.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 30.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', '2a634f35-27c6-40ae-b68d-71b7274c359c', 726.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f30ec89-4bbe-5547-a211-2a84f03d4ecb', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', NULL, 'Mousse coco', 'Recette de base partagée. Utilisée dans : #3.

Procédé :
1. Chauffer la partie liquide avec le sucre ou les purées selon la recette.
2. Ajouter la gélatine préalablement hydratée.
3. Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.
4. Refroidir la base à environ 32-35°C.
5. Incorporer délicatement la crème montée et utiliser immédiatement.', 1.67, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la partie liquide avec le sucre ou les purées selon la recette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine préalablement hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Refroidir la base à environ 32-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Incorporer délicatement la crème montée et utiliser immédiatement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', '942672ed-6b5b-4165-9e68-3706c98b163b', 80.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', 'e0b0a1a6-a984-558b-91af-0a4bd7010a0a', 330.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 30.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', '2a634f35-27c6-40ae-b68d-71b7274c359c', 726.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('502b60f2-6a4b-5e18-886b-db69303dc641', '2d4788ca-92c7-5e4e-9aaf-9375d76e0df8', 4.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', NULL, 'Mousse exotique passion-mangue', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Chauffer les purées de fruits et ajouter la gélatine hydratée.
2. Réaliser une meringue italienne avec l’eau, le sucre et les blancs.
3. Incorporer la meringue à la base fruitée puis ajouter la crème montée.
4. Utiliser immédiatement pour le montage.
5. Crème au beurre spéciale et ganache montée chocolat', 647, 'g', true, '[{"ordre": 1, "nom": "Chauffer les purées de fruits et ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Réaliser une meringue italienne avec l’eau, le sucre et les blancs.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer la meringue à la base fruitée puis ajouter la crème montée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Utiliser immédiatement pour le montage.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Crème au beurre spéciale et ganache montée chocolat", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 38.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', '00000000-0000-4000-a000-000000000001', 19.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', '942672ed-6b5b-4165-9e68-3706c98b163b', 77.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', '2a634f35-27c6-40ae-b68d-71b7274c359c', 217.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 10.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', '21a31838-79de-584e-ac3e-d1c6d5555e1f', 143.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('336f53c0-fecd-5c50-aed8-bca8725a90a4', 'e0ecef6f-e495-48a2-957e-24fca75a42eb', 143.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', NULL, 'Mousse framboise', 'Recette de base partagée. Utilisée dans : #8.

Procédé :
1. Chauffer la partie liquide avec le sucre ou les purées selon la recette.
2. Ajouter la gélatine préalablement hydratée.
3. Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.
4. Refroidir la base à environ 32-35°C.
5. Incorporer délicatement la crème montée et utiliser immédiatement.', 1.69, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la partie liquide avec le sucre ou les purées selon la recette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine préalablement hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Refroidir la base à environ 32-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Incorporer délicatement la crème montée et utiliser immédiatement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', '942672ed-6b5b-4165-9e68-3706c98b163b', 89.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', 'aa6f489c-197c-493b-b989-3cb5dd4ae397', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 145.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 30.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', '2a634f35-27c6-40ae-b68d-71b7274c359c', 726.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('59c2de29-52c9-5656-b0d1-00e9631c80a3', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('14be466d-40ba-5642-96d6-552771959bb6', NULL, 'Mousse ivoire', 'Recette de base partagée. Utilisée dans : #23.

Procédé :
1. Chauffer la partie liquide avec le sucre ou les purées selon la recette.
2. Ajouter la gélatine préalablement hydratée.
3. Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.
4. Refroidir la base à environ 32-35°C.
5. Incorporer délicatement la crème montée et utiliser immédiatement.', 1.585, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la partie liquide avec le sucre ou les purées selon la recette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine préalablement hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Refroidir la base à environ 32-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Incorporer délicatement la crème montée et utiliser immédiatement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('14be466d-40ba-5642-96d6-552771959bb6', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 800.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('14be466d-40ba-5642-96d6-552771959bb6', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 28.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('14be466d-40ba-5642-96d6-552771959bb6', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 756.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('14be466d-40ba-5642-96d6-552771959bb6', '2a634f35-27c6-40ae-b68d-71b7274c359c', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', NULL, 'Mousse noisette', 'Recette de base partagée. Utilisée dans : #2.

Procédé :
1. Réaliser une crème anglaise avec le lait, le sucre et les jaunes.
2. Cuire à 82-84°C.
3. Ajouter la gélatine hydratée.
4. Verser sur le chocolat au lait et le praliné noisette, puis mixer.
5. À 32-35°C, incorporer la crème montée.', 2.543, 'kg', true, '[{"ordre": 1, "nom": "Réaliser une crème anglaise avec le lait, le sucre et les jaunes.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Cuire à 82-84°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Ajouter la gélatine hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Verser sur le chocolat au lait et le praliné noisette, puis mixer.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "À 32-35°C, incorporer la crème montée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '942672ed-6b5b-4165-9e68-3706c98b163b', 52.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 31.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 520.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 104.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '4356a9fb-2457-4b89-a493-bfa6abcce22e', 434.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '2a634f35-27c6-40ae-b68d-71b7274c359c', 968.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('abb8d6dc-ff80-5454-af8a-5d58fbefc09f', '306c5e57-1077-4b0c-a1c8-b7e520f6c2d6', 434.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', NULL, 'Mousse passion', 'Recette de base partagée. Utilisée dans : #20.

Procédé :
1. Chauffer lait et purée passion.
2. Ajouter la gélatine.
3. Incorporer le cream cheese.
4. Ajouter les blancs montés puis la crème fouettée.', 309, 'g', true, '[{"ordre": 1, "nom": "Chauffer lait et purée passion.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer le cream cheese.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter les blancs montés puis la crème fouettée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '942672ed-6b5b-4165-9e68-3706c98b163b', 59.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 53.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '21a31838-79de-584e-ac3e-d1c6d5555e1f', 0.2050, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 0.0840, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 10.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '2a634f35-27c6-40ae-b68d-71b7274c359c', 155.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('994f071a-7b7a-53b5-ba1d-d54581cb7f5e', '0141b1a5-5e5f-5c43-b176-70cae945da41', 32.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', NULL, 'Mousse poire', 'Recette de base partagée. Utilisée dans : #15.

Procédé :
1. Chauffer la partie liquide avec le sucre ou les purées selon la recette.
2. Ajouter la gélatine préalablement hydratée.
3. Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.
4. Refroidir la base à environ 32-35°C.
5. Incorporer délicatement la crème montée et utiliser immédiatement.', 1.69, 'kg', true, '[{"ordre": 1, "nom": "Chauffer la partie liquide avec le sucre ou les purées selon la recette.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la gélatine préalablement hydratée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Verser sur le chocolat blanc et mixer pour obtenir une émulsion lisse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Refroidir la base à environ 32-35°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Incorporer délicatement la crème montée et utiliser immédiatement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', '942672ed-6b5b-4165-9e68-3706c98b163b', 89.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', '11441c2b-901b-5ae1-a265-92c72b52a89f', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 145.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', 'a96fba58-1795-423a-ab8a-086fb2cb41ac', 30.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', '2a634f35-27c6-40ae-b68d-71b7274c359c', 726.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('41281d8b-1088-5d60-b7b6-bced59d8fdbc', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('4623d916-e43a-5bcc-b8a9-48d576bc4928', NULL, 'Mousse praliné amande', 'Recette de base partagée. Utilisée dans : #30.

Procédé :
1. Détendre le beurre avec le praliné.
2. Incorporer la crème fouettée.', 1.11, 'kg', true, '[{"ordre": 1, "nom": "Détendre le beurre avec le praliné.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Incorporer la crème fouettée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4623d916-e43a-5bcc-b8a9-48d576bc4928', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 250.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4623d916-e43a-5bcc-b8a9-48d576bc4928', '4e1b2877-c7d5-4cdf-94ba-57257a216f4c', 350.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4623d916-e43a-5bcc-b8a9-48d576bc4928', '2a634f35-27c6-40ae-b68d-71b7274c359c', 510.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', NULL, 'Mousse Royal chocolat', 'Recette de base partagée. Utilisée dans : #5.

Procédé :
1. Cuire l’eau et le sucre à 118°C.
2. Verser sur les œufs et jaunes montés pour obtenir une pâte à bombe.
3. Incorporer les chocolats fondus.
4. Ajouter délicatement la crème montée.', 1.952, 'kg', true, '[{"ordre": 1, "nom": "Cuire l’eau et le sucre à 118°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Verser sur les œufs et jaunes montés pour obtenir une pâte à bombe.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Incorporer les chocolats fondus.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Ajouter délicatement la crème montée.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', 'ab27e0de-004c-4711-a606-deb44108584a', 162.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', '48d7ca82-40dc-46a3-a9f0-c900a2edccd9', 194.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', '942672ed-6b5b-4165-9e68-3706c98b163b', 226.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', '00000000-0000-4000-a000-000000000001', 72.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', 'baec2b8b-1504-4f06-8305-f57ef702ba70', 310.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', '86f36fd5-9812-447b-9c5e-c26622f837f3', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('4f58103b-5d31-5365-9bd7-283b6a99aa98', '2a634f35-27c6-40ae-b68d-71b7274c359c', 788.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', NULL, 'Pâte à choux', 'Recette de base partagée. Utilisée dans : #9.

Procédé :
1. Porter à ébullition l’eau, le beurre et le sel.
2. Ajouter la farine en une seule fois hors du feu.
3. Dessécher la pâte jusqu’à ce qu’elle se décolle de la casserole.
4. Mettre en cuve et incorporer les œufs progressivement.
5. Pocher et cuire à 170-180°C sans ouvrir le four au début de cuisson.', 1.998, 'kg', true, '[{"ordre": 1, "nom": "Porter à ébullition l’eau, le beurre et le sel.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter la farine en une seule fois hors du feu.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Dessécher la pâte jusqu’à ce qu’elle se décolle de la casserole.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Mettre en cuve et incorporer les œufs progressivement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 5, "nom": "Pocher et cuire à 170-180°C sans ouvrir le four au début de cuisson.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', '00000000-0000-4000-a000-000000000001', 722.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 325.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 12.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', '2a44fd1a-1787-49cb-a492-c776cb200a50', 397.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('dca09036-bad4-5544-bb39-452f71f618dc', 'ab27e0de-004c-4711-a606-deb44108584a', 542.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('8538539d-d055-57a1-bb6b-f7532e8250ed', NULL, 'Pâte d’amande', 'Recette de base partagée. Utilisée dans : #30.

Procédé :
1. Étaler en couche régulière pour finition du cadre.', 800, 'g', true, '[{"ordre": 1, "nom": "Étaler en couche régulière pour finition du cadre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8538539d-d055-57a1-bb6b-f7532e8250ed', '34f07857-bf70-41e9-95ad-b874420f3ef9', 800.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', NULL, 'Pâte macaron citron', 'Recette de base partagée. Utilisée dans : #60.

Procédé :
1. Réaliser une base macaron selon le procédé du laboratoire.
2. Macaronner jusqu’à obtention d’une masse souple et brillante.
3. Dresser les coques, laisser croûter si nécessaire puis cuire selon le four.
4. Crème au beurre citron pour macaron - partielle', 694, 'g', true, '[{"ordre": 1, "nom": "Réaliser une base macaron selon le procédé du laboratoire.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Macaronner jusqu’à obtention d’une masse souple et brillante.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Dresser les coques, laisser croûter si nécessaire puis cuire selon le four.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Crème au beurre citron pour macaron - partielle", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '942672ed-6b5b-4165-9e68-3706c98b163b', 158.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 106.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 144.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '00000000-0000-4000-a000-000000000001', 44.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', 'd36fa75b-eb52-4fb9-bced-050c414759f8', 144.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '18bac65e-4c9e-5767-b6cb-210827041c0d', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '942672ed-6b5b-4165-9e68-3706c98b163b', 53.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '72e8aa65-7de9-4c77-9303-7aaa24e3d75c', 27.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', '00000000-0000-4000-a000-000000000001', 17.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', NULL, 'Pâte sucrée', 'Recette de base partagée. Utilisée dans : #13, #14.

Procédé :
1. Sabler les poudres avec le beurre.
2. Ajouter les œufs.
3. Filmer et réserver au froid.
4. Foncer les moules individuels.', 1.246, 'kg', true, '[{"ordre": 1, "nom": "Sabler les poudres avec le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter les œufs.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Filmer et réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Foncer les moules individuels.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 65.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', '2a44fd1a-1787-49cb-a492-c776cb200a50', 455.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', 'aa371a0f-f5d5-48ae-8cb9-ec30ff401d03', 80.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', 'ab27e0de-004c-4711-a606-deb44108584a', 120.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', 'd36fa75b-eb52-4fb9-bced-050c414759f8', 205.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 0.5000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('d1577f4a-7045-57e0-b6a4-dcf988255677', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 320.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', NULL, 'Pâte sucrée chocolat', 'Recette de base partagée. Utilisée dans : #18.

Procédé :
1. Sabler les poudres avec le beurre.
2. Ajouter les œufs.
3. Mélanger rapidement, filmer et réserver au froid.', 2.442, 'kg', true, '[{"ordre": 1, "nom": "Sabler les poudres avec le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter les œufs.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mélanger rapidement, filmer et réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 130.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', '2a44fd1a-1787-49cb-a492-c776cb200a50', 910.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', 'aa371a0f-f5d5-48ae-8cb9-ec30ff401d03', 160.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', 'ab27e0de-004c-4711-a606-deb44108584a', 240.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', 'd36fa75b-eb52-4fb9-bced-050c414759f8', 410.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('deb6b5f5-e256-58ff-b210-66bce0367fe0', '80b8db50-30b8-46e8-94ba-0b4ba5d52674', 91.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', NULL, 'Pâte sucrée nature', 'Recette de base partagée. Utilisée dans : #10.

Procédé :
1. Sabler les ingrédients secs avec le beurre.
2. Ajouter les œufs sans trop travailler.
3. Filmer et réserver au froid minimum 2 heures.
4. Abaisser et foncer selon utilisation.', 2.491, 'kg', true, '[{"ordre": 1, "nom": "Sabler les ingrédients secs avec le beurre.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter les œufs sans trop travailler.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Filmer et réserver au froid minimum 2 heures.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Abaisser et foncer selon utilisation.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 130.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', '2a44fd1a-1787-49cb-a492-c776cb200a50', 910.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', 'aa371a0f-f5d5-48ae-8cb9-ec30ff401d03', 160.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', 'ab27e0de-004c-4711-a606-deb44108584a', 240.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', 'd36fa75b-eb52-4fb9-bced-050c414759f8', 410.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 1.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8b551ad9-70c5-5ae6-8d32-90dfe0740c03', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 640.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('e2188838-89eb-521e-9b05-a5d0b3239a90', NULL, 'Pistolet chocolat orange / vert', 'Recette de base partagée. Utilisée dans : #27.', 700, 'g', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e2188838-89eb-521e-9b05-a5d0b3239a90', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e2188838-89eb-521e-9b05-a5d0b3239a90', 'edaf477e-5762-41d8-a6f1-f53a6ae16193', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('b2f3be4e-faa1-58fb-b613-71b3639562f4', NULL, 'Pistolet jaune', 'Recette de base partagée. Utilisée dans : #1.

Procédé :
1. Faire fondre le chocolat et le beurre de cacao.
2. Ajouter le colorant liposoluble.
3. Mixer soigneusement sans incorporer trop d’air.
4. Utiliser au pistolet sur pièces congelées, autour de 35-40°C.', 2.01, 'kg', true, '[{"ordre": 1, "nom": "Faire fondre le chocolat et le beurre de cacao.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Ajouter le colorant liposoluble.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Mixer soigneusement sans incorporer trop d’air.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 4, "nom": "Utiliser au pistolet sur pièces congelées, autour de 35-40°C.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('b2f3be4e-faa1-58fb-b613-71b3639562f4', 'edaf477e-5762-41d8-a6f1-f53a6ae16193', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('b2f3be4e-faa1-58fb-b613-71b3639562f4', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 1.0000, 'kg') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('b2f3be4e-faa1-58fb-b613-71b3639562f4', 'ed375a73-0f94-5b7f-82b9-6a7efde8fa86', 10.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('25dca085-e290-5e04-b9f8-71c7ac805b18', NULL, 'Pistolet rouge', 'Recette de base partagée. Utilisée dans : #8.', 700, 'g', true, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25dca085-e290-5e04-b9f8-71c7ac805b18', 'a5df2a42-f34f-4cb8-9227-edcb9c18333b', 500.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('25dca085-e290-5e04-b9f8-71c7ac805b18', 'edaf477e-5762-41d8-a6f1-f53a6ae16193', 200.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('3f9a90c1-76ce-5953-99cd-87596043ea6b', NULL, 'Sirop', 'Recette de base partagée. Utilisée dans : #30.

Procédé :
1. Porter à ébullition puis refroidir.', 1.0, 'kg', true, '[{"ordre": 1, "nom": "Porter à ébullition puis refroidir.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('3f9a90c1-76ce-5953-99cd-87596043ea6b', '942672ed-6b5b-4165-9e68-3706c98b163b', 375.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('3f9a90c1-76ce-5953-99cd-87596043ea6b', '00000000-0000-4000-a000-000000000001', 625.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('8ce0ab29-4c52-5a6f-95af-ee685a4839da', NULL, 'Sirop 30°', 'Recette de base partagée. Utilisée dans : #25, #29.

Procédé :
1. Porter à ébullition puis refroidir.', 533, 'g', true, '[{"ordre": 1, "nom": "Porter à ébullition puis refroidir.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8ce0ab29-4c52-5a6f-95af-ee685a4839da', '942672ed-6b5b-4165-9e68-3706c98b163b', 333.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('8ce0ab29-4c52-5a6f-95af-ee685a4839da', '00000000-0000-4000-a000-000000000001', 200.0000, 'ml') ON CONFLICT DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, etapes) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', NULL, 'Streusel', 'Recette de base partagée. Utilisée dans : #12, #14.

Procédé :
1. Mélanger jusqu’à texture sableuse.
2. Réserver au froid.
3. Saupoudrer après refroidissement.', 202, 'g', true, '[{"ordre": 1, "nom": "Mélanger jusqu’à texture sableuse.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 2, "nom": "Réserver au froid.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}, {"ordre": 3, "nom": "Saupoudrer après refroidissement.", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": "patissier"}]'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', '942672ed-6b5b-4165-9e68-3706c98b163b', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', '5bbc3a3e-25d6-462e-830c-f29951dcc224', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', '2a44fd1a-1787-49cb-a492-c776cb200a50', 50.0000, 'g') ON CONFLICT DO NOTHING;
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ('e09b67bf-1eda-58a2-8840-0070dd9aadaa', '901159aa-ab80-4874-acf4-80f98d26db1c', 2.0000, 'g') ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. PRODUCTS & PARENT RECIPES (link to generic bases)
-- ============================================================

-- ─── #1. Trompe-l’œil citron / pistache ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('9694a915-f7c9-5f46-852b-64d194072336', 'Trompe-l’œil citron / pistache', '1-trompe-lil-citron-pistache', 12, 0, 0, true, 'PAT-001') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('51231cfd-2802-53bc-9e8f-f8af792279bc', '9694a915-f7c9-5f46-852b-64d194072336', 'Trompe-l’œil citron / pistache', '[Méta] Type: Individuel trompe-l’œil | Dosage indicatif: Mousse citron 70 g, crémeux pistache 15 g, enrobage 20 g, biscuit 4 g
Composition : Biscuit génoise nature / Crémeux pistache / Mousse citron / Enrobage chocolat blanc jaune

Montage / finition :
1. Couler la mousse dans les moules.
2. Insérer le crémeux pistache surgelé.
3. Fermer avec le biscuit détaillé.
4. Surgeler complètement.
5. Pulvériser l’enrobage jaune au pistolet.

⚠️ À confirmer / vigilance : Vérifier si les 30 g de gélatine correspondent à de la gélatine sèche ou à une masse gélatine hydratée.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('51231cfd-2802-53bc-9e8f-f8af792279bc', '4f30ec89-4bbe-5547-a211-2a84f03d4ecb', 1.745) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('51231cfd-2802-53bc-9e8f-f8af792279bc', 'e39b8229-d057-5225-9908-b7610a012f74', 264) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('51231cfd-2802-53bc-9e8f-f8af792279bc', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('51231cfd-2802-53bc-9e8f-f8af792279bc', 'b2f3be4e-faa1-58fb-b613-71b3639562f4', 2.01) ON CONFLICT DO NOTHING;

-- ─── #2. Entremets Cookie chocolat / noisette ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('2438286c-4f00-501c-a340-4584e147da9c', 'Entremets Cookie chocolat / noisette', '2-entremets-cookie-chocolat-noisette', 12, 0, 0, true, 'PAT-002') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('0184ab63-5519-598f-8b00-9ba75fc7d624', '2438286c-4f00-501c-a340-4584e147da9c', 'Entremets Cookie chocolat / noisette', 'Composition : Biscuit chocolat moelleux / Mousse noisette / Crémeux chocolat au lait / Glaçage rocher ou enrobage

Montage / finition :
1. Détailler le biscuit.
2. Couler la mousse noisette en moule.
3. Ajouter l’insert crémeux chocolat au lait.
4. Fermer avec le biscuit.
5. Surgeler, démouler puis glacer.

⚠️ À confirmer / vigilance : Le terme exact du dessert est manuscrit; fiche structurée comme entremets cookie chocolat/noisette.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0184ab63-5519-598f-8b00-9ba75fc7d624', '0975e302-992e-5817-b624-149e0876e978', 1.068) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0184ab63-5519-598f-8b00-9ba75fc7d624', 'abb8d6dc-ff80-5454-af8a-5d58fbefc09f', 2.543) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0184ab63-5519-598f-8b00-9ba75fc7d624', '77b23532-51a6-5250-afdc-52d0ffcd9334', 1.08) ON CONFLICT DO NOTHING;

-- ─── #3. Trompe-l’œil coco / mangue / ananas ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('b441d35a-c69a-5c1a-97a8-0d9bbd6555ff', 'Trompe-l’œil coco / mangue / ananas', '3-trompe-lil-coco-mangue-ananas', 12, 0, 0, true, 'PAT-003') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a10509e4-fb23-5be9-b6d8-969e1cef0266', 'b441d35a-c69a-5c1a-97a8-0d9bbd6555ff', 'Trompe-l’œil coco / mangue / ananas', 'Composition : Insert mangue-ananas / Mousse coco / Biscuit génoise nature / Enrobage chocolat au lait / beurre de cacao

Montage / finition :
1. Couler la mousse coco.
2. Ajouter l’insert mangue-ananas surgelé.
3. Fermer avec la génoise imbibée.
4. Surgeler et pulvériser l’enrobage.

⚠️ À confirmer / vigilance : Certaines quantités de l’insert doivent être validées avant production.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a10509e4-fb23-5be9-b6d8-969e1cef0266', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a10509e4-fb23-5be9-b6d8-969e1cef0266', 'cea5fd3a-e01a-5fa8-a9eb-711eaddf6519', 918) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a10509e4-fb23-5be9-b6d8-969e1cef0266', '502b60f2-6a4b-5e18-886b-db69303dc641', 1.67) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a10509e4-fb23-5be9-b6d8-969e1cef0266', '6fe27312-2815-5e31-9084-dcb6de7e411e', 2.0) ON CONFLICT DO NOTHING;

-- ─── #4. Entremets Noisette + ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('08c5acb6-8961-5d8d-ab8b-9a35746a7a22', 'Entremets Noisette +', '4-entremets-noisette', 12, 0, 0, true, 'PAT-004') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('722342fc-8aff-543c-934f-24a99870df04', '08c5acb6-8961-5d8d-ab8b-9a35746a7a22', 'Entremets Noisette +', 'Composition : Biscuit génoise chocolat / Croustillant praliné noisette / Bavaroise noisette / Glaçage rocher lait

Montage / finition :
1. Biscuit chocolat.
2. Croustillant praliné.
3. Bavaroise noisette.
4. Surgélation complète.
5. Glaçage rocher au lait.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('722342fc-8aff-543c-934f-24a99870df04', '01b3d463-860c-510a-b104-9bb39602de1d', 812) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('722342fc-8aff-543c-934f-24a99870df04', 'be9d1e6e-4e44-5332-8ecc-b7b70502def5', 870) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('722342fc-8aff-543c-934f-24a99870df04', '9b1b7ee4-88c9-5268-8105-831c4f02102a', 2.21) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('722342fc-8aff-543c-934f-24a99870df04', 'd0e9ffad-f405-5c8d-98c3-5a65b2bd4207', 1.3) ON CONFLICT DO NOTHING;

-- ─── #5. Royal chocolat ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('44061c23-dddd-532c-ae8c-51ff58e317a9', 'Royal chocolat', '5-royal-chocolat', 12, 0, 0, true, 'PAT-005') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('f750ee33-3cfa-5b91-9ab5-50fb6ff5d590', '44061c23-dddd-532c-ae8c-51ff58e317a9', 'Royal chocolat', 'Composition : Biscuit génoise chocolat / Mousse Royal chocolat / Pâte feuilletine / Glaçage noir / Nougatine amande effilée

Montage / finition :
1. Alterner biscuit, croustillant et mousse chocolat.
2. Surgeler.
3. Glacer au glaçage noir.
4. Décorer avec nougatine ou éléments chocolat.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f750ee33-3cfa-5b91-9ab5-50fb6ff5d590', '01b3d463-860c-510a-b104-9bb39602de1d', 812) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f750ee33-3cfa-5b91-9ab5-50fb6ff5d590', '4f58103b-5d31-5365-9bd7-283b6a99aa98', 1.952) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f750ee33-3cfa-5b91-9ab5-50fb6ff5d590', '5fd02d65-4673-52eb-8441-cdd993f5eeff', 1.01) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f750ee33-3cfa-5b91-9ab5-50fb6ff5d590', '013e167a-c108-5f7d-890f-110fcce77d21', 1.002) ON CONFLICT DO NOTHING;

-- ─── #6. Compotée framboise ───

-- ─── #7. Glaçage cake fruits secs ───

-- ─── #8. Trompe-l’œil framboise ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('7e08102c-be54-5fda-a12e-1f9dc5cb571d', 'Trompe-l’œil framboise', '8-trompe-lil-framboise', 12, 0, 0, true, 'PAT-008') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('6235aa64-4be6-5c87-9e9f-c478661baba2', '7e08102c-be54-5fda-a12e-1f9dc5cb571d', 'Trompe-l’œil framboise', '[Méta] Dosage indicatif: Insert 10 g, mousse 40 g, biscuit 5 g
Composition : Biscuit génoise nature / Insert framboise / Mousse framboise / Pistolet rouge

Montage / finition :
1. Couler la mousse en moule.
2. Ajouter l’insert framboise surgelé.
3. Fermer avec le biscuit.
4. Surgeler et pulvériser au pistolet rouge.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('6235aa64-4be6-5c87-9e9f-c478661baba2', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('6235aa64-4be6-5c87-9e9f-c478661baba2', '59c2de29-52c9-5656-b0d1-00e9631c80a3', 1.69) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('6235aa64-4be6-5c87-9e9f-c478661baba2', 'ee341f04-c45e-54a5-98b8-db899175ffc1', 400) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('6235aa64-4be6-5c87-9e9f-c478661baba2', '25dca085-e290-5e04-b9f8-71c7ac805b18', 700) ON CONFLICT DO NOTHING;

-- ─── #9. Pâte à choux ───

-- ─── #10. Pâte sucrée nature ───

-- ─── #11. Tarte chocolat ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('ff56b772-63dd-5a1b-8dff-a5481e5eeac9', 'Tarte chocolat', '11-tarte-chocolat', 11, 0, 0, true, 'PAT-011') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('d585b777-a2e1-5db8-9d70-49a17ac9b5c4', 'ff56b772-63dd-5a1b-8dff-a5481e5eeac9', 'Tarte chocolat', 'Composition : Fond de pâte sucrée chocolat / Ganache chocolat noir / Caramel noix/macadamia [à confirmer]

Montage / finition :
1. Cuire les fonds de tarte.
2. Garnir d’une couche de caramel si prévu.
3. Couler la ganache chocolat noir.
4. Laisser cristalliser et décorer.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('d585b777-a2e1-5db8-9d70-49a17ac9b5c4', 'a17605a3-ccf3-5962-88ab-5bd2d158fc12', 1.726) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('d585b777-a2e1-5db8-9d70-49a17ac9b5c4', 'd359b304-9204-5071-8dde-e8321d8d6063', 1.0) ON CONFLICT DO NOTHING;

-- ─── #12. Tarte banane ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('a4f501c4-55ef-58cd-9cf5-705805be2c64', 'Tarte banane', '12-tarte-banane', 11, 0, 0, true, 'PAT-012') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('414544b5-d601-5496-837e-50e1381a9d02', 'a4f501c4-55ef-58cd-9cf5-705805be2c64', 'Tarte banane', 'Composition : Fond de pâte sucrée / Crème amande chocolat / Banane / Streusel / Garniture lactée/cacao

Montage / finition :
1. Foncer le fond de tarte.
2. Garnir de crème amande chocolat.
3. Ajouter la banane et le streusel.
4. Cuire puis finir selon la présentation souhaitée.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('414544b5-d601-5496-837e-50e1381a9d02', '499b4f0b-b4a8-5f13-b586-4e2d14a42211', 430) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('414544b5-d601-5496-837e-50e1381a9d02', 'ddd3399e-0b19-5d35-b87c-136eef7ff468', 212) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('414544b5-d601-5496-837e-50e1381a9d02', 'e09b67bf-1eda-58a2-8840-0070dd9aadaa', 202) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('414544b5-d601-5496-837e-50e1381a9d02', 'd8385726-400b-5808-ac66-19ebb9cbc5d8', 800) ON CONFLICT DO NOTHING;

-- ─── #13. Tarte aux pommes individuelle ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('30c360df-f29d-50c5-8ac8-be21008907b3', 'Tarte aux pommes individuelle', '13-tarte-aux-pommes-individuelle', 11, 0, 0, true, 'PAT-013') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('f82ef5f2-c3d8-5a50-b396-23ba51fdda2a', '30c360df-f29d-50c5-8ac8-be21008907b3', 'Tarte aux pommes individuelle', '[Méta] Rendement: Environ 10 pièces | Cuisson: 160°C / 20 min
Composition : Fond de pâte sucrée / Crème amande nature / Topping pommes / Nappage

Montage / finition :
1. Foncer chaque moule.
2. Garnir avec 33 g de crème amande.
3. Ajouter 44 g de topping pommes.
4. Cuire à 160°C pendant 20 min.
5. Refroidir et napper.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f82ef5f2-c3d8-5a50-b396-23ba51fdda2a', 'd1577f4a-7045-57e0-b6a4-dcf988255677', 1.246) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f82ef5f2-c3d8-5a50-b396-23ba51fdda2a', 'cd60a259-88cf-506b-b8ad-809f2b865d97', 1.598) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('f82ef5f2-c3d8-5a50-b396-23ba51fdda2a', '1b3df13a-c8c0-539f-856d-c27b899cb2fa', 360) ON CONFLICT DO NOTHING;

-- ─── #14. Tarte banane individuelle carrée ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('0d7f9b2d-b5d1-56e1-bbad-5144d10117da', 'Tarte banane individuelle carrée', '14-tarte-banane-individuelle-carree', 11, 0, 0, true, 'PAT-014') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('986ea531-e5e5-5b0e-8454-f0b3a49575c6', '0d7f9b2d-b5d1-56e1-bbad-5144d10117da', 'Tarte banane individuelle carrée', '[Méta] Cuisson: 160°C / 20 min | Dosages: 55 g pâte, 53 g crème amande chocolat, 15 g banane, 6 g streusel
Composition : Pâte sucrée / Crème amande chocolat / Banane fraîche / Streusel / Sucre neige

Montage / finition :
1. Foncer avec 55 g de pâte.
2. Garnir avec 53 g de crème amande chocolat.
3. Ajouter 15 g de banane fraîche.
4. Parsemer 6 g de streusel.
5. Cuire puis finir au sucre neige.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('986ea531-e5e5-5b0e-8454-f0b3a49575c6', '499b4f0b-b4a8-5f13-b586-4e2d14a42211', 430) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('986ea531-e5e5-5b0e-8454-f0b3a49575c6', 'e09b67bf-1eda-58a2-8840-0070dd9aadaa', 202) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('986ea531-e5e5-5b0e-8454-f0b3a49575c6', 'd1577f4a-7045-57e0-b6a4-dcf988255677', 1.246) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('986ea531-e5e5-5b0e-8454-f0b3a49575c6', 'dda9ce1b-1a22-5016-b0ba-591a2c104077', 660) ON CONFLICT DO NOTHING;

-- ─── #15. Trompe-l’œil poire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('cd5e0744-ecd6-55a6-bfc3-89937fa848f7', 'Trompe-l’œil poire', '15-trompe-lil-poire', 12, 0, 0, true, 'PAT-015') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('c1455408-b5fd-50d3-a9d9-cbb0597887ca', 'cd5e0744-ecd6-55a6-bfc3-89937fa848f7', 'Trompe-l’œil poire', 'Composition : Biscuit génoise nature / Insert poire / Mousse poire / Enrobage vert

Montage / finition :
1. Couler la mousse poire.
2. Ajouter l’insert poire surgelé.
3. Fermer avec le biscuit.
4. Surgeler et pulvériser l’enrobage vert.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('c1455408-b5fd-50d3-a9d9-cbb0597887ca', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('c1455408-b5fd-50d3-a9d9-cbb0597887ca', '41281d8b-1088-5d60-b7b6-bced59d8fdbc', 1.69) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('c1455408-b5fd-50d3-a9d9-cbb0597887ca', '0a59883f-917d-5a1b-8b49-cb07bd8ed238', 351) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('c1455408-b5fd-50d3-a9d9-cbb0597887ca', 'b0e4ea57-d8e0-55d4-bfc6-00027fd65fda', 1.0) ON CONFLICT DO NOTHING;

-- ─── #16. Barre / entremets caramel ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('c7c16e65-69f1-59dc-9212-37ca12a1cfdc', 'Barre / entremets caramel', '16-barre-entremets-caramel', 12, 0, 0, true, 'PAT-016') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', 'c7c16e65-69f1-59dc-9212-37ca12a1cfdc', 'Barre / entremets caramel', '[Méta] Format indicatif: 10 cm x 2 cm x 2 cm [à confirmer] | Cuisson biscuit: 160°C / 9 min
Composition : Biscuit chocolat moelleux / Crémeux caramel / Bavaroise vanille / Ganache montée chocolat au lait / Glaçage rocher

Montage / finition :
1. Monter en cadre ou moules barres.
2. Alterner biscuit, crémeux caramel et bavaroise vanille.
3. Surgeler.
4. Glacer au rocher ou décorer avec ganache montée.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', '0975e302-992e-5817-b624-149e0876e978', 1.068) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', '433321cd-5cf9-5c44-aac5-b564af961045', 1.583) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', '01838a41-1523-50b1-b067-1a0d8e647287', 1.267) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', '0e23cefe-1404-5516-b930-961799866f9e', 984) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('0b58c26e-b1b9-5718-b8f3-ad2107669ed5', '9001fb40-ecce-55f4-832a-b55a2a4a2033', 500) ON CONFLICT DO NOTHING;

-- ─── #17. Noisette individuel ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('3d426b51-4482-5f7b-82f1-436662f38b75', 'Noisette individuel', '17-noisette-individuel', 12, 0, 0, true, 'PAT-017') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('dfdae1cb-ac47-5c58-975c-5c76b756f920', '3d426b51-4482-5f7b-82f1-436662f38b75', 'Noisette individuel', 'Composition : Biscuit moelleux chocolat / Croustillant praliné / Bavaroise noisette / Finition chocolat au lait

Montage / finition :
1. Monter en moule individuel.
2. Ajouter biscuit et croustillant.
3. Surgeler puis glacer/décorer.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('dfdae1cb-ac47-5c58-975c-5c76b756f920', '9b1b7ee4-88c9-5268-8105-831c4f02102a', 2.21) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('dfdae1cb-ac47-5c58-975c-5c76b756f920', '87141de8-ef1c-5b61-9f68-d8ea8d6fd643', 999) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('dfdae1cb-ac47-5c58-975c-5c76b756f920', 'd42e83ba-d57e-5dcf-b8a8-f09e0c2a4e55', 820) ON CONFLICT DO NOTHING;

-- ─── #18. Pâte sucrée chocolat ───

-- ─── #19. Pistache individuel rond ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('ab952901-ab20-550e-a80e-e6209477f0a1', 'Pistache individuel rond', '19-pistache-individuel-rond', 12, 0, 0, true, 'PAT-019') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('aec5fa83-71f1-59ba-9910-d69ed22c8d61', 'ab952901-ab20-550e-a80e-e6209477f0a1', 'Pistache individuel rond', 'Composition : Biscuit génoise nature / pistache / Crémeux chocolat blanc / Bavaroise pistache / Glaçage vert / Décor pistache

Montage / finition :
1. Monter les couches en moule rond individuel.
2. Surgeler.
3. Glacer en vert et décorer avec éclats de pistache et décor chocolat blanc.

⚠️ À confirmer / vigilance : Fiche partiellement lisible : valider les quantités avant production.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('aec5fa83-71f1-59ba-9910-d69ed22c8d61', '04a787c7-00fe-51de-9c12-cbeec1519af2', 1.027) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('aec5fa83-71f1-59ba-9910-d69ed22c8d61', 'bfb656f1-40e7-5522-a99a-db8776c850d9', 665) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('aec5fa83-71f1-59ba-9910-d69ed22c8d61', '43027e07-ef43-5c93-a019-b222948a9467', 1.657) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('aec5fa83-71f1-59ba-9910-d69ed22c8d61', '9d833394-64e5-550a-a541-5a26d4a51325', 1.5) ON CONFLICT DO NOTHING;

-- ─── #20. Cake fruit de la passion ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('22b8c99c-db54-554b-ac14-113ce56f9120', 'Cake fruit de la passion', '20-cake-fruit-de-la-passion', 11, 0, 0, true, 'PAT-020') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a292d6c0-bec8-5761-8924-cbdfd81040f3', '22b8c99c-db54-554b-ac14-113ce56f9120', 'Cake fruit de la passion', '[Méta] Rendement: 10 pièces | Moule: Inox 22 x 4 cm [à confirmer] | Cuisson brownie: 170°C / 30 min
Composition : Biscuit brownie spécial / Mousse passion / Glaçage jaune / Variante glaçage rouge

Montage / finition :
1. Couler le brownie dans le moule.
2. Ajouter la mousse passion.
3. Surgeler.
4. Glacer en jaune ou rouge selon finition.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a292d6c0-bec8-5761-8924-cbdfd81040f3', 'bad8b5f0-b281-5a87-abed-3d22a8adfc62', 551) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a292d6c0-bec8-5761-8924-cbdfd81040f3', '994f071a-7b7a-53b5-ba1d-d54581cb7f5e', 309) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a292d6c0-bec8-5761-8924-cbdfd81040f3', '1b793476-3b88-553e-b9c6-ece16f1ff49c', 262) ON CONFLICT DO NOTHING;

-- ─── #21. Crémeux citron ───

-- ─── #22. Crémeux chocolat au lait ───

-- ─── #23. Entremets framboise / ivoire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('7d77617d-f7be-5584-a52c-6928ab68af26', 'Entremets framboise / ivoire', '23-entremets-framboise-ivoire', 12, 0, 0, true, 'PAT-023') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('58dc80b6-0517-574a-beef-72624abad546', '7d77617d-f7be-5584-a52c-6928ab68af26', 'Entremets framboise / ivoire', '[Méta] Cuisson biscuit: 170°C / 14 min
Composition : Biscuit moelleux nature / Confit framboise / Mousse ivoire / Glaçage blanc

Montage / finition :
1. Monter en cadre avec biscuit, confit et mousse ivoire.
2. Surgeler.
3. Glacer au glaçage blanc.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('58dc80b6-0517-574a-beef-72624abad546', 'f03713c8-dfb8-4685-8bfa-c7d4cfaf6178', 1.0) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('58dc80b6-0517-574a-beef-72624abad546', 'b03c5671-9eb2-4f94-a3c8-dd9f583512d5', 1.0) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('58dc80b6-0517-574a-beef-72624abad546', '14be466d-40ba-5642-96d6-552771959bb6', 1.585) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('58dc80b6-0517-574a-beef-72624abad546', 'c4d4df58-48db-5a11-bcf3-ff444fcd3069', 1.341) ON CONFLICT DO NOTHING;

-- ─── #24. Cheesecake framboise ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('a700b223-a441-59ff-94fc-6a36839a85e6', 'Cheesecake framboise', '24-cheesecake-framboise', 11, 0, 0, true, 'PAT-024') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a2952164-7e9b-5544-a80a-5e78bf915bea', 'a700b223-a441-59ff-94fc-6a36839a85e6', 'Cheesecake framboise', '[Méta] Rendement: 1 entremets, environ 10 personnes
Composition : Base spéculoos / Mousse cheesecake / Confit framboise / Glaçage rouge / Décor chocolat

Montage / finition :
1. Déposer la base spéculoos au fond du cadre.
2. Ajouter le confit framboise.
3. Couler la mousse cheesecake.
4. Surgeler.
5. Glacer rouge et décorer.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a2952164-7e9b-5544-a80a-5e78bf915bea', 'b03c5671-9eb2-4f94-a3c8-dd9f583512d5', 1.0) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('a2952164-7e9b-5544-a80a-5e78bf915bea', 'c8cdd202-e398-5163-b9b2-3ae08d99d482', 250) ON CONFLICT DO NOTHING;

-- ─── #25. Forêt Noire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('6b2ed728-bd3c-5627-b1fd-e62f7c31089a', 'Forêt Noire', '25-foret-noire', 12, 0, 0, true, 'PAT-025') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('15fd3fb3-2528-5389-ac90-6a3aa176bc1a', '6b2ed728-bd3c-5627-b1fd-e62f7c31089a', 'Forêt Noire', 'Composition : Biscuit génoise chocolat / Mousse chocolat noir / Bavaroise vanille / Cerises amarena / Sirop 30° / Décor chocolat

Montage / finition :
1. Imbiber le biscuit chocolat avec le sirop.
2. Alterner mousse chocolat, bavaroise vanille et cerises.
3. Surgeler ou réserver selon format.
4. Finir avec décor chocolat noir.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('15fd3fb3-2528-5389-ac90-6a3aa176bc1a', '01b3d463-860c-510a-b104-9bb39602de1d', 812) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('15fd3fb3-2528-5389-ac90-6a3aa176bc1a', '01838a41-1523-50b1-b067-1a0d8e647287', 1.267) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('15fd3fb3-2528-5389-ac90-6a3aa176bc1a', '433152d7-364e-596d-8ede-d0ff1c2000c7', 1.081) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('15fd3fb3-2528-5389-ac90-6a3aa176bc1a', '8ce0ab29-4c52-5a6f-95af-ee685a4839da', 533) ON CONFLICT DO NOTHING;

-- ─── #26. Opéra noisette ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('4e79e3bd-1347-535a-9d72-fbf7ccf8c4db', 'Opéra noisette', '26-opera-noisette', 12, 0, 0, true, 'PAT-026') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('4f8a9f2d-1daa-5f35-91a5-c397908d2d8d', '4e79e3bd-1347-535a-9d72-fbf7ccf8c4db', 'Opéra noisette', 'Composition : Biscuit Joconde / Crème au beurre noisette / Crémeux caramel / Ganache chocolat noir / Sirop 30°

Montage / finition :
1. Biscuit Joconde imbibé.
2. Crème au beurre noisette.
3. Biscuit Joconde.
4. Crémeux caramel.
5. Crème au beurre noisette.
6. Biscuit Joconde.
7. Ganache chocolat noir.
8. Finition.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('4f8a9f2d-1daa-5f35-91a5-c397908d2d8d', 'a17605a3-ccf3-5962-88ab-5bd2d158fc12', 1.726) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('4f8a9f2d-1daa-5f35-91a5-c397908d2d8d', '433321cd-5cf9-5c44-aac5-b564af961045', 1.583) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('4f8a9f2d-1daa-5f35-91a5-c397908d2d8d', '92716ed5-29fe-5c1b-a757-fdd6644d51c9', 2.11) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('4f8a9f2d-1daa-5f35-91a5-c397908d2d8d', 'fd22e915-60d2-52d9-bceb-ade9009d1ba1', 5.5) ON CONFLICT DO NOTHING;

-- ─── #27. Trompe-l’œil mangue ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('ee0dbd29-5434-52e6-953a-b1498e8b9155', 'Trompe-l’œil mangue', '27-trompe-lil-mangue', 12, 0, 0, true, 'PAT-027') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('7378f74c-6552-5b24-8279-f7fe5d83ebe5', 'ee0dbd29-5434-52e6-953a-b1498e8b9155', 'Trompe-l’œil mangue', 'Composition : Biscuit génoise nature / Insert mangue / Mousse mangue / Pistolet orange ou vert

Montage / finition :
1. Couler la mousse mangue.
2. Insérer l’insert mangue.
3. Fermer avec biscuit.
4. Surgeler puis pulvériser.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('7378f74c-6552-5b24-8279-f7fe5d83ebe5', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('7378f74c-6552-5b24-8279-f7fe5d83ebe5', 'a0000010-0010-4000-a000-000000000010', 360.9) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('7378f74c-6552-5b24-8279-f7fe5d83ebe5', 'a0000011-0011-4000-a000-000000000011', 149.9) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('7378f74c-6552-5b24-8279-f7fe5d83ebe5', 'e2188838-89eb-521e-9b05-a5d0b3239a90', 700) ON CONFLICT DO NOTHING;

-- ─── #28. Brownie carré ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('2399b95a-2039-54b0-9879-99f7aee9ccc6', 'Brownie carré', '28-brownie-carre', 11, 0, 0, true, 'PAT-028') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('bd7e411d-e19b-516f-9acb-a1a5b6ba1995', '2399b95a-2039-54b0-9879-99f7aee9ccc6', 'Brownie carré', '[Méta] Cuisson: 170°C / 40 min', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('bd7e411d-e19b-516f-9acb-a1a5b6ba1995', 'f0d4010e-4dd3-51d3-b894-2d898657a630', 998) ON CONFLICT DO NOTHING;

-- ─── #29. Cake pistache ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('e69f5d45-5e99-5b9a-9a20-ea79051c97f2', 'Cake pistache', '29-cake-pistache', 11, 0, 0, true, 'PAT-029') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('b5b9e2ca-01fd-5791-8eb5-a708a071e064', 'e69f5d45-5e99-5b9a-9a20-ea79051c97f2', 'Cake pistache', 'Composition : Génoise verte / Bavaroise pistache / Crémeux chocolat blanc / Sirop 30° / Glaçage vert

Montage / finition :
1. Biscuit vert imbibé.
2. Bavaroise pistache.
3. Biscuit vert.
4. Crémeux chocolat blanc.
5. Biscuit vert.
6. Bavaroise pistache.
7. Glaçage vert.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('b5b9e2ca-01fd-5791-8eb5-a708a071e064', 'bfb656f1-40e7-5522-a99a-db8776c850d9', 665) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('b5b9e2ca-01fd-5791-8eb5-a708a071e064', '43027e07-ef43-5c93-a019-b222948a9467', 1.657) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('b5b9e2ca-01fd-5791-8eb5-a708a071e064', '8ce0ab29-4c52-5a6f-95af-ee685a4839da', 533) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('b5b9e2ca-01fd-5791-8eb5-a708a071e064', 'a6ad08d9-3664-5556-b20e-25dcdb7a8af2', 2.197) ON CONFLICT DO NOTHING;

-- ─── #30. Amandine ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('4199beb9-5425-52ef-b18a-26fda04a5f69', 'Amandine', '30-amandine', 11, 0, 0, true, 'PAT-030') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '4199beb9-5425-52ef-b18a-26fda04a5f69', 'Amandine', '[Méta] Rendement: Environ 40 unités | Format: 7 x 7 cm
Composition : Biscuit génoise nature / Crème pâtissière / Mousse praliné amande / Amandes caramélisées / Sirop / Pâte d’amande

Montage / finition :
1. Biscuit génoise imbibé.
2. Mousse praliné amande.
3. Deuxième biscuit imbibé.
4. Mousse praliné.
5. Pâte d’amande en finition.
6. Détailler en carrés 7 x 7 cm.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', 'a0000012-0012-4000-a000-000000000012', 84.6) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '1034b895-1330-42c3-be78-9370f128d751', 22.0) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '4623d916-e43a-5bcc-b8a9-48d576bc4928', 1.11) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '7bd5dc64-333e-5d6c-80ef-d316c0e55649', 340) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '3f9a90c1-76ce-5953-99cd-87596043ea6b', 1.0) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('e20d655a-df39-553a-9184-5bf8bff8197e', '8538539d-d055-57a1-bb6b-f7532e8250ed', 800) ON CONFLICT DO NOTHING;

-- ─── #31. Cheesecake framboise - finition laboratoire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('32dbd1e7-9066-5890-8e79-711697f731cc', 'Cheesecake framboise - finition laboratoire', '31-cheesecake-framboise-finition-laboratoire', 11, 0, 0, true, 'PAT-031') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('02fc19c4-ae88-5740-a832-774544af274b', '32dbd1e7-9066-5890-8e79-711697f731cc', 'Cheesecake framboise - finition laboratoire', '[Méta] Type: Fiche de montage complémentaire
Composition : Spéculoos / Mousse cheesecake / Confit framboise / Nappage / Décors chocolat

Montage / finition :
1. Base spéculoos.
2. Confit framboise.
3. Mousse cheesecake.
4. Surgélation.
5. Nappage/glaçage rouge et finition chocolat.', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('02fc19c4-ae88-5740-a832-774544af274b', '43b1e9a1-d1ff-58e4-9469-d2444364b29a', 169) ON CONFLICT DO NOTHING;

-- ─── #32. Brioche carrée / brownie carré - base complémentaire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('917ff36f-a845-58cc-847c-32e5e8de0268', 'Brioche carrée / brownie carré - base complémentaire', '32-brioche-carree-brownie-carre-base-complementaire', 11, 0, 0, true, 'PAT-032') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('6f83f77f-c03d-5f0a-9780-8682ee9641a0', '917ff36f-a845-58cc-847c-32e5e8de0268', 'Brioche carrée / brownie carré - base complémentaire', '[Méta] Cuisson: 170°C / 40 min', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('6f83f77f-c03d-5f0a-9780-8682ee9641a0', '4a773f02-8ab3-5148-abb5-d6e6c8f675b7', 998) ON CONFLICT DO NOTHING;

-- ─── #33. Cake citron ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('0942e73b-dc26-5bc6-9114-fd1464078116', 'Cake citron', '33-cake-citron', 11, 0, 0, true, 'PAT-033') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('eeb43b0e-0bec-53a2-97c5-b80fb05ec3ce', '0942e73b-dc26-5bc6-9114-fd1464078116', 'Cake citron', 'Composition : Génoise jaune / Mousse citron / Crémeux chocolat blanc / Sirop 30° / Glaçage jaune / Génoise jaune', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #34. Opéra café ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('a16e995a-fbe9-5240-a776-1c91130c0348', 'Opéra café', '34-opera-cafe', 11, 0, 0, true, 'PAT-034') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('10eabe90-1793-5620-bd62-6d89b9252b98', 'a16e995a-fbe9-5240-a776-1c91130c0348', 'Opéra café', 'Composition : Biscuit nature / Crème au beurre café / Sirop café / Ganache chocolat noir / Pistolet chocolat noir', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #35. Brownie carré - version 40 unités ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('0d36cf92-b98d-51c9-8529-f43d3594dc0b', 'Brownie carré - version 40 unités', '35-brownie-carre-version-40-unites', 12, 0, 0, true, 'PAT-035') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('4e49f6ad-f19b-5b51-951e-58b763cde0c0', '0d36cf92-b98d-51c9-8529-f43d3594dc0b', 'Brownie carré - version 40 unités', 'Composition : Brownie chocolat noix', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #36. Cheesecake Lotus ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('9740b182-6c32-562c-ab55-ca70296894cc', 'Cheesecake Lotus', '36-cheesecake-lotus', 12, 0, 0, true, 'PAT-036') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('752ab6da-dfb8-588d-9c26-045b764a985d', '9740b182-6c32-562c-ab55-ca70296894cc', 'Cheesecake Lotus', 'Composition : Biscuit spéculoos / Mousse cheesecake / Glaçage caramel / Finition biscuit Lotus', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #37. Forêt Noire cadre - 50 unités ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('fd2e9ec2-3ea5-5905-9fce-0e6313616f79', 'Forêt Noire cadre - 50 unités', '37-foret-noire-cadre-50-unites', 12, 0, 0, true, 'PAT-037') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('68917aa8-1e7f-5a63-b56d-e8741172c53d', 'fd2e9ec2-3ea5-5905-9fce-0e6313616f79', 'Forêt Noire cadre - 50 unités', 'Composition : Biscuit génoise chocolat / Mousse chocolat noir / Bavaroise vanille / Cerises amarena / Sirop 30° / Finition chocolat noir râpé / Biscuit génoise chocolat', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #38. Cadre praliné ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('4717cf3a-1003-5e5a-bbee-ea2d8660cfb7', 'Cadre praliné', '38-cadre-praline', 12, 0, 0, true, 'PAT-038') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a1cab92c-efdb-55e2-8cf5-e7e4b54d4a24', '4717cf3a-1003-5e5a-bbee-ea2d8660cfb7', 'Cadre praliné', 'Composition : Génoise chocolat noir / Mousse chocolat au lait / Crème praliné / Sirop 30° / Glaçage au lait / Génoise chocolat noir', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #39. Madeleines ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('fa9c86d1-22d6-53c5-be90-0350c2fda3e2', 'Madeleines', '39-madeleines', 11, 0, 0, true, 'PAT-039') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a7b0631f-b7a2-591e-bc36-bfa37b9bdba3', 'fa9c86d1-22d6-53c5-be90-0350c2fda3e2', 'Madeleines', 'Composition : Appareil à madeleines classique avec trimoline', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #40. Éclair passion ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('cfc1747b-54bb-56cb-9099-23fcf9119ed1', 'Éclair passion', '40-eclair-passion', 11, 0, 0, true, 'PAT-040') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('e53afb81-b51e-54fc-945a-f8f9f49d37c8', 'cfc1747b-54bb-56cb-9099-23fcf9119ed1', 'Éclair passion', 'Composition : Pâte à choux / Crémeux passion / Finition pâte d’amande colorée', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #41. Glaçage blanc pour cake blanc ───

-- ─── #42. Roulé / carré citron ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('c7e1647c-ed96-587c-aa48-7de4cf815322', 'Roulé / carré citron', '42-roule-carre-citron', 11, 0, 0, true, 'PAT-042') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('a5c78bce-b2a2-56b4-846a-ad03f5f9dafa', 'c7e1647c-ed96-587c-aa48-7de4cf815322', 'Roulé / carré citron', 'Composition : Génoise nature / Sirop 30° citronné / Crème citron / Crème pâtissière citronnée / Finition selon format', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #43. Glaçage noir ───

-- ─── #44. Mousse praliné / base praliné amande ───

-- ─── #45. Biscuit Casablanca spécial ───

-- ─── #46. Glaçage rouge ───

-- ─── #47. Carrot cake - 10 personnes ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('ba3add42-136f-5cd5-b69e-0dc224c502e0', 'Carrot cake - 10 personnes', '47-carrot-cake-10-personnes', 11, 0, 0, true, 'PAT-047') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('88666453-3ed0-5fc1-a0a6-3e1b5a359ecb', 'ba3add42-136f-5cd5-b69e-0dc224c502e0', 'Carrot cake - 10 personnes', 'Composition : Biscuit carrot cake / Crème au beurre / Crème pâtissière/fromage', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #48. Entremets framboise chocolat blanc - cadre ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('24ea94e4-e1c1-5bdb-81c2-929c5779945c', 'Entremets framboise chocolat blanc - cadre', '48-entremets-framboise-chocolat-blanc-cadre', 12, 0, 0, true, 'PAT-048') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('d504cf33-a173-5c01-8b0c-9d30b6f28025', '24ea94e4-e1c1-5bdb-81c2-929c5779945c', 'Entremets framboise chocolat blanc - cadre', 'Composition : Biscuit moelleux nature / Confit framboise / Mousse chocolat blanc / Glaçage blanc / Biscuit moelleux nature', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #49. Crème amande et glaçage lait - bases complémentaires ───

-- ─── #50. Cadre praliné - version ajustée ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('52ce9247-d73b-58af-af71-4cccb2229c4d', 'Cadre praliné - version ajustée', '50-cadre-praline-version-ajustee', 12, 0, 0, true, 'PAT-050') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('747ac7bd-f0e6-594a-a4d1-29624b54791c', '52ce9247-d73b-58af-af71-4cccb2229c4d', 'Cadre praliné - version ajustée', 'Composition : Génoise chocolat noir / Mousse chocolat au lait / Crémeux praliné / Sirop 30° / Glaçage au lait / Génoise chocolat noir', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #51. Trompe-l’œil citron - version complémentaire ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('6830ff86-ad02-5589-8b57-533d3205f718', 'Trompe-l’œil citron - version complémentaire', '51-trompe-lil-citron-version-complementaire', 12, 0, 0, true, 'PAT-051') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('db286c95-f91e-5a7c-9511-1166ef1d8de6', '6830ff86-ad02-5589-8b57-533d3205f718', 'Trompe-l’œil citron - version complémentaire', 'Composition : Mousse citron / Crémeux citron / Mélange pistolet jaune / Biscuit génoise', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #52. Red velvet cake - 10 personnes ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('4ac2c236-011d-5bd4-8017-3436c9e7c1e2', 'Red velvet cake - 10 personnes', '52-red-velvet-cake-10-personnes', 11, 0, 0, true, 'PAT-052') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('b55571f8-1850-5890-8a56-81ebea5ab618', '4ac2c236-011d-5bd4-8017-3436c9e7c1e2', 'Red velvet cake - 10 personnes', 'Composition : Biscuit red velvet / Crème cheese mascarpone / Finition biscuit red velvet punché / Biscuit red velvet', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #53. Tigré chocolat / financier vermicelle ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('a5b013e6-c961-53e1-b198-8145d1adc32a', 'Tigré chocolat / financier vermicelle', '53-tigre-chocolat-financier-vermicelle', 11, 0, 0, true, 'PAT-053') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('fb7676a5-3737-515b-a7c8-d5eb6b106b14', 'a5b013e6-c961-53e1-b198-8145d1adc32a', 'Tigré chocolat / financier vermicelle', 'Composition : Base type financier / Chocolat vermicelle', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #54. Bûchette praliné chocolat spécial ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('32bf57c4-ecda-5860-b645-ba5763cd3a1a', 'Bûchette praliné chocolat spécial', '54-buchette-praline-chocolat-special', 12, 0, 0, true, 'PAT-054') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('680f817a-b367-5b39-bb97-352214839f55', '32bf57c4-ecda-5860-b645-ba5763cd3a1a', 'Bûchette praliné chocolat spécial', 'Composition : Génoise chocolat / Mousse chocolat / Crème praliné amande / Sirop 30° / Glaçage noir / pistolet noir / Génoise chocolat', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #55. Cappuccino - cadre 4 cm ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('06b82d30-9f49-5b64-81f4-bb14b421de32', 'Cappuccino - cadre 4 cm', '55-cappuccino-cadre-4-cm', 12, 0, 0, true, 'PAT-055') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('9c7a8c8c-20d6-57a3-8b5b-b24a0b5a41b8', '06b82d30-9f49-5b64-81f4-bb14b421de32', 'Cappuccino - cadre 4 cm', 'Composition : Génoise nature / Mousse café / Ganache chocolat noir / Sirop café / Glaçage noir / Génoise nature', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #56. Cheesecake caramel beurre salé ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('002473a1-e53d-54dc-a1cf-29c50a0425bd', 'Cheesecake caramel beurre salé', '56-cheesecake-caramel-beurre-sale', 11, 0, 0, true, 'PAT-056') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('e336a18f-e575-518d-a005-4e9c559c1b8e', '002473a1-e53d-54dc-a1cf-29c50a0425bd', 'Cheesecake caramel beurre salé', 'Composition : Base spéculoos / Caramel beurre salé / Mousse cheesecake / Glaçage blanc caramel / Caramel beurre salé', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #57. Cheesecake framboise - complément ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('0f4a9103-689e-5d92-9155-d61bb95d9eef', 'Cheesecake framboise - complément', '57-cheesecake-framboise-complement', 11, 0, 0, true, 'PAT-057') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('2a12aa26-d359-52c4-95f7-a02c82178c79', '0f4a9103-689e-5d92-9155-d61bb95d9eef', 'Cheesecake framboise - complément', 'Composition : Spéculoos / Confit framboise / Mousse cheesecake', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #58. Cheesecake citron ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('d345d2f0-ae92-5d72-8f66-ca8a589d41a4', 'Cheesecake citron', '58-cheesecake-citron', 11, 0, 0, true, 'PAT-058') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('525446cb-c4ee-5c1a-a81f-efd9dfe58f51', 'd345d2f0-ae92-5d72-8f66-ca8a589d41a4', 'Cheesecake citron', 'Composition : Spéculoos / Mousse cheesecake / Crémeux citron / Finition citron / Base spéculoos', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #59. Cadre Choco Framboise spécial - fiche de lancement AtelierCroc ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('703c8d84-e1eb-56f2-b502-55703916ff38', 'Cadre Choco Framboise spécial - fiche de lancement AtelierCroc', '59-cadre-choco-framboise-special-fiche-de-lancement-ateliercroc', 12, 0, 0, true, 'PAT-059') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('fe2cfbd1-ce57-5b3f-b830-5b3386ec8820', '703c8d84-e1eb-56f2-b502-55703916ff38', 'Cadre Choco Framboise spécial - fiche de lancement AtelierCroc', 'Composition : Génoise nature / Sirop framboise / Confit framboise / Mousse framboise / Chantilly finition', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;

-- ─── #60. Trompe-l’œil mangue - version dacquoise / exotique ───
INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku) VALUES ('50a1a650-a8e3-5d89-a728-68e6f5018ff1', 'Trompe-l’œil mangue - version dacquoise / exotique', '60-trompe-lil-mangue-version-dacquoise-exotique', 12, 0, 0, true, 'PAT-060') ON CONFLICT (id) DO NOTHING;
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, margin_multiplier) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '50a1a650-a8e3-5d89-a728-68e6f5018ff1', 'Trompe-l’œil mangue - version dacquoise / exotique', 'Composition : Biscuit dacquoise amande / Mousse chocolat au lait / Mousse exotique / Ganache montée citron vert / Biscuit dacquoise amande', 1, 'unit', false, 3) ON CONFLICT (id) DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '25b37bb6-2156-567f-9f48-102f6a05fc80', 1.167) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '9c93aa3a-6437-5c2e-a587-2fa3437e3ad4', 694) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '2c744e5a-608a-5581-95d6-ba366c3f7b02', 600) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '313a005b-1a82-5887-9077-714d53ec5cd3', 1.33) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', 'f38a8d96-3c39-55b3-9ed6-63c5e41f0acc', 1.846) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', 'cffcbd13-c97a-56c7-91d4-0073b9469c90', 2.429) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '9e2bc328-1b75-538a-9a73-1bc02a1b5ea5', 3.341) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '05943ab6-30fa-56af-a7fc-8b2a1cf026cc', 887) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', 'c123b103-e917-5e0a-a212-27367a027ddd', 1.026) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '336f53c0-fecd-5c50-aed8-bca8725a90a4', 647) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', 'd86dd9da-a9bf-5c57-a3fc-9d2ac2699e9b', 1.1) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', 'e37298f7-c28b-52d6-99d4-97381e0f6e52', 763) ON CONFLICT DO NOTHING;
INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ('23d2431f-45ad-5ec9-937a-d424b66e0928', '25f67ea0-869f-590c-bc53-f8bc3dcd098e', 662) ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. SYNC PRODUCT COST_PRICE AND PRICE FROM RECIPE TOTAL_COST
-- ============================================================
UPDATE products p
SET cost_price = vtc.total_cost,
    price = vtc.total_cost * r.margin_multiplier,
    updated_at = NOW()
FROM recipes r
JOIN v_recipe_total_cost vtc ON vtc.id = r.id
WHERE r.product_id = p.id
  AND p.sku LIKE 'PAT-%'
  AND vtc.total_cost > 0;

COMMIT;