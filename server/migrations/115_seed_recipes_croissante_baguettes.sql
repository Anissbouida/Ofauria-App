-- Migration 115: Seed 3 recipes from calibration sheets
-- 1. Pâte croissante (base recipe, viennoiserie)
-- 2. Baguette semoule (product, boulangerie)
-- 3. Baguette complète (product, boulangerie)

BEGIN;

-- Idempotence : si la migration a deja partiellement tourne (ou si les donnees
-- ont ete inserees autrement), on nettoie d'abord les liens recipe_ingredients
-- pour les 3 recettes seed. Recipes et products sont conserves (ON CONFLICT
-- ci-dessous) car peuvent etre referencees par d'autres tables.
DELETE FROM recipe_ingredients WHERE recipe_id IN (
  'a0000001-0001-4000-a000-000000000001',
  'a0000002-0002-4000-a000-000000000002',
  'a0000003-0003-4000-a000-000000000003'
);

-- ─── 0. Create "Eau" ingredient (used in all 3 recipes) ───
INSERT INTO ingredients (id, name, unit, unit_cost, supplier)
VALUES ('00000000-0000-4000-a000-000000000001', 'Eau', 'l', 0, NULL)
ON CONFLICT DO NOTHING;

-- ─── 1. PÂTE CROISSANTE — recette de base (is_base = true) ───

