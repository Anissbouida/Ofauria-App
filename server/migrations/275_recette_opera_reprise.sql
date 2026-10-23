-- Migration 275 : Recette Opera classique — reprise complete apres restauration
--
-- POURQUOI CETTE MIGRATION EXISTE ALORS QUE LA 273 EST DEJA ENREGISTREE
--   La base locale a ete restauree sur un instantane du 09/06/2026 : `recipes`,
--   `recipe_ingredients` et `recipe_format_components` sont revenus a 10 recettes
--   et 0 nomenclature, alors que `_migrations`, `ingredients`, `products` et
--   `production_contenants` n'ont pas bouge. Resultat : la mig 273 est marquee
--   appliquee mais AUCUNE de ses donnees n'est presente, et le runner ne la
--   rejouera jamais.
--
--   Cette migration reprend donc l'injection de bout en bout. Elle est ecrite
--   pour etre rejouable et pour cohabiter avec la 273 si celle-ci tourne un jour
--   sur une base neuve : UUID fixes + ON CONFLICT DO NOTHING, compositions en
--   DELETE puis INSERT.
--
-- CE QUI CHANGE PAR RAPPORT A LA 273
--   « Biscuit Joconde » et « Ganache chocolat noir » n'existent plus. La 273 les
--   ECRASAIT (d'ou l'impact mesure a l'epoque : Opera noisette +7,2 %, Tarte
--   chocolat +13,5 %). Ici elles sont simplement CREEES, avec les valeurs du
--   fichier source. Plus aucun cout existant n'est affecte : les 10 recettes
--   restantes n'ont aucun lien avec les cinq preparations de l'opera.
--
-- ─── CONVENTION RENDEMENT (fichier « poids_cru / perte / poids_final ») ───
--   yield_quantity = poids CRU, perte_standard_pct = perte de transformation.
--   Le net se deduit : v_recipe_total_cost divise par
--   `yield_quantity * (1 - perte_standard_pct/100)`. Poser le net dans
--   yield_quantity ET la perte compterait la perte deux fois.
--     Biscuit Joconde      1300 g - 15 % = 1105 g
--     Sirop imbibage cafe  1000 g -  5 % =  950 g
--     Ganache choc. noir   1200 g -  2 % = 1176 g
--     Creme au beurre cafe  970 g -  1 % =  960 g
--     Pate a glacer opera   500 g -  0 % =  500 g
--
-- ─── DENSITE DE L'EXTRAIT DE CAFE ───
--   Stocke en LITRES ; les lignes de recette sont en grammes. Sans densite,
--   fn_unit_conv(g -> l) retombe sur son facteur neutre 1 et 50 g seraient
--   coutes comme 50 L (14 583 DH au lieu de ~15 DH). On pose 1.000 kg/l si la
--   colonne est vide. Un extrait reel titre 1,05-1,15 : a corriger par le chef,
--   l'ecart est de l'ordre de 1,5 DH sur la fournee de sirop.
--
-- PORTEE
--   + 5 preparations de base (UUID fixes) avec leurs 19 lignes d'ingredients
--   + 1 recette « Opera classique » en mode compose
--   + 3 formats (Cadre opera 70 p. / Cadre demi 32 p. / Cadre bande 18 p.)
--   + 15 lignes de nomenclature + 5 lignes de miroir recipe_components
--   Aucune recette existante modifiee.
--
-- INVERSION
--   DELETE FROM recipes WHERE id IN (
--     '0be7a000-0000-4000-8000-000000000001',  -- Opera classique
--     '0be7a000-0000-4000-8000-000000000002',  -- Sirop imbibage cafe
--     '0be7a000-0000-4000-8000-000000000003',  -- Creme au beurre cafe
--     '0be7a000-0000-4000-8000-000000000004',  -- Pate a glacer opera
--     '0be7a000-0000-4000-8000-000000000005',  -- Biscuit Joconde
--     '0be7a000-0000-4000-8000-000000000006'); -- Ganache chocolat noir
--   (cascade sur formats, nomenclature et miroir)

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Resolution des ingredients. Le referentiel porte des doublons ("Beurre" x3,
--    "Sucre semoule" x2) : on retient celui qui est reellement utilise par les
--    recettes existantes, et a defaut le plus ancien.
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

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM _opera_ing;
  IF n <> 13 THEN
    RAISE EXCEPTION 'Ingredients introuvables : % trouve(s) sur 13 attendus', n;
  END IF;
