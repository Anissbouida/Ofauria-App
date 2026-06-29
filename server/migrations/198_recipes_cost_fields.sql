-- Migration 198 : Perte standard + mode de coût sur les recettes
--
-- POURQUOI
--   perte_standard_pct : perte attendue d'une recette de base (ex : 8 % à la
--     cuisson/transfert). Sert à calculer un « rendement utilisable » et donc un
--     coût unitaire réaliste (coût / rendement utilisable, pas / rendement brut).
--   mode_cout : comment coûter un produit composé.
--     'ratio_poids' (défaut, comportement ACTUEL) → coût réparti au prorata du
--        poids entre formats (OK pour une pâte simple portionnée).
--     'compose' → coût = somme des composants de la nomenclature par format
--        (requis pour tartes/entremets, voir mig 200). Activé produit par produit.
--
-- PORTÉE
--   ALTER TABLE recipes : 2 colonnes nullable-safe avec DEFAULT.
--   Aucune recette existante ne change de comportement (défaut = ratio_poids).
--
-- INVERSION
--   ALTER TABLE recipes DROP COLUMN mode_cout, DROP COLUMN perte_standard_pct;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS perte_standard_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mode_cout VARCHAR(20) NOT NULL DEFAULT 'ratio_poids';

ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS chk_recipes_mode_cout;
ALTER TABLE recipes
  ADD CONSTRAINT chk_recipes_mode_cout CHECK (mode_cout IN ('ratio_poids', 'compose'));

ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS chk_recipes_perte_standard;
ALTER TABLE recipes
  ADD CONSTRAINT chk_recipes_perte_standard CHECK (perte_standard_pct >= 0 AND perte_standard_pct < 100);

COMMENT ON COLUMN recipes.perte_standard_pct IS 'Perte standard % → rendement utilisable = yield_quantity * (1 - perte/100)';
COMMENT ON COLUMN recipes.mode_cout IS 'ratio_poids (défaut) | compose (nomenclature par format, mig 200)';
