-- Migration 303 : Forêt Noire (SKU 10065) — intégration de la fiche technique
--
-- POURQUOI
--   Fiche technique Forêt Noire éditée le 08/10/2026 (cadre 40 × 30 × 4,5 cm
--   → 24 parts de 9,5 × 4,5 cm, 130 g la part), bilingue FR/darija. Le produit
--   « FORÊT NOIRE » existe au catalogue mais n'a aucune fiche : ni coût, ni
--   besoins de production, ni étapes.
--
--   Conventions reprises des migs 291-295 :
--     - étapes de FABRICATION d'une base → sur la base (génoise, chantilly,
--       sirop) ; étapes d'ASSEMBLAGE → sur le produit (découpe du biscuit,
--       montage, parage/découpe, décor) ;
--     - darija dans des champs SÉPARÉS du JSONB : `nom_ar` + `checklist_items_ar`
--       (même nombre d'items que `checklist_items`) ;
--     - yield_quantity = pesée CRUE, perte_standard_pct = perte de
--       transformation, quantités des composants = poids NET mis en œuvre.
--
--   Résolution par NOM (pas seulement par UUID) : si la fiche a déjà été saisie
--   à la main sur un environnement (recette active du même nom, ou recette déjà
--   liée au produit), on la réécrit au lieu de créer un doublon.
--
--   Poids/pièce : la fiche affiche 130 g (nomenclature 2 750 g / 24 = 115 g ;
--   l'écart correspond aux rosaces/cerises de décor hors nomenclature et à
--   l'arrondi commercial). On garde la valeur de la fiche.
--
--   PV/pièce 18,00 DH : coût 5,05 × multiplicateur 3 = 15,15 → la fiche porte
--   donc un prix de vente forcé sur le format (prix_vente_unitaire_override).
--   Le prix du produit FORÊT NOIRE (entremets entier) n'est pas touché.
--
-- PORTÉE
--   + 2 ingrédients absents du référentiel : Mascarpone, Purée de griotte
--     (prix de la fiche, À VALIDER à la première facture)
--   + 1 contenant « Cadre 40x30x4,5 cm » (24 parts, damier)
--   + base Génoise cacao fab28000-…-115 désarchivée + réécrite (450/280/220/70)
--   + 2 bases créées : Crème chantilly mascarpone vanille, Sirop d'imbibage
--     griotte (sans alcool)
--   + recette produit Forêt Noire (compose, 24 pièces) liée au produit
--   + 1 format + 5 composants (3 sous-recettes + 2 ingrédients directs)
--   + miroir recipe_components
--   + étapes bilingues : 1 sur chaque base, 4 sur le produit + notes FR/darija
--   + SKU 10065 posé sur le produit s'il n'en a pas
--   Idempotent : résolution par nom/produit, DELETE ciblés avant INSERT.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ingrédients manquants + résolution des doublons.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO ingredients (name, unit, unit_cost, category)
SELECT v.name, v.unit, v.cost, v.cat
FROM (VALUES
  ('Mascarpone',       'kg', 70.00::numeric, 'produits_laitiers'), -- PRIX À VALIDER (fiche : 21 DH / 300 g)
  ('Purée de griotte', 'kg', 45.00,          'fruits')             -- PRIX À VALIDER (fiche : 4,50 DH / 100 g)
) AS v (name, unit, cost, cat)
WHERE NOT EXISTS (SELECT 1 FROM ingredients i WHERE lower(i.name) = lower(v.name));

-- Doublons (Sucre semoule ×2, etc.) : on préfère le kg le plus utilisé.
CREATE TEMP TABLE _fn303_ing ON COMMIT DROP AS
SELECT DISTINCT ON (i.name) i.name, i.id
FROM ingredients i
WHERE i.name IN (
  'Oeufs entiers liquides', 'Sucre semoule', 'Farine Fleur', 'Cacao en poudre 10/12',
  'Crème fraîche', 'Mascarpone', 'Sucre glace', 'Arôme vanille intense 1022',
  'Eau', 'Purée de griotte', 'Amarena au sirop lourd', 'Chocolat de couverture Noir 55%'
)
ORDER BY i.name,
         (i.unit = 'kg') DESC,
         (SELECT count(*) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id)
           + (SELECT count(*) FROM recipe_format_components c WHERE c.source_ingredient_id = i.id) DESC,
         i.created_at;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _fn303_ing;
  IF n <> 12 THEN
    RAISE EXCEPTION 'Forêt Noire 10065 : % ingrédient(s) résolus sur 12 attendus', n;
  END IF;
END $$;

-- Eau : référencée en litre → densité défensive pour le coût au gramme.
UPDATE ingredients SET densite_kg_l = 1.000
 WHERE id = (SELECT id FROM _fn303_ing WHERE name = 'Eau') AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Produit FORÊT NOIRE : SKU 10065 (si libre) + résolution.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fn303_prod ON COMMIT DROP AS
SELECT p.id
  FROM products p
 WHERE p.sku = '10065'
    OR (p.sku IS NULL AND upper(p.name) = 'FORÊT NOIRE')
 ORDER BY (p.sku = '10065') DESC NULLS LAST, p.created_at
 LIMIT 1;

UPDATE products
   SET sku = '10065', updated_at = NOW()
 WHERE id = (SELECT id FROM _fn303_prod)
   AND sku IS NULL
   AND NOT EXISTS (SELECT 1 FROM products WHERE sku = '10065');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Contenant Cadre 40x30x4,5 cm (24 parts en damier).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO production_contenants
  (nom, type_production, unite_lancement, quantite_theorique,
   longueur_cm, largeur_cm, profondeur_cm, type_decoupe, nb_pieces_decoupe, is_active)
SELECT 'Cadre 40x30x4,5 cm', 2, 'cadre', 24, 40, 30, 4.5, 'damier', 24, true
WHERE NOT EXISTS (
  SELECT 1 FROM production_contenants WHERE nom = 'Cadre 40x30x4,5 cm'
);

UPDATE production_contenants SET is_active = true, updated_at = NOW()
 WHERE nom = 'Cadre 40x30x4,5 cm' AND NOT is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Résolution des recettes : recette active du même nom (ou déjà liée au
--    produit) sinon UUID fixe du namespace f0ee7000.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fn303_rec (key text PRIMARY KEY, id uuid NOT NULL, nom text NOT NULL) ON COMMIT DROP;

INSERT INTO _fn303_rec (key, id, nom) VALUES
  ('produit',   COALESCE(
                  (SELECT r.id FROM recipes r WHERE r.product_id = (SELECT id FROM _fn303_prod) LIMIT 1),
                  (SELECT r.id FROM recipes r WHERE lower(r.name) = 'forêt noire' AND r.archived_at IS NULL
                     AND r.product_id IS NULL ORDER BY r.created_at LIMIT 1),
                  'f0ee7000-0000-4000-8000-000000000001'::uuid),
                'Forêt Noire'),
  ('genoise',   'fab28000-0000-4000-8000-000000000115'::uuid, 'Génoise cacao'),
  ('chantilly', COALESCE(
                  (SELECT r.id FROM recipes r WHERE lower(r.name) = 'crème chantilly mascarpone vanille'
                     AND r.archived_at IS NULL ORDER BY r.created_at LIMIT 1),
                  'f0ee7000-0000-4000-8000-000000000002'::uuid),
                'Crème chantilly mascarpone vanille'),
  ('sirop',     COALESCE(
                  (SELECT r.id FROM recipes r WHERE lower(r.name) = 'sirop d''imbibage griotte (sans alcool)'
                     AND r.archived_at IS NULL ORDER BY r.created_at LIMIT 1),
                  'f0ee7000-0000-4000-8000-000000000003'::uuid),
                'Sirop d''imbibage griotte (sans alcool)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bases : création / désarchivage / réécriture (formule de la fiche).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct, category_id)
SELECT x.id, x.nom, true, 'ratio_poids', v.yq, 'g', v.perte,
       (SELECT id FROM recipe_categories WHERE code = 'base_production')
  FROM (VALUES
    ('genoise',   1020::numeric, 11.7::numeric), -- 4 œufs/sucre/farine/cacao → 900 g net
    ('chantilly', 1205,           0.4),           -- 1 200 g net
    ('sirop',      400,           2.5)            -- 390 g net
  ) AS v (key, yq, perte)
  JOIN _fn303_rec x ON x.key = v.key
ON CONFLICT (id) DO NOTHING;

UPDATE recipes r
   SET archived_at = NULL, is_base = true, mode_cout = 'ratio_poids', yield_unit = 'g',
       name = x.nom, yield_quantity = v.yq, perte_standard_pct = v.perte,
       category_id = COALESCE(r.category_id, (SELECT id FROM recipe_categories WHERE code = 'base_production')),
       updated_at = NOW()
  FROM (VALUES
    ('genoise',   1020::numeric, 11.7::numeric),
    ('chantilly', 1205,           0.4),
    ('sirop',      400,           2.5)
  ) AS v (key, yq, perte)
  JOIN _fn303_rec x ON x.key = v.key
 WHERE r.id = x.id;

DELETE FROM recipe_ingredients
 WHERE recipe_id IN (SELECT id FROM _fn303_rec WHERE key IN ('genoise', 'chantilly', 'sirop'));

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT x.id, ing.id, v.qte, 'g'
FROM (VALUES
  -- Génoise cacao — 1 020 g cru (plaque 40 × 30), perte cuisson 11,7 % → 900 g
  ('genoise',   'Oeufs entiers liquides',          450::numeric),
  ('genoise',   'Sucre semoule',                   280),
  ('genoise',   'Farine Fleur',                    220),
  ('genoise',   'Cacao en poudre 10/12',            70),
  -- Crème chantilly mascarpone vanille — 1 205 g, perte 0,4 % → 1 200 g
  ('chantilly', 'Crème fraîche',                   800),   -- crème liquide 35 % MG, très froide
  ('chantilly', 'Mascarpone',                      300),
  ('chantilly', 'Sucre glace',                     100),
  ('chantilly', 'Arôme vanille intense 1022',        5),
  -- Sirop d'imbibage griotte (sans alcool) — 400 g, perte 2,5 % → 390 g
  ('sirop',     'Eau',                             200),
  ('sirop',     'Sucre semoule',                   100),
  ('sirop',     'Purée de griotte',                100)
) AS v (key, ingredient, qte)
JOIN _fn303_rec x  ON x.key = v.key
JOIN _fn303_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Recette produit Forêt Noire (composée : coût via la nomenclature).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct, category_id)
SELECT id, 'Forêt Noire', false, 'compose', 24, 'unit', 0,
       (SELECT id FROM recipe_categories WHERE code = 'patisserie')
  FROM _fn303_rec WHERE key = 'produit'
ON CONFLICT (id) DO NOTHING;

UPDATE recipes r
   SET archived_at = NULL, name = 'Forêt Noire', is_base = false, mode_cout = 'compose',
       yield_quantity = 24, yield_unit = 'unit', perte_standard_pct = 0,
       category_id = COALESCE(r.category_id, (SELECT id FROM recipe_categories WHERE code = 'patisserie')),
       updated_at = NOW()
 WHERE r.id = (SELECT id FROM _fn303_rec WHERE key = 'produit');

-- Lien produit (UNIQUE product_id) : seulement si le produit n'est pas déjà
-- porté par une autre recette.
UPDATE recipes r
   SET product_id = (SELECT id FROM _fn303_prod), updated_at = NOW()
 WHERE r.id = (SELECT id FROM _fn303_rec WHERE key = 'produit')
   AND r.product_id IS NULL
   AND EXISTS (SELECT 1 FROM _fn303_prod)
   AND NOT EXISTS (
     SELECT 1 FROM recipes o WHERE o.product_id = (SELECT id FROM _fn303_prod) AND o.id <> r.id
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Format Cadre 40x30x4,5 cm → 24 parts, 130 g/part, PV forcé 18 DH.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (id, recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre,
                            prix_vente_unitaire_override, is_active)
SELECT 'f0ee7000-0000-4000-8000-0000000000f4'::uuid, x.id, c.id, 130, 'g', 24, true, 1, 18.00, true
  FROM _fn303_rec x, production_contenants c
 WHERE x.key = 'produit'
   AND c.nom = 'Cadre 40x30x4,5 cm'
   AND NOT EXISTS (
     SELECT 1 FROM recipe_formats f
      WHERE f.recipe_id = x.id AND f.contenant_id = c.id
   );

-- Le format du cadre (créé ici ou préexistant) devient le format par défaut.
UPDATE recipe_formats f
   SET is_default = false, updated_at = NOW()
 WHERE f.recipe_id = (SELECT id FROM _fn303_rec WHERE key = 'produit')
   AND f.is_default
   AND f.contenant_id <> (SELECT id FROM production_contenants WHERE nom = 'Cadre 40x30x4,5 cm');

UPDATE recipe_formats f
   SET quantite_par_format = 130, quantite_par_format_unite = 'g',
       nb_par_defaut = 24, is_default = true, is_active = true,
       prix_vente_unitaire_override = 18.00, updated_at = NOW()
 WHERE f.recipe_id = (SELECT id FROM _fn303_rec WHERE key = 'produit')
   AND f.contenant_id = (SELECT id FROM production_contenants WHERE nom = 'Cadre 40x30x4,5 cm');

-- Le format vend le produit FORÊT NOIRE (si aucun autre format actif ne le porte).
UPDATE recipe_formats f
   SET product_id = (SELECT id FROM _fn303_prod), updated_at = NOW()
 WHERE f.recipe_id = (SELECT id FROM _fn303_rec WHERE key = 'produit')
   AND f.contenant_id = (SELECT id FROM production_contenants WHERE nom = 'Cadre 40x30x4,5 cm')
   AND f.product_id IS NULL
   AND EXISTS (SELECT 1 FROM _fn303_prod)
   AND NOT EXISTS (
     SELECT 1 FROM recipe_formats o
      WHERE o.product_id = (SELECT id FROM _fn303_prod) AND o.is_active AND o.id <> f.id
   );

CREATE TEMP TABLE _fn303_fmt ON COMMIT DROP AS
SELECT f.id
  FROM recipe_formats f
 WHERE f.recipe_id = (SELECT id FROM _fn303_rec WHERE key = 'produit')
   AND f.contenant_id = (SELECT id FROM production_contenants WHERE nom = 'Cadre 40x30x4,5 cm');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Nomenclature du format (consommation NETTE par cadre, fiche §Nomenclature).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components WHERE format_id = (SELECT id FROM _fn303_fmt);

-- 7a. Sous-recettes.
INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
SELECT (SELECT id FROM _fn303_fmt), v.role, x.id, v.qte, 'g', 0, v.ordre
  FROM (VALUES
    ('biscuit',   'genoise',    750::numeric, 1), -- 3 feuilles de 250 g
    ('imbibage',  'sirop',      300,          2), -- 3 × 100 g
    ('garniture', 'chantilly', 1100,          3)  -- 2 × 400 g + masquage 300 g
  ) AS v (role, key, qte, ordre)
  JOIN _fn303_rec x ON x.key = v.key;

-- 7b. Ingrédients directs : griottes égouttées et copeaux de chocolat noir 55 %
--     (les copeaux sont taillés sur la couverture 55 % du référentiel).
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, perte_pct, ordre)
SELECT (SELECT id FROM _fn303_fmt), v.role, ing.id, v.qte, 'g', 0, v.ordre
  FROM (VALUES
    ('garniture', 'Amarena au sirop lourd',          450::numeric, 4), -- 2 × 225 g égouttées
    ('decor',     'Chocolat de couverture Noir 55%', 150,          5)  -- copeaux
  ) AS v (role, ingredient, qte, ordre)
  JOIN _fn303_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Miroir recipe_components (le format par défaut) — lu par v_recipe_total_cost.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components WHERE recipe_id = (SELECT id FROM _fn303_rec WHERE key = 'produit');

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT (SELECT id FROM _fn303_rec WHERE key = 'produit'), c.role, c.source_recipe_id,
       c.source_ingredient_id, c.quantite, c.unite, c.perte_pct, c.ordre
  FROM recipe_format_components c
 WHERE c.format_id = (SELECT id FROM _fn303_fmt);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Étapes de FABRICATION sur les bases (bilingues FR + darija).
-- ─────────────────────────────────────────────────────────────────────────────

-- 9a. Génoise cacao.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Génoise cacao (plaque 40 × 30)","nom_ar":"الجينواز بالكاكاو (بلاطو 40 × 30)","duree_estimee_min":40,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Préchauffer le four à 180 °C, chemiser une plaque 40 × 30 de papier cuisson",
     "Monter œufs entiers + sucre au fouet : tiédir au bain-marie à 40 °C, puis vitesse max 10-12 min → ruban épais, volume triplé",
     "Tamiser farine + cacao ensemble, incorporer à la maryse en 2 fois, de bas en haut, sans faire retomber",
     "Couler 1 020 g sur la plaque, lisser à la palette, cuire 180 °C 18-22 min : ressort sous le doigt, bords décollés",
     "Démouler aussitôt sur grille, refroidir complètement avant découpe (perte cuisson ≈ 12 %)"],
   "checklist_items_ar":[
     "شعل الفران على 180 درجة، بطن بلاطو 40 × 30 بورق الطياب",
     "اضرب البيض الكامل مع السكر بالفوي : سخنو شوية فالبان ماري حتى 40 درجة، ومن بعد السرعة القصوى 10-12 دقيقة ← روبان غليظ، الحجم تضاعف 3 مرات",
     "غربل الفارينة والكاكاو مع بعض، دخلهم بالماريز على مرتين، من تحت لفوق، بلا ما تطيح الخليط",
     "صب 1 020 غرام فالبلاطو، سوي الوجه بالپاليط، طيب 180 درجة 18-22 دقيقة : كيرجع تحت الصبع، الجنابات مفكوكين",
     "خرجو دغيا على الشبكة، خليه يبرد نهائياً قبل التقطاع (نقص الطياب تقريبا 12%)"]}
]'::jsonb,
  instructions = 'Génoise cacao — 1 020 g cru pour une plaque 40 × 30, perte cuisson 11,7 % → 900 g net. Pour la Forêt Noire : 750 g = 3 feuilles de 250 g (0,83 fournée).
