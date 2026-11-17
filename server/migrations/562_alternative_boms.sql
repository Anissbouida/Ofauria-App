-- M4-04 (plan d'action 2026-11) — plusieurs nomenclatures par article.
--
-- La fiche PAR DÉFAUT d'un produit reste celle liée par recipes.product_id (index unique
-- conservé : la trentaine de requêtes qui joignent « la » fiche d'un produit ne changent
-- pas et ne peuvent pas dupliquer de lignes). Une nomenclature supplémentaire est une
-- fiche rattachée au produit par alternative_for_product_id, avec son usage :
--   alternative    — autre façon de fabriquer (autre recette, autre équipement) ;
--   sous_traitance — fabrication confiée à un tiers.
-- Au lancement, une ligne d'ordre peut porter la fiche alternative choisie
-- (production_plan_items.alt_recipe_id) ; la confirmation calcule ses besoins dessus.
-- Point d'entrée unique côté serveur : services/recipe-for.ts (getRecipeFor).
--
-- INVERSION : ALTER TABLE production_plan_items DROP COLUMN alt_recipe_id;
--   ALTER TABLE recipes DROP COLUMN alternative_for_product_id, DROP COLUMN usage;
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS usage varchar(16) NOT NULL DEFAULT 'fabrication',
  ADD COLUMN IF NOT EXISTS alternative_for_product_id uuid REFERENCES products(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipes_usage') THEN
    ALTER TABLE recipes ADD CONSTRAINT chk_recipes_usage CHECK (usage IN ('fabrication', 'alternative', 'sous_traitance'));
  END IF;
  -- Une fiche alternative n'est pas la fiche par défaut d'un produit, et inversement.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recipes_alternative') THEN
    ALTER TABLE recipes ADD CONSTRAINT chk_recipes_alternative CHECK (
      (alternative_for_product_id IS NULL AND usage = 'fabrication')
      OR (alternative_for_product_id IS NOT NULL AND usage <> 'fabrication' AND product_id IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_recipes_alternative_for ON recipes (alternative_for_product_id) WHERE alternative_for_product_id IS NOT NULL;

ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS alt_recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL;
