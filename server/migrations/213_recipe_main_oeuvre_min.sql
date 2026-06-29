-- Migration 210 : Temps de main d'œuvre saisissable directement (main_oeuvre_min)
--
-- POURQUOI
--   Le coût de main d'œuvre (MO) se calcule (durée / 60) × taux_main_oeuvre_dh_h.
--   Jusqu'ici la DURÉE venait uniquement de la somme des étapes
--   (recipes.etapes[*].duree_estimee_min). Sur la page Composition (par pièce),
--   le chef veut saisir DIRECTEMENT le temps d'une fournée sans passer par les
--   étapes. On ajoute donc une durée saisissable, prioritaire si renseignée ;
--   sinon on retombe sur la somme des étapes (comportement legacy inchangé).
--
-- PORTÉE
--   ALTER TABLE recipes ADD main_oeuvre_min (nullable). Aucune donnée modifiée,
--   aucun calcul existant impacté (v_recipe_format_cost lit toujours les étapes ;
--   le COALESCE est fait côté service pour la page Composition).
--
-- INVERSION : ALTER TABLE recipes DROP COLUMN main_oeuvre_min;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS main_oeuvre_min INTEGER;

ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS chk_recipes_main_oeuvre_min;
ALTER TABLE recipes
  ADD CONSTRAINT chk_recipes_main_oeuvre_min CHECK (main_oeuvre_min IS NULL OR main_oeuvre_min >= 0);

COMMENT ON COLUMN recipes.main_oeuvre_min IS
  'Temps de main d''œuvre (min) saisi pour une fournée. Prioritaire sur la somme des étapes pour le calcul MO de la page Composition.';