Conservation : 48 h à 4 °C filmée, 1 mois à −18 °C.
🇲🇦 الجينواز : 1 020 غرام خام للبلاطو 40 × 30 ← 900 غرام مطيبة. كتحفظ 48 ساعة فالفريكو مغلفة، شهر فالكونجيلاتور.',
  updated_at = NOW()
WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'genoise');

-- 9b. Crème chantilly mascarpone vanille.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Chantilly mascarpone vanille","nom_ar":"الشونتيي بالماسكاربون والفانيّة","duree_estimee_min":15,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Crème, mascarpone, cuve et fouet TRÈS froids (4 °C) — point critique, sinon la crème ne monte pas",
     "Détendre le mascarpone avec un peu de crème au fouet pour éviter les grumeaux",
     "Ajouter le reste de la crème + sucre glace + vanille, monter vitesse moyenne puis rapide → texture ferme qui tient au fouet",
     "Ne pas trop battre (vire au beurre) — utiliser aussitôt ou réserver 1 h maximum à 4 °C"],
   "checklist_items_ar":[
     "الكريمة، الماسكاربون، السلطانية والفوي خاصهم يكونو باردين بزاف (4 درجات) — نقطة حساسة، وإلا الكريمة ما كتطلعش",
     "رخّي الماسكاربون بشوية ديال الكريمة بالفوي باش ما يبقاوش الكتل",
     "زيد الباقي ديال الكريمة + السكر الگلاصي + الفانيّة، اضرب فالسرعة المتوسطة ومن بعد السريعة ← قاسحة وكتشد فالفوي",
     "ما تضربش بزاف (كتولي زبدة) — خدم بيها دغيا ولا خليها ساعة ماكسيموم ف 4 درجات"]}
]'::jsonb,
  instructions = 'Crème chantilly mascarpone vanille — 1 205 g, perte 0,4 % → 1 200 g. Consommation Forêt Noire : 400 + 400 (couches) + 300 (masquage) = 1 100 g.
