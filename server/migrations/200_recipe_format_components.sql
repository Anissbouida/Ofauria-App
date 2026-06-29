-- Migration 200 : Nomenclature par format (recipe_format_components)
--
-- POURQUOI
--   LA pièce maîtresse. Pour un produit composé, chaque FORMAT a sa propre
--   composition : quantité de chaque composant (recette de base OU ingrédient
--   direct), avec son rôle. Remplace la répartition au prorata du poids, fausse
--   pour un assemblage (une tartelette n'est pas une Ø28 réduite).
--   Le coût en mode 'compose' = somme de ces composants + emballage + indirects.
--
-- PORTÉE
--   Nouvelle table. Un composant pointe vers UNE recette de base OU UN ingrédient
--   (jamais les deux : contrainte chk_rfc_one_source). Le rôle référence (souplement,
--   comme partout) ref_entries(code) où table_id='component_roles' (mig 197).
--   Aucune donnée existante modifiée. La reprise des liens recipe_sub_recipes
--   existants se fera en mig 202.
--
-- INVERSION
--   DROP TABLE recipe_format_components;

CREATE TABLE IF NOT EXISTS recipe_format_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format_id            UUID NOT NULL REFERENCES recipe_formats(id) ON DELETE CASCADE,
  role                 VARCHAR(60),
  source_recipe_id     UUID REFERENCES recipes(id)     ON DELETE RESTRICT,
  source_ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantite             NUMERIC(12,4) NOT NULL,
  unite                VARCHAR(10)   NOT NULL DEFAULT 'g',
  ordre                SMALLINT      NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_rfc_one_source CHECK (
    (source_recipe_id IS NOT NULL)::int + (source_ingredient_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT chk_rfc_quantite CHECK (quantite > 0)
);

CREATE INDEX IF NOT EXISTS idx_rfc_format     ON recipe_format_components (format_id);
CREATE INDEX IF NOT EXISTS idx_rfc_src_recipe ON recipe_format_components (source_recipe_id);
CREATE INDEX IF NOT EXISTS idx_rfc_src_ingr   ON recipe_format_components (source_ingredient_id);

COMMENT ON TABLE recipe_format_components IS 'Nomenclature (BOM) par format d''un produit composé — mode_cout=compose';
COMMENT ON COLUMN recipe_format_components.role IS 'ref_entries.code (table_id=component_roles, mig 197)';
