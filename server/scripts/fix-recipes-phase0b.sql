-- Phase 0b — Correction rendements fantômes + fusion du doublon "Pate sucré"
-- Ciblage par ID (les noms ont des pièges : espace de fin sur "Crème pâtissière ").
-- TRANSACTIONNEL · IDEMPOTENT · DRY-RUN par défaut.
--
-- Dry-run (n'écrit rien) :  psql "$DATABASE_URL" -v apply=false -f server/scripts/fix-recipes-phase0b.sql
-- Appliquer            :    psql "$DATABASE_URL" -v apply=true  -f server/scripts/fix-recipes-phase0b.sql
--
-- IDs cibles :
--   Créme Amande              407621d0-e447-4347-ac7e-53f23ae3567d -> 0.731 kg
--   Biscuit Moelleux Nature   f03713c8-dfb8-4685-8bfa-c7d4cfaf6178 -> 1.630 kg
--   Confit Framboise          b03c5671-9eb2-4f94-a3c8-dd9f583512d5 -> 0.655 kg
--   Crème pâtissière          1034b895-1330-42c3-be78-9370f128d751 -> 0.444 kg  (lait 36,66 cl)
--   Pate sucré (doublon)      69299ebf-a058-477f-8ca3-8c48e4aeb74b -> fusion
--   Pâte sucrée (canonique)   d1577f4a-7045-57e0-b6a4-dcf988255677
\pset pager off

BEGIN;

\echo '--- AVANT ---'
SELECT id, name, yield_quantity, yield_unit
FROM recipes
WHERE id IN ('407621d0-e447-4347-ac7e-53f23ae3567d','f03713c8-dfb8-4685-8bfa-c7d4cfaf6178',
             'b03c5671-9eb2-4f94-a3c8-dd9f583512d5','1034b895-1330-42c3-be78-9370f128d751',
             '69299ebf-a058-477f-8ca3-8c48e4aeb74b','d1577f4a-7045-57e0-b6a4-dcf988255677')
ORDER BY name;

-- 1) Rendements fantômes -> kg. Garde "AND yield_unit='unit'" => idempotent.
UPDATE recipes SET yield_quantity = 0.731, yield_unit = 'kg'
  WHERE id = '407621d0-e447-4347-ac7e-53f23ae3567d' AND yield_unit = 'unit';
UPDATE recipes SET yield_quantity = 1.630, yield_unit = 'kg'
  WHERE id = 'f03713c8-dfb8-4685-8bfa-c7d4cfaf6178' AND yield_unit = 'unit';
UPDATE recipes SET yield_quantity = 0.655, yield_unit = 'kg'
  WHERE id = 'b03c5671-9eb2-4f94-a3c8-dd9f583512d5' AND yield_unit = 'unit';
UPDATE recipes SET yield_quantity = 0.444, yield_unit = 'kg'
  WHERE id = '1034b895-1330-42c3-be78-9370f128d751' AND yield_unit = 'unit';

-- 2) Fusion "Pate sucré" (69299ebf) -> "Pâte sucrée" (d1577f4a)
--    a) supprimer les liens qui collisionneraient avec l'unicité (recipe_id, sub_recipe_id)
DELETE FROM recipe_sub_recipes d
WHERE d.sub_recipe_id = '69299ebf-a058-477f-8ca3-8c48e4aeb74b'
  AND EXISTS (SELECT 1 FROM recipe_sub_recipes c
              WHERE c.recipe_id = d.recipe_id
                AND c.sub_recipe_id = 'd1577f4a-7045-57e0-b6a4-dcf988255677');
--    b) repointer les liens restants vers la pâte canonique
UPDATE recipe_sub_recipes
SET sub_recipe_id = 'd1577f4a-7045-57e0-b6a4-dcf988255677'
WHERE sub_recipe_id = '69299ebf-a058-477f-8ca3-8c48e4aeb74b';
--    c) supprimer la recette doublon (recipe_ingredients en cascade)
DELETE FROM recipes WHERE id = '69299ebf-a058-477f-8ca3-8c48e4aeb74b';

\echo '--- APRES (dans la transaction) ---'
SELECT id, name, yield_quantity, yield_unit
FROM recipes
WHERE id IN ('407621d0-e447-4347-ac7e-53f23ae3567d','f03713c8-dfb8-4685-8bfa-c7d4cfaf6178',
             'b03c5671-9eb2-4f94-a3c8-dd9f583512d5','1034b895-1330-42c3-be78-9370f128d751',
             'd1577f4a-7045-57e0-b6a4-dcf988255677')
ORDER BY name;

\echo '--- Verif : liens restants vers le doublon (doit etre 0) ---'
SELECT count(*) AS liens_vers_doublon
FROM recipe_sub_recipes WHERE sub_recipe_id = '69299ebf-a058-477f-8ca3-8c48e4aeb74b';

\if :apply
  COMMIT;
  \echo '>>> APPLIQUE (COMMIT).'
\else
  ROLLBACK;
  \echo '>>> DRY-RUN : rien modifie (ROLLBACK).'
\endif