END $$;

-- Les 3 cadres de la mig 272 doivent exister : sans eux la recette n'a pas de
-- format et la nomenclature n'a nulle part ou se poser.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM production_contenants
   WHERE nom IN ('Cadre opéra 60x40x3 cm', 'Cadre demi 40x30x4,5 cm', 'Cadre bande 60x15x4,5 cm');
  IF n <> 3 THEN
    RAISE EXCEPTION 'Cadres de la mig 272 introuvables : % sur 3', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Densite de l'extrait de cafe.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ingredients SET densite_kg_l = 1.000
 WHERE name = 'Extrait de café liquide' AND densite_kg_l IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Les 5 preparations de base.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipes (id, name, is_base, mode_cout, yield_quantity, yield_unit, perte_standard_pct)
VALUES
  ('0be7a000-0000-4000-8000-000000000005', 'Biscuit Joconde',       true, 'ratio_poids', 1300, 'g', 15),
  ('0be7a000-0000-4000-8000-000000000002', 'Sirop imbibage café',   true, 'ratio_poids', 1000, 'g',  5),
  ('0be7a000-0000-4000-8000-000000000006', 'Ganache chocolat noir', true, 'ratio_poids', 1200, 'g',  2),
  ('0be7a000-0000-4000-8000-000000000003', 'Crème au beurre café',  true, 'ratio_poids',  970, 'g',  1),
  ('0be7a000-0000-4000-8000-000000000004', 'Pâte à glacer opéra',   true, 'ratio_poids',  500, 'g',  0)
ON CONFLICT (id) DO NOTHING;

-- Rejouable : on repart de zero sur les compositions de ces 5 fiches.
DELETE FROM recipe_ingredients
 WHERE recipe_id IN (
   '0be7a000-0000-4000-8000-000000000002', '0be7a000-0000-4000-8000-000000000003',
   '0be7a000-0000-4000-8000-000000000004', '0be7a000-0000-4000-8000-000000000005',
   '0be7a000-0000-4000-8000-000000000006'
 );

INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
SELECT v.recette_id, ing.id, v.qte, 'g'
FROM (VALUES
  -- Biscuit Joconde — 1300 g cru, 15 % de perte a la cuisson
  ('0be7a000-0000-4000-8000-000000000005'::uuid, 'Amande poudre',                      250::numeric),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre glace',                              250),
  ('0be7a000-0000-4000-8000-000000000005', 'Farine Fleur',                              75),
  ('0be7a000-0000-4000-8000-000000000005', 'Oeufs entiers liquides',                   350),
  ('0be7a000-0000-4000-8000-000000000005', 'Blancs d''œufs liquides pasteurisés',       230),
  ('0be7a000-0000-4000-8000-000000000005', 'Sucre semoule',                             80),
  ('0be7a000-0000-4000-8000-000000000005', 'Beurre',                                    65),
  -- Sirop imbibage cafe — 1000 g cru, 5 % a l'ebullition
  ('0be7a000-0000-4000-8000-000000000002', 'Eau',                                      500),
  ('0be7a000-0000-4000-8000-000000000002', 'Sucre semoule',                            450),
  ('0be7a000-0000-4000-8000-000000000002', 'Extrait de café liquide',                   50),
  -- Ganache chocolat noir — 1200 g cru, 2 % a l'emulsion
  ('0be7a000-0000-4000-8000-000000000006', 'Crème fraîche',                            600),
  ('0be7a000-0000-4000-8000-000000000006', 'Chocolat de couverture Noir 55%',          500),
  ('0be7a000-0000-4000-8000-000000000006', 'Beurre',                                   100),
  -- Creme au beurre cafe — 970 g cru, 1 % a l'emulsion
  ('0be7a000-0000-4000-8000-000000000003', 'Sucre semoule',                            250),
  ('0be7a000-0000-4000-8000-000000000003', 'Eau',                                       80),
  ('0be7a000-0000-4000-8000-000000000003', 'Oeufs Jaune',                              120),
  ('0be7a000-0000-4000-8000-000000000003', 'Beurre',                                   500),
  ('0be7a000-0000-4000-8000-000000000003', 'Extrait de café liquide',                   20),
  -- Pate a glacer opera — 500 g, pas de perte a la fonte
  ('0be7a000-0000-4000-8000-000000000004', 'GLAÇAGE CHOCOLAT',                         500)
) AS v (recette_id, ingredient, qte)
JOIN _opera_ing ing ON ing.name = v.ingredient;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Opera classique — le cout vient de la nomenclature par format.
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
--    perte_pct = perte de mise en oeuvre a l'assemblage, distincte de la perte
--    de transformation de la sous-recette.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_format_components
 WHERE format_id IN ('0be7a000-0000-4000-8000-0000000000f1',
                     '0be7a000-0000-4000-8000-0000000000f2',
                     '0be7a000-0000-4000-8000-0000000000f3');

