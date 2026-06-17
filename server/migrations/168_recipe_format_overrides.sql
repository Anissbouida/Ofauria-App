-- Migration 168 : Overrides prix et marge par format.
--
-- Aujourd'hui la vue v_recipe_format_cost calcule :
--   prix_vente_unitaire = cout_unitaire_complet × recipes.margin_multiplier
--
-- Donc TOUS les formats d'une meme recette ont la meme marge. Un cake 300g et
-- un cake 600g auront leur prix proportionnel au poids, sans flexibilite.
--
-- Ces 2 colonnes permettent de :
--   - Fixer un prix specifique par format (ex: "300g a 50 DH pile", peu importe
--     ce que dit le calcul) -> prix_vente_unitaire_override
--   - Ajuster la marge UNIQUEMENT pour ce format (ex: marge plus haute sur
--     le 300g pour absorber un cout d'emballage premium) -> margin_multiplier_override
--
-- Les 2 sont NULLABLES. Si renseignes, la vue v3 les utilise via COALESCE.

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS prix_vente_unitaire_override DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS margin_multiplier_override DECIMAL(6,3) NULL;

COMMENT ON COLUMN recipe_formats.prix_vente_unitaire_override IS
  'Prix de vente force pour ce format. Si renseigne, prime sur le calcul auto cout × marge. Nullable.';
COMMENT ON COLUMN recipe_formats.margin_multiplier_override IS
  'Marge specifique a ce format (multiplicateur). Si renseigne, remplace recipes.margin_multiplier dans le calcul du prix. Ignore si prix_vente_unitaire_override est renseigne. Nullable.';