-- No product for a base recipe (pâte de base reused in croissants, pains au chocolat, etc.)
INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, contenant_id, etapes)
VALUES (
  'a0000001-0001-4000-a000-000000000001',
  NULL,
  'Pâte croissante',
  'Détrempe + beurre de tour — base mini-croissants & croissants. Code: VIE-CROI-PAT. Pâte totale théorique 2167 g (détrempe 1667 + beurre tour 500). Rendement: 48 mini (45g cru) OU 27 grands (80g cru).',
  2167,
  'g',
  true,
  NULL,
  '[
    {"ordre":1, "nom":"Pétrissage détrempe (1ère vitesse) — farine, sucre, sel, lait, eau, beurre, améliorant", "duree_estimee_min":4, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Mélange homogène, début de réseau"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":2, "nom":"Ajout levure émiettée + pétrissage 2ème vitesse", "duree_estimee_min":6, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Pâte lisse et homogène","TPP cible 23°C ±1"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":3, "nom":"Repos détrempe au frigo 4°C", "duree_estimee_min":30, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâte raffermie, prête au tourage"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":4, "nom":"Tourage — étaler détrempe, enfermer beurre de tour (12-14°C) en portefeuille", "duree_estimee_min":10, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Beurre régulier, pas de percement"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":5, "nom":"3 tours simples avec repos 30 min frigo entre chaque", "duree_estimee_min":90, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Feuilletage régulier","Beurre intact"], "est_repetable":true, "nb_repetitions":3, "responsable_role":"boulanger"},
    {"ordre":6, "nom":"Laminage final 3,5mm + détaillage triangles (mini 9×22cm ≈45g / grand 12×28cm ≈80g)", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Épaisseur 3,5mm ±0,2","Pesée: 45±2g (mini) / 80±3g (grand)"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":7, "nom":"Façonnage — rouler triangles base vers pointe, dépose pointe dessous", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Forme régulière, pointe sous le croissant"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":8, "nom":"1ère dorure à l''œuf battu (couche fine)", "duree_estimee_min":5, "est_bloquante":false, "timer_auto":false, "controle_qualite":false, "checklist_items":["Couche fine, pas de coulures"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":9, "nom":"Fermentation finale (apprêt) — 26°C / 75% HR", "duree_estimee_min":105, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Volume ×2","Croissants gonflés et tendres"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":10, "nom":"2ème dorure + cuisson 180°C ventilé 16-18 min", "duree_estimee_min":18, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Coloration dorée uniforme","Feuilletage visible","Croustillant"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Pâte croissante — ingrédients (détrempe)
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES
  ('a0000001-0001-4000-a000-000000000001', '753e0408-360f-4aae-b8b0-024c3f984d17', 1.0000, 'kg'),    -- Farine viennoiserie 1000g
  ('a0000001-0001-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 0.4000, 'l'),      -- Eau 400g
  ('a0000001-0001-4000-a000-000000000001', '854839eb-30e8-4b42-8b30-dd0b6a0b46c0', 0.1000, 'l'),     -- Lait entier 100g
  ('a0000001-0001-4000-a000-000000000001', '942672ed-6b5b-4165-9e68-3706c98b163b', 0.1200, 'kg'),    -- Sucre semoule 120g
  ('a0000001-0001-4000-a000-000000000001', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 0.0200, 'kg'),    -- Sel fin 20g
  ('a0000001-0001-4000-a000-000000000001', '2ebe4638-ed83-45e0-a6cc-0e903bf91254', 0.6000, 'kg'),    -- Beurre (100g détrempe + 500g tour)
  ('a0000001-0001-4000-a000-000000000001', '2c0dd68d-e926-468e-b972-7cca34790fee', 0.0220, 'kg'),    -- Levure fraîche 22g
  ('a0000001-0001-4000-a000-000000000001', '193a9569-09b1-4f0c-8714-0d02f18da516', 0.0050, 'kg'),    -- Améliorant Pain Perfect 5g
  ('a0000001-0001-4000-a000-000000000001', 'ab27e0de-004c-4711-a606-deb44108584a', 0.0500, 'kg');    -- Œufs entiers 50g (dorure)


-- ─── 2. BAGUETTE SEMOULE — produit fini ───

INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku)
VALUES (
  'b0000002-0002-4000-a000-000000000002',
  'Baguette semoule',
  'baguette-semoule',
  1,  -- BAGUETTE category
  0,  -- prix à définir
  0,
  true,
  'BOU-BAG-SEM'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, contenant_id, etapes)
VALUES (
  'a0000002-0002-4000-a000-000000000002',
  'b0000002-0002-4000-a000-000000000002',
  'Baguette semoule',
  'Pain blanc 50% farine T55 + 50% semoule fine — 200g cuit (standard marocain). Code: BOU-BAG-SEM. Pâte totale théorique 44610g. 180 unités/fournée. Pâton 241g cru → 200g cuit (perte ~17%).',
  180,
  'unit',
  false,
  NULL,
  '[
    {"ordre":1, "nom":"Frasage — farine T55, semoule, améliorant Ibis (vitesse 1)", "duree_estimee_min":4, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Mélange homogène des poudres"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":2, "nom":"Incorporation eau froide (8-12°C) + pétrissage 2ème vitesse", "duree_estimee_min":8, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Pâte lisse, élastique","TPP cible 24°C ±1"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":3, "nom":"Ajout sel + levure émiettée, pétrir brièvement (vitesse 1)", "duree_estimee_min":2, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Sel et levure bien répartis"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":4, "nom":"Pointage en masse — bac filmé, T° ambiante 22-24°C", "duree_estimee_min":30, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâte légèrement gonflée, début de structure"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":5, "nom":"Division en pâtons de 241g ±4g", "duree_estimee_min":20, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Pesée échantillon: 241 ±4g"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":6, "nom":"Détente pâtons à couvert — 15-20 min", "duree_estimee_min":20, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâtons détendus, façonnables"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":7, "nom":"Façonnage baguettes via façonneuse", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Forme régulière, longueur uniforme"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":8, "nom":"Apprêt — armoire fermentation 26°C / 75% HR", "duree_estimee_min":60, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Baguettes gonflées","Marque du doigt remonte lentement"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":9, "nom":"Préchauffage four 270°C", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Sole et voûte à température"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":10, "nom":"Scarification — 5 coups de lame en biais", "duree_estimee_min":10, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Coups nets, ouverture maîtrisée"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":11, "nom":"Enfournement avec buée + baisser à 240°C", "duree_estimee_min":2, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Buée bien diffusée, baguettes en place"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":12, "nom":"Cuisson 240°C — 18 min", "duree_estimee_min":18, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Croûte dorée uniforme","T° mie ≥ 95°C","Son mat à la pichenette"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Baguette semoule — ingrédients
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES
  ('a0000002-0002-4000-a000-000000000002', '2a44fd1a-1787-49cb-a492-c776cb200a50', 13.0000, 'kg'),   -- Farine Fleur (T55) 13kg — Note: using Farine Fleur as T55
  ('a0000002-0002-4000-a000-000000000002', 'a037ae45-60c2-41bd-a69e-44e3a7bc4098', 13.0000, 'kg'),   -- Semoule fine 13kg
  ('a0000002-0002-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 17.7000, 'l'),     -- Eau 17,7L
  ('a0000002-0002-4000-a000-000000000002', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 0.5200, 'kg'),    -- Sel fin 520g
  ('a0000002-0002-4000-a000-000000000002', '2c0dd68d-e926-468e-b972-7cca34790fee', 0.2600, 'kg'),    -- Levure fraîche 260g
  ('a0000002-0002-4000-a000-000000000002', '26f4621e-2285-426f-9569-bbbad19ff440', 0.1300, 'kg');    -- Ibis 130g


-- ─── 3. BAGUETTE COMPLÈTE — produit fini ───

INSERT INTO products (id, name, slug, category_id, price, cost_price, is_available, sku)
VALUES (
  'b0000003-0003-4000-a000-000000000003',
  'Baguette complète',
  'baguette-complete',
  1,  -- BAGUETTE category
  0,  -- prix à définir
  0,
  true,
  'BOU-BAG-CPL'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipes (id, product_id, name, instructions, yield_quantity, yield_unit, is_base, contenant_id, etapes)
VALUES (
  'a0000003-0003-4000-a000-000000000003',
  'b0000003-0003-4000-a000-000000000003',
  'Baguette complète',
  'Pain semi-complet 50% farine Soissons + 50% farine complète — 200g cuit (standard marocain). Code: BOU-BAG-CPL. Pâte totale théorique 45240g. 180 unités/fournée. Pâton 241g cru → 200g cuit (perte ~17%). Autolyse 30 min obligatoire.',
  180,
  'unit',
  false,
  NULL,
  '[
    {"ordre":1, "nom":"Frasage — farine Soissons, farine complète, améliorant Ibis (vitesse 1)", "duree_estimee_min":4, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Mélange homogène des poudres"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":2, "nom":"Hydratation initiale — eau froide (8-12°C), vitesse 1", "duree_estimee_min":3, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Pâte grossière, hydratée mais non développée"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":3, "nom":"Autolyse — repos cuve couverte, T° ambiante", "duree_estimee_min":30, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâte assouplie, plus extensible"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":4, "nom":"Pétrissage final 2ème vitesse", "duree_estimee_min":6, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Réseau glutineux développé","TPP cible 24°C ±1"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":5, "nom":"Ajout sel + levure émiettée, pétrir brièvement (vitesse 1)", "duree_estimee_min":2, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Sel et levure bien répartis"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":6, "nom":"Pointage en masse — bac filmé, T° ambiante 22-24°C", "duree_estimee_min":45, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâte gonflée, structure développée"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":7, "nom":"Division en pâtons de 241g ±4g", "duree_estimee_min":20, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Pesée échantillon: 241 ±4g"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":8, "nom":"Détente pâtons à couvert — 20 min", "duree_estimee_min":20, "est_bloquante":true, "timer_auto":true, "controle_qualite":false, "checklist_items":["Pâtons détendus, façonnables sans déchirer"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":9, "nom":"Façonnage baguettes via façonneuse", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Forme régulière, longueur uniforme"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":10, "nom":"Apprêt — armoire fermentation 26°C / 75% HR", "duree_estimee_min":60, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Baguettes gonflées","Marque du doigt remonte lentement"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":11, "nom":"Préchauffage four 270°C", "duree_estimee_min":15, "est_bloquante":true, "timer_auto":false, "controle_qualite":false, "checklist_items":["Sole et voûte à température"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":12, "nom":"Scarification — 5 coups de lame en biais", "duree_estimee_min":10, "est_bloquante":true, "timer_auto":false, "controle_qualite":true, "checklist_items":["Coups nets, ouverture maîtrisée"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"},
    {"ordre":13, "nom":"Enfournement avec buée + cuisson 270→240°C — 22 min", "duree_estimee_min":22, "est_bloquante":true, "timer_auto":true, "controle_qualite":true, "checklist_items":["Croûte dorée foncée","T° mie ≥ 96°C","Son mat à la pichenette"], "est_repetable":false, "nb_repetitions":1, "responsable_role":"boulanger"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Baguette complète — ingrédients
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES
  ('a0000003-0003-4000-a000-000000000003', '1d1b9603-f6ed-4618-846b-702e0e5b6c2d', 13.0000, 'kg'),   -- Farine Soisson 13kg
  ('a0000003-0003-4000-a000-000000000003', 'a9909ea6-0cbc-43ac-b408-78eaca81a008', 13.0000, 'kg'),   -- Farine Complète 13kg
  ('a0000003-0003-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 18.2000, 'l'),     -- Eau 18,2L
  ('a0000003-0003-4000-a000-000000000003', '1c82cf60-3233-4b44-965c-47d1a6ebfa53', 0.5200, 'kg'),    -- Sel fin 520g
  ('a0000003-0003-4000-a000-000000000003', '2c0dd68d-e926-468e-b972-7cca34790fee', 0.3900, 'kg'),    -- Levure fraîche 390g
  ('a0000003-0003-4000-a000-000000000003', '26f4621e-2285-426f-9569-bbbad19ff440', 0.1300, 'kg');    -- Ibis 130g

COMMIT;