Crème liquide 35 % MG obligatoire (référentiel : Crème fraîche). À monter au dernier moment, ne se congèle pas.
🇲🇦 الشونتيي : كلشي خاصو يكون بارد بزاف. تضرب فاللخر، وما كتفرّزش.',
  updated_at = NOW()
WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'chantilly');

-- 9c. Sirop d'imbibage griotte.
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Sirop d''imbibage griotte","nom_ar":"السيرو ديال حب الملوك","duree_estimee_min":10,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":false,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Porter eau + sucre à ébullition 1 min, jusqu''à dissolution complète",
     "Hors du feu, ajouter la purée de griotte, mélanger",
     "Refroidir COMPLÈTEMENT avant imbibage — un sirop chaud fait fondre la chantilly. Se garde 1 semaine à 4 °C"],
   "checklist_items_ar":[
     "غلي الما والسكر دقيقة حتى يذوب السكر كامل",
     "حيدو من على العافية، زيد بوري حب الملوك وحرك",
     "خليه يبرد نهائياً قبل السقي — السيرو السخون كيذوّب الشونتيي. كيتحفظ سيمانة ف 4 درجات"]}
]'::jsonb,
  instructions = 'Sirop d''imbibage griotte (sans alcool) — 400 g, perte 2,5 % à l''ébullition → 390 g. Consommation Forêt Noire : 100 g par feuille × 3 = 300 g.
