-- Migration 215 : Garde-fou anti-cycle sur recipe_components
--
-- POURQUOI
--   La composition (recipe_components, mode composé) alimente le coût récursif
--   v_recipe_total_cost (mig 205). Jusqu'ici, RIEN n'empêchait un cycle :
--   l'ancienne détection (recipe.repository.detectCycle) ne couvre que
--   recipe_sub_recipes, pas recipe_components. Un composant pointant (in)directement
--   vers sa propre recette donnait un coût faux tronqué (garde-fou depth<12 de la vue)
--   au lieu d'un refus net.
--
--   Cette migration ajoute la 1re ligne de défense en base : interdiction de
--   l'auto-référence directe (A → A). La détection des cycles INDIRECTS (A → B → A)
--   se fait côté service avant insertion (recipe-component.repository.detectComponentCycle),
--   car un CHECK ne peut pas faire de récursion (ni de sous-requête) sur le graphe.
--
-- PORTÉE
--   ALTER TABLE recipe_components : 1 CHECK. Vérifié : 0 ligne en violation.
--
-- INVERSION
--   ALTER TABLE recipe_components DROP CONSTRAINT chk_rc_no_self;

ALTER TABLE recipe_components
  DROP CONSTRAINT IF EXISTS chk_rc_no_self;
ALTER TABLE recipe_components
  ADD CONSTRAINT chk_rc_no_self
  CHECK (source_recipe_id IS NULL OR source_recipe_id <> recipe_id);
