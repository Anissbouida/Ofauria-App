-- Migration 165 : Poids unitaire d'une piece pour les recettes ou yield_unit
-- ne coincide pas avec products.sale_unit.
--
-- Contexte : aujourd'hui syncProductPrice() fait totalCost / yield_quantity
-- pour deduire le cout unitaire, sans regarder yield_unit ni products.sale_unit.
-- Quand yield_unit = 'kg' mais le produit se vend a la piece (sale_unit='unit'),
-- ou inversement, le prix de vente propose est faux.
--
-- piece_weight_kg permet la conversion : combien pese une piece quand on
-- produit en kg, ou inversement combien fait 1 piece en kg.
-- Nullable : seulement requis quand recipes.yield_unit <> products.sale_unit.

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS piece_weight_kg DECIMAL(10,4) NULL;

COMMENT ON COLUMN recipes.piece_weight_kg IS
  'Poids unitaire d''une piece, en kg. Requis quand yield_unit != products.sale_unit pour convertir entre kg et piece au moment du calcul du prix de vente.';

-- Versionning : recipe_versions doit aussi tracker la valeur historique.
ALTER TABLE recipe_versions
  ADD COLUMN IF NOT EXISTS piece_weight_kg DECIMAL(10,4) NULL;

COMMENT ON COLUMN recipe_versions.piece_weight_kg IS
  'Snapshot de recipes.piece_weight_kg au moment de la sauvegarde de version.';
