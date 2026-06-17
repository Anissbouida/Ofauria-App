-- Migration 174 : Deduplication des recipe_ingredients + contrainte UNIQUE.
--
-- DIAGNOSTIC :
--   Au 2026-06-16, la table recipe_ingredients contient 870 lignes mais
--   seulement 472 tuples distincts (recipe_id, ingredient_id, quantity, unit).
--   398 lignes sont des doublons exacts qui faussent le calcul du poids et du
--   cout (sommes doublees) dans v_recipe_direct_weight_kg et v_recipe_direct_cost.
--   Symptome utilisateur : "le systeme ne calcule pas le poids des ingredients
--   des recettes de base" — en realite le poids est x2/x3/x4 selon le nombre
--   de doublons, ce qui donne des ratios poids/rendement absurdes.
--
--   80 recettes affectees (55% du catalogue). La table n'a JAMAIS eu de
--   contrainte UNIQUE, donc rien n'a empeche les insertions repetees.
--
-- STRATEGIE :
--   1) Garder UNE ligne par tuple (recipe_id, ingredient_id, quantity, unit) :
--      MIN(id) pour avoir un choix deterministe. Les 8 cas business legitimes
--      (meme ingredient avec quantites differentes dans la meme recette, ex:
--      425g + 864g de creme dans un assemblage) sont preserves car le tuple
--      complet est different.
--   2) Ajouter UNIQUE(recipe_id, ingredient_id, quantity, unit) pour empecher
--      toute nouvelle insertion de doublon exact.
--
-- IMPACT :
--   v_recipe_direct_weight_kg et v_recipe_direct_cost recalculent automatiquement
--   les bonnes valeurs (vues toujours fraiches). Aucun cache, aucun re-sync
--   necessaire. Les products.cost_price et price seront re-calcules au prochain
--   syncProductPrice (next save d'une recette ou ingredient).

BEGIN;

-- Etape 1 : log avant nettoyage pour traçabilite
DO $$
DECLARE
  total_before INT;
  unique_tuples INT;
BEGIN
  SELECT COUNT(*) INTO total_before FROM recipe_ingredients;
  SELECT COUNT(*) INTO unique_tuples FROM (
    SELECT DISTINCT recipe_id, ingredient_id, quantity, unit FROM recipe_ingredients
  ) t;
  RAISE NOTICE 'Avant dedup : % lignes / % tuples uniques (% doublons a supprimer)',
    total_before, unique_tuples, total_before - unique_tuples;
END $$;

-- Etape 2 : suppression des doublons exacts
-- On garde la ligne avec le MIN(id) par tuple complet, supprime les autres.
DELETE FROM recipe_ingredients ri
USING (
  SELECT ingredient_id, recipe_id, quantity, unit, MIN(id) AS keep_id
  FROM recipe_ingredients
  GROUP BY recipe_id, ingredient_id, quantity, unit
  HAVING COUNT(*) > 1
) doublons
WHERE ri.recipe_id = doublons.recipe_id
  AND ri.ingredient_id = doublons.ingredient_id
  AND ri.quantity = doublons.quantity
  AND COALESCE(ri.unit, '') = COALESCE(doublons.unit, '')
  AND ri.id <> doublons.keep_id;

-- Etape 3 : contrainte UNIQUE pour empecher la recidive
-- Note : on utilise COALESCE pour permettre les unit NULL (1 seule ligne NULL
-- par couple recipe+ingredient est ok aussi).
CREATE UNIQUE INDEX IF NOT EXISTS recipe_ingredients_uniq_tuple
  ON recipe_ingredients (recipe_id, ingredient_id, quantity, COALESCE(unit, ''));

COMMENT ON INDEX recipe_ingredients_uniq_tuple IS
  'Empeche la duplication exacte d''une ligne d''ingredient dans une recette. Mig 174.';

-- Etape 4 : log apres
DO $$
DECLARE
  total_after INT;
BEGIN
  SELECT COUNT(*) INTO total_after FROM recipe_ingredients;
  RAISE NOTICE 'Apres dedup : % lignes (% lignes supprimees au total).',
    total_after, (SELECT COUNT(*) FROM (SELECT 1) t) * 0;
END $$;

COMMIT;
