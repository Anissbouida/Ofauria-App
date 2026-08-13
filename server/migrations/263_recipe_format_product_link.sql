-- Migration 263 : Lien optionnel format de recette -> produit vendu (audit A1, P0)
--
-- POURQUOI
--   recipe_formats n'a aujourd'hui AUCUN lien vers products. Le prix calcule par
--   v_recipe_format_cost.prix_vente_unitaire est purement indicatif : rien ne
--   garantit qu'il correspond au prix pratique au POS. Deux referentiels (le
--   theorique et le POS) peuvent diverger silencieusement.
--
--   Un cake « format Ø22 » et un cake « format Ø16 » sont deux articles POS
--   distincts qui partagent la meme recette. Or recipes.product_id est UNIQUE
--   (mig 020 : 1 recette <-> 1 produit max) : on ne peut y lier qu'un seul des
--   deux formats. Le lien doit donc vivre au niveau du FORMAT.
--
--   Cette migration ajoute product_id NULLABLE sur recipe_formats. Elle ne cree
--   AUCUN lien : la valeur reste NULL partout, le comportement actuel est
--   preserve. L'attribution se fait ensuite depuis l'UI, produit par produit.
--
--   Regles :
--     - un produit ne peut etre lie qu'a UN SEUL format actif (sinon quel prix
--       comparer ?) : index unique partiel WHERE product_id IS NOT NULL AND is_active ;
--     - suppression d'un produit -> SET NULL (on ne detruit pas la definition
--       du format, on defait juste le lien).
--
-- PORTEE
--   ALTER TABLE recipe_formats : 1 colonne. Aucune donnee modifiee.
--
-- INVERSION
--   ALTER TABLE recipe_formats DROP COLUMN product_id ;
--   (DROP CASCADE l'index unique partiel).

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_formats_product
  ON recipe_formats (product_id)
  WHERE product_id IS NOT NULL AND is_active;

CREATE INDEX IF NOT EXISTS idx_recipe_formats_product
  ON recipe_formats (product_id)
  WHERE product_id IS NOT NULL;

COMMENT ON COLUMN recipe_formats.product_id IS
  'Produit vendu au POS pour ce format (audit A1). NULL = non attribue, le prix pratique reste inconnu du systeme. Un produit ne peut etre lie qu''a un seul format actif.';