INSERT INTO recipe_format_components (format_id, role, source_recipe_id, quantite, unite, perte_pct, ordre)
VALUES
  -- Cadre opera 60x40x3 cm — 5800 g pour 70 pieces
  ('0be7a000-0000-4000-8000-0000000000f1', 'biscuit',   '0be7a000-0000-4000-8000-000000000005', 1200, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f1', 'imbibage',  '0be7a000-0000-4000-8000-000000000002', 1000, 'g', 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', '0be7a000-0000-4000-8000-000000000003', 1500, 'g', 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f1', 'garniture', '0be7a000-0000-4000-8000-000000000006', 1200, 'g', 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f1', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  900, 'g', 5, 5),
  -- Cadre demi 40x30x4,5 cm — 2900 g pour 32 pieces
  ('0be7a000-0000-4000-8000-0000000000f2', 'biscuit',   '0be7a000-0000-4000-8000-000000000005',  600, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f2', 'imbibage',  '0be7a000-0000-4000-8000-000000000002',  500, 'g', 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', '0be7a000-0000-4000-8000-000000000003',  750, 'g', 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f2', 'garniture', '0be7a000-0000-4000-8000-000000000006',  600, 'g', 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f2', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  450, 'g', 5, 5),
  -- Cadre bande 60x15x4,5 cm — 2175 g pour 18 pieces
  ('0be7a000-0000-4000-8000-0000000000f3', 'biscuit',   '0be7a000-0000-4000-8000-000000000005',  450, 'g', 0, 1),
  ('0be7a000-0000-4000-8000-0000000000f3', 'imbibage',  '0be7a000-0000-4000-8000-000000000002',  375, 'g', 0, 2),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', '0be7a000-0000-4000-8000-000000000003',  563, 'g', 5, 3),
  ('0be7a000-0000-4000-8000-0000000000f3', 'garniture', '0be7a000-0000-4000-8000-000000000006',  450, 'g', 2, 4),
  ('0be7a000-0000-4000-8000-0000000000f3', 'glacage',   '0be7a000-0000-4000-8000-000000000004',  337, 'g', 5, 5);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Miroir recipe_components = nomenclature du format PAR DEFAUT (mig 205/218).
--    v_recipe_total_cost, lue partout, passe par ce miroir pour les recettes
--    composees : sans lui, l'Opera couterait 0 pour tout parent.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM recipe_components WHERE recipe_id = '0be7a000-0000-4000-8000-000000000001';

INSERT INTO recipe_components (recipe_id, role, source_recipe_id, source_ingredient_id,
                               quantite, unite, perte_pct, ordre)
SELECT '0be7a000-0000-4000-8000-000000000001', c.role, c.source_recipe_id, c.source_ingredient_id,
       c.quantite, c.unite, c.perte_pct, c.ordre
FROM recipe_format_components c
WHERE c.format_id = '0be7a000-0000-4000-8000-0000000000f1';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Un format par preparation de base, comme la mig 274 le fait pour les autres.
--    Contenant NULL : le chef rattachera le vrai moule depuis l'UI.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format,
                            quantite_par_format_unite, nb_par_defaut, is_default, ordre, is_active)
SELECT r.id, NULL, GREATEST(ROUND(COALESCE(vtw.total_weight_kg * 1000, r.yield_quantity, 1000)::numeric, 2), 1),
       'g', 1, true, 0, true
FROM recipes r
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
WHERE r.id IN ('0be7a000-0000-4000-8000-000000000002', '0be7a000-0000-4000-8000-000000000003',
               '0be7a000-0000-4000-8000-000000000004', '0be7a000-0000-4000-8000-000000000005',
               '0be7a000-0000-4000-8000-000000000006')
  AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id);
