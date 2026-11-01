-- 411 (L2) : UNIFICATION DU MODÈLE DE COMPOSITION.
--
-- Migre toutes les recettes encore en ancien modèle (recipe_ingredients /
-- recipe_sub_recipes) vers le modèle cible : composants du format par défaut
-- (recipe_format_components) + miroir (recipe_components), puis purge l'ancien
-- modèle et passe mode_cout='compose'. Après ça, une seule représentation de la
-- composition existe, et fn_recipe_cost (mig 409) calcule tout depuis les composants.
--
-- Coût : neutre pour 175 recettes sur 177. Seules « Crème pâtissière chocolat » et
-- « Éclair chocolat » augmentent (~0,46 / 0,59 DH) : le modèle composé applique la
-- perte standard (3 %) de la crème pâtissière, que l'ancien modèle ignorait. C'est
-- une CORRECTION assumée (l'ancien coût sous-estimait la matière perdue).
--
-- Écran des bases (PreparationPage) adapté dans le même lot pour éditer le composé.

-- Recettes à migrer (ancien modèle, actives).
CREATE TEMP TABLE _mig411_legacy ON COMMIT DROP AS
SELECT r.id FROM recipes r
WHERE r.archived_at IS NULL
  AND (EXISTS(SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id=r.id)
    OR EXISTS(SELECT 1 FROM recipe_sub_recipes rs WHERE rs.recipe_id=r.id));

-- 1) Format neutre par défaut pour celles qui n'en ont pas.
UPDATE recipe_formats f SET is_default=false
WHERE f.recipe_id IN (SELECT id FROM _mig411_legacy)
  AND NOT EXISTS(SELECT 1 FROM recipe_formats x WHERE x.recipe_id=f.recipe_id AND x.is_active AND x.is_default);

INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, is_default, is_active)
SELECT l.id, NULL, 1, 'g', 1, true, true
FROM _mig411_legacy l
WHERE NOT EXISTS(SELECT 1 FROM recipe_formats f WHERE f.recipe_id=l.id AND f.is_active AND f.is_default);

-- Format par défaut cible de chaque recette migrée.
CREATE TEMP TABLE _mig411_fmt ON COMMIT DROP AS
SELECT l.id AS recipe_id,
       (SELECT f.id FROM recipe_formats f WHERE f.recipe_id=l.id AND f.is_active AND f.is_default LIMIT 1) AS format_id
FROM _mig411_legacy l;

-- 2) Composants du format : ingrédients puis sous-recettes.
INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, source_recipe_id, quantite, unite, ordre)
SELECT m.format_id, NULL, ri.ingredient_id, NULL, ri.quantity, COALESCE(NULLIF(ri.unit,''), ing.unit), 0
FROM _mig411_fmt m JOIN recipe_ingredients ri ON ri.recipe_id=m.recipe_id JOIN ingredients ing ON ing.id=ri.ingredient_id
WHERE m.format_id IS NOT NULL;

INSERT INTO recipe_format_components (format_id, role, source_ingredient_id, source_recipe_id, quantite, unite, ordre)
SELECT m.format_id, NULL, NULL, rs.sub_recipe_id, rs.quantity, sr.yield_unit, 100
FROM _mig411_fmt m JOIN recipe_sub_recipes rs ON rs.recipe_id=m.recipe_id JOIN recipes sr ON sr.id=rs.sub_recipe_id
WHERE m.format_id IS NOT NULL;

-- 3) Miroir recipe_components (même contenu que le format par défaut).
INSERT INTO recipe_components (recipe_id, role, source_ingredient_id, source_recipe_id, quantite, unite, ordre)
SELECT l.id, NULL, ri.ingredient_id, NULL, ri.quantity, COALESCE(NULLIF(ri.unit,''), ing.unit), 0
FROM _mig411_legacy l JOIN recipe_ingredients ri ON ri.recipe_id=l.id JOIN ingredients ing ON ing.id=ri.ingredient_id;

INSERT INTO recipe_components (recipe_id, role, source_ingredient_id, source_recipe_id, quantite, unite, ordre)
SELECT l.id, NULL, NULL, rs.sub_recipe_id, rs.quantity, sr.yield_unit, 100
FROM _mig411_legacy l JOIN recipe_sub_recipes rs ON rs.recipe_id=l.id JOIN recipes sr ON sr.id=rs.sub_recipe_id;

-- 4) Passage en composé + purge de l'ancien modèle.
UPDATE recipes SET mode_cout='compose', updated_at=NOW() WHERE id IN (SELECT id FROM _mig411_legacy);
DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM _mig411_legacy);
DELETE FROM recipe_sub_recipes WHERE recipe_id IN (SELECT id FROM _mig411_legacy);
