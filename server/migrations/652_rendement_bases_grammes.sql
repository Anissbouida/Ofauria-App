-- 652 — Bases rendues « 1 unité » pour une fournée entière : rendement en grammes.
--
-- POURQUOI
--   Quatre recettes de base (Créme Amande, Pate sucré, Biscuit Moelleux Nature, Confit
--   Framboise, relevées en production le 2026-11-23) avaient pour rendement « 1 unité », la
--   fournée entière, alors que ce sont des préparations pesées. Une fiche qui les emploie ne
--   pouvait les doser qu'en fournées : la Tarte aux amandes comptait 22 fournées de crème
--   d'amande et 22 de pâte sucrée pour 22 tartelettes (≈ 16 kg et 25 kg).
--
-- CE QUI CHANGE
--   1. Pour toute base active rendue 1 « unit », utilisée comme sous-recette, dont la
--      composition du format par défaut n'a que des matières en g/kg/ml/cl/l : rendement =
--      poids de la fournée en grammes (ml compté 1 g, approximation pour l'eau et les purées),
--      et le format par défaut passe en rendement au kilo.
--   2. Tarte aux amandes (22 tartelettes Ø 10) : crème d'amande 440 g (20 g par tartelette,
--      2/3 d'une garniture de ≈ 30 g) et pâte sucrée 990 g (≈ 45 g par fond). Valeurs
--      ESTIMÉES (décision utilisateur « selon ton jugement »), à confirmer par le chef.
--   3. Toute autre ligne qui dose ces bases en « unit » est convertie au poids de la fournée
--      (1 unit → poids en g) : coût et besoins inchangés (Entremets framboise / ivoire,
--      OFAURIA, Cheesecake framboise emploient une fournée entière).
--
-- RETOUR ARRIÈRE
--   Lignes tracées par recipe_format_components_bom_audit ; rendements d'origine : 1 unit.

CREATE TEMP TABLE _m652 ON COMMIT DROP AS
SELECT b.id, b.name,
       sum(fc.quantite * CASE lower(fc.unite) WHEN 'kg' THEN 1000 WHEN 'g' THEN 1 WHEN 'l' THEN 1000 WHEN 'cl' THEN 10 WHEN 'ml' THEN 1 END) AS poids_g
  FROM recipes b
  JOIN recipe_formats f ON f.recipe_id = b.id AND f.is_default AND f.is_active
  JOIN recipe_format_components fc ON fc.format_id = f.id
 WHERE b.archived_at IS NULL AND b.is_base AND b.yield_quantity = 1 AND b.yield_unit = 'unit'
   AND EXISTS (SELECT 1 FROM recipe_format_components u WHERE u.source_recipe_id = b.id)
 GROUP BY b.id, b.name
HAVING bool_and(fc.source_ingredient_id IS NOT NULL AND lower(fc.unite) IN ('kg', 'g', 'l', 'cl', 'ml'))
   AND sum(fc.quantite) > 0;

-- 2. Tarte aux amandes : dosage par tartelette (avant la conversion générique).
UPDATE recipe_format_components fc
   SET quantite = CASE lower(btrim(m.name)) WHEN 'créme amande' THEN 440 WHEN 'pate sucré' THEN 990 END,
       unite = 'g', updated_at = now()
  FROM _m652 m, recipe_formats f, recipes p
 WHERE fc.source_recipe_id = m.id AND f.id = fc.format_id AND p.id = f.recipe_id
   AND p.archived_at IS NULL AND lower(btrim(p.name)) = 'tarte aux amandes'
   AND lower(btrim(m.name)) IN ('créme amande', 'pate sucré')
   AND fc.quantite = 22 AND fc.unite = 'unit';

-- 3. Autres emplois en « unit » : une unité = une fournée = poids_g.
UPDATE recipe_format_components fc
   SET quantite = round(fc.quantite * m.poids_g, 3), unite = 'g', updated_at = now()
  FROM _m652 m
 WHERE fc.source_recipe_id = m.id AND fc.unite = 'unit';

UPDATE recipe_components rc
   SET quantite = round(rc.quantite * m.poids_g, 3), unite = 'g', updated_at = now()
  FROM _m652 m
 WHERE rc.source_recipe_id = m.id AND rc.unite = 'unit';

-- 1. Rendement des bases en grammes, format par défaut au kilo.
UPDATE recipes b SET yield_quantity = m.poids_g, yield_unit = 'g', updated_at = now()
  FROM _m652 m WHERE b.id = m.id;

UPDATE recipe_formats f SET rendement_unite = 'kg', rendement_kg = round(m.poids_g / 1000.0, 4), updated_at = now()
  FROM _m652 m WHERE f.recipe_id = m.id AND f.is_default;