Sans kirsch : version sans alcool assumée (voir allergènes/notes du produit).
🇲🇦 السيرو بلا كحول. خاصو يكون بارد نيشان قبل الاستعمال.',
  updated_at = NOW()
WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'sirop');

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Étapes d'ASSEMBLAGE sur le produit (bilingues, fiche §Étapes).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes SET etapes = '[
  {"ordre":1,"nom":"Préparation et découpe du biscuit","nom_ar":"الطياب وتقطاع البيسكوي","duree_estimee_min":15,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cuire la génoise sur plaque 40 × 30 cm. Laisser refroidir complètement sur grille",
     "Couper la génoise horizontalement pour obtenir 3 feuilles d''épaisseur égale (environ 8-10 mm chacune)",
     "Réserver les plaques de biscuit prêtes pour le montage"],
   "checklist_items_ar":[
     "طيب الجينواز فبلاك 40 × 30 سم. خليها تبرد مزيان فوق الشبكة",
     "قطع الجينواز بالعرض باش تخرج 3 ديال الطبقات متقادين (تقريبا 8 حتى 10 مم للوحدة)",
     "حط الطبقات ديال البيسكوي على جنب باش توجدهوم للمونطاج"]},
  {"ordre":2,"nom":"Montage du cadre","nom_ar":"المونطاج ديال الكادر","duree_estimee_min":45,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Cadre 40 × 30 × 4,5 cm sur plaque plate + rhodoïd sur les bords",
     "Couche 1 : poser le biscuit n°1 au fond. Puncher avec 100 g de sirop griotte",
     "Couche 2 : étaler 400 g de chantilly mascarpone. Enfoncer uniformément 225 g de griottes égouttées",
     "Couche 3 : poser le biscuit n°2, presser doucement, puncher avec 100 g de sirop",
     "Couche 4 : étaler 400 g de chantilly. Enfoncer les 225 g de griottes restants",
     "Couche 5 : poser le biscuit n°3 (côté lisse vers le haut), puncher avec 100 g de sirop",
     "Couche 6 (masquage) : étaler le reste de la chantilly (300 g) à la palette pour lisser parfaitement à ras du cadre",
     "Bloquer au froid 2 h minimum (ou 30 min en cellule) — le cadre doit être bien froid avant parage"],
   "checklist_items_ar":[
     "الكادر 40 × 30 × 4,5 سم فوق بلاطو مسطح + رودويد على الجنابات",
     "الطبقة 1 : حط البيسكوي رقم 1 فالقاع. سقيه بـ100 غرام ديال سيرو حب الملوك",
     "الطبقة 2 : فرش 400 غرام ديال الشونتيي ماسكاربون. دخل 225 غرام ديال حب الملوك المصفّى بشكل متساوي",
     "الطبقة 3 : حط البيسكوي رقم 2، اضغط بالرفق، سقيه بـ100 غرام ديال السيرو",
     "الطبقة 4 : فرش 400 غرام ديال الشونتيي. دخل 225 غرام ديال حب الملوك الباقيين",
     "الطبقة 5 : حط البيسكوي رقم 3 (الجيهة الملساء لفوق)، سقيه بـ100 غرام ديال السيرو",
     "الطبقة 6 (التغطية) : فرش الباقي ديال الشونتيي (300 غرام) بالپاليط باش يولي الوجه أملس نيشان على قد الكادر",
     "بلوكاج فالفريكو ساعتين على الأقل (ولا 30 دقيقة فالسيليل) — الكادر خاصو يكون بارد مزيان قبل التقصيص"]},
  {"ordre":3,"nom":"Parage et découpe","nom_ar":"التقصيص والتقطاع","duree_estimee_min":30,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sortir le cadre bien froid. Chauffer légèrement le cadre (chalumeau rapide) et le retirer vers le haut",
     "Parsemer généreusement la surface lisse de 150 g de copeaux de chocolat noir AVANT la découpe",
     "Parer 1 cm sur les 4 côtés au couteau long chauffé et essuyé → rectangle de 38 × 28 cm",
     "Marquer à la règle : 4 colonnes de 9,5 cm, 6 rangées de 4,5 cm",
     "Couper au couteau chaud et SEC, nettoyer et essuyer entre CHAQUE coupe, un seul geste du haut vers le bas (pour ne pas salir la crème avec le chocolat)",
     "Contrôle : couches nettes, copeaux uniformes, parts de 9,5 × 4,5 cm"],
   "checklist_items_ar":[
     "خرج الكادر بارد مزيان. سخن الكادر بشوية (شالوميو بسرعة) ورفعو لفوق",
     "رش مزيان 150 غرام ديال قشور الشوكلاط الكحل على الوجه كامل قبل ما تقطع",
     "قص سنتيم من كل جيهة بالموس الطويل السخون والمنشف ← كيعطينا 38 × 28 سم",
     "علم بالمسطرة : 4 أعمدة ديال 9,5 سم، 6 صفوف ديال 4,5 سم",
     "قطع بالموس السخون والناشف، نقيه ونشفو بعد كل تقطيعة، حركة وحدة من فوق لتحت (باش ما يتوسخش الكريم بالشوكلاط)",
     "المراقبة : الطبقات نقيين، القشور متساوية، الحصص 9,5 × 4,5 سم"]},
  {"ordre":4,"nom":"Décor final","nom_ar":"الزواق النهائي","duree_estimee_min":15,
   "est_bloquante":false,"timer_auto":false,"controle_qualite":false,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Pocher une petite rosace de chantilly sur chaque part individuelle (optionnel si chantilly restante)",
     "Déposer une demi-cerise confite ou amarena au centre de chaque part",
     "Mettre immédiatement en vitrine réfrigérée < 4 °C"],
   "checklist_items_ar":[
     "زوق بوردة صغيرة ديال الشونتيي فوق كل حصة (اختياري يلا بقات الشونتيي)",
     "حط نص حبة ديال حب الملوك فوسط كل حصة",
     "حط الحصص دغيا فالفيترينة الباردة أقل من 4 درجات"]}
]'::jsonb,
  instructions = 'FORÊT NOIRE (SKU 10065) — assemblage. La fabrication des composants est décrite sur leurs fiches (Génoise cacao, Sirop d''imbibage griotte, Crème chantilly mascarpone vanille).

