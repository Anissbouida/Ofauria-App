-- Migration 220 : Intégrer les ingrédients directs des recettes COMPOSÉES à la composition
--
-- POURQUOI
--   En mode composé, la composition (recipe_components + BOM du format par défaut)
--   doit refléter TOUT le coût matière. Or certaines recettes composées gardaient des
--   ingrédients directs dans recipe_ingredients (comptés via direct_cost dans
--   v_recipe_total_cost mais ABSENTS de la BOM par format → matière/format < coût recette).
--   On les déplace en composants, puis on vide recipe_ingredients pour ces recettes.
--
-- NEUTRALITÉ
--   v_recipe_total_cost (compose) = direct_cost + Σ composants-ingrédient. La valeur
--   passe de direct_cost vers Σ composants (même conversion d'unité) ⇒ total inchangé.
--   Désormais matière/format = coût recette pour TOUS les composés.
--
-- INVERSION : ré-insérer depuis recipe_components vers recipe_ingredients ; retirer
--   les composants-ingrédient correspondants.

-- A. Vers recipe_components (miroir niveau recette).
INSERT INTO recipe_components (recipe_id, role, source_ingredient_id, quantite, unite, ordre)
SELECT ri.recipe_id, NULL, ri.ingredient_id, ri.quantity, COALESCE(ri.unit, ing.unit),
       (SELECT COALESCE(MAX(rc.ordre), -1) FROM recipe_components rc WHERE rc.recipe_id = ri.recipe_id)
         + (row_number() OVER (PARTITION BY ri.recipe_id ORDER BY ing.name))::int
FROM recipe_ingredients ri
JOIN ingredients ing ON ing.id = ri.ingredient_id
JOIN recipes r ON r.id = ri.recipe_id
WHERE r.is_base = false AND r.mode_cout = 'compose' AND ri.quantity > 0
  AND NOT EXISTS (SELECT 1 FROM recipe_components rc
                  WHERE rc.recipe_id = ri.recipe_id AND rc.source_ingredient_id = ri.ingredient_id);

-- B. Vers la BOM du format par défaut.
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, quantite, unite, ordre)
SELECT f.id, NULL, ri.ingredient_id, ri.quantity, COALESCE(ri.unit, ing.unit),
       (SELECT COALESCE(MAX(c.ordre), -1) FROM recipe_format_components c WHERE c.format_id = f.id)
         + (row_number() OVER (PARTITION BY f.id ORDER BY ing.name))::int
FROM recipe_ingredients ri
JOIN ingredients ing ON ing.id = ri.ingredient_id
JOIN recipe_formats f ON f.recipe_id = ri.recipe_id AND f.is_default
JOIN recipes r ON r.id = ri.recipe_id
WHERE r.is_base = false AND r.mode_cout = 'compose' AND ri.quantity > 0
  AND NOT EXISTS (SELECT 1 FROM recipe_format_components c
                  WHERE c.format_id = f.id AND c.source_ingredient_id = ri.ingredient_id);

-- C. Vider recipe_ingredients des recettes composées (évite le double comptage).
DELETE FROM recipe_ingredients ri
USING recipes r
WHERE ri.recipe_id = r.id AND r.is_base = false AND r.mode_cout = 'compose';