━━━ FR ━━━

Format : cadre 40 × 30 × 4,5 cm → 24 parts de 9,5 × 4,5 cm, ~130 g la part. Cadre paré : ~2 800 g (brut 3 100 g − 300 g de parage).

Structure (bas → haut, 6 couches) :
1. Génoise + sirop (250 + 100 g) — 2. Chantilly + griottes (400 + 225 g) — 3. Génoise + sirop (250 + 100 g) — 4. Chantilly + griottes (400 + 225 g) — 5. Génoise + sirop (250 + 100 g) — 6. Masquage chantilly (300 g) — 7. Décor copeaux (150 g).

Points critiques : la crème liquide et le mascarpone doivent être très froids (4 °C) pour monter correctement. Ne pas surgeler les parts finies avec les griottes (risque de rendre l''eau à la décongélation).

DLC : 48 h à +4 °C en vitrine fermée (crème foisonnée très sensible). Sortir la part 10 min avant dégustation.

Allergènes : gluten (blé), œufs, lait (crème, mascarpone), soja (chocolat). AUCUN alcool.

━━━ 🇲🇦 بالدارجة ━━━

الفورما : كادر 40 × 30 × 4,5 سم ← 24 حصة ديال 9,5 × 4,5 سم، تقريبا 130 غرام الحصة. الكادر مقصص : تقريبا 2 800 غرام (خام 3 100 ناقص 300 ديال التقصيص).

البنية من تحت لفوق : جينواز + سيرو — شونتيي + حب الملوك — جينواز + سيرو — شونتيي + حب الملوك — جينواز + سيرو — تغطية بالشونتيي — زواق بالقشور ديال الشوكلاط.

النقط الحساسة : الكريمة والماسكاربون خاصهم يكونو باردين بزاف (4 درجات) باش يطلعو مزيان. ما تفرّزش الحصص الموجودين بحب الملوك (كيرجعو الما منين كيذوبو).

الصلاحية : 48 ساعة ف +4 درجات فالفيترينة المسدودة (الشونتيي حساسة بزاف). خرج الحصة 10 دقايق قبل الأكل.

المواد المسببة للحساسية : الگلوتين (القمح)، البيض، الحليب (الكريمة، الماسكاربون)، الصوجا (الشوكلاط). بلا كحول.

Source : fiche technique Ôfauria, 08/10/2026.',
  updated_at = NOW()
WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'produit');

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Contrôles finaux.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_comp INT; n_ing INT; tot NUMERIC; n_et INT; pid UUID;
BEGIN
  SELECT count(*), sum(quantite) INTO n_comp, tot FROM recipe_format_components
   WHERE format_id = (SELECT id FROM _fn303_fmt);
  IF n_comp <> 5 OR tot <> 2750 THEN
    RAISE EXCEPTION 'Forêt Noire : % composants / % g, 5 composants et 2 750 g attendus', n_comp, tot;
  END IF;

  SELECT count(*) INTO n_ing FROM recipe_ingredients
   WHERE recipe_id IN (SELECT id FROM _fn303_rec WHERE key IN ('genoise', 'chantilly', 'sirop'));
  IF n_ing <> 11 THEN
    RAISE EXCEPTION 'Forêt Noire : % lignes d''ingrédients de bases, 11 attendues', n_ing;
  END IF;

  SELECT jsonb_array_length(etapes) INTO n_et FROM recipes
   WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'produit');
  IF n_et <> 4 THEN
    RAISE EXCEPTION 'Forêt Noire produit : % étapes, 4 attendues', n_et;
  END IF;

  -- Chaque étape bilingue doit avoir autant d'items darija que d'items FR.
  IF EXISTS (
    SELECT 1 FROM recipes r, jsonb_array_elements(r.etapes) e
     WHERE r.id IN (SELECT id FROM _fn303_rec)
       AND jsonb_array_length(e->'checklist_items') <> jsonb_array_length(e->'checklist_items_ar')
  ) THEN
    RAISE EXCEPTION 'Forêt Noire : checklist FR/darija de longueurs différentes';
  END IF;

  SELECT product_id INTO pid FROM recipes WHERE id = (SELECT id FROM _fn303_rec WHERE key = 'produit');
  IF pid IS NULL THEN
    RAISE WARNING 'Forêt Noire : recette non liée au produit FORÊT NOIRE (produit absent ou déjà porté par une autre recette)';
  END IF;
END $$;
