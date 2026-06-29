-- Migration 199 : Format par défaut + parts + poids cru/cuit sur recipe_formats
--
-- POURQUOI
--   is_default   : un format « canonique » par recette, qui remplace le legacy
--                  recipes.contenant_id pour le calcul inverse (sourcing). Un seul
--                  par recette (index unique partiel).
--   nb_parts     : nombre de parts théoriques (vente à la part) → coût/part,
--                  prix/part = coût|prix complet / nb_parts.
--   poids_cru_g  : poids de pâte/appareil cru engagé pour ce format (fond).
--   poids_cuit_g : poids estimé après cuisson → perte cuisson = (cru-cuit)/cru.
--
-- PORTÉE
--   ALTER TABLE recipe_formats : 4 colonnes (is_default défaut false, le reste
--   nullable) + 1 index unique partiel. Aucune donnée existante modifiée
--   (is_default sera positionné par le backfill, mig 201).
--
-- INVERSION
--   DROP INDEX uq_recipe_formats_default;
--   ALTER TABLE recipe_formats DROP COLUMN is_default, DROP COLUMN nb_parts,
--     DROP COLUMN poids_cru_g, DROP COLUMN poids_cuit_g;

ALTER TABLE recipe_formats
  ADD COLUMN IF NOT EXISTS is_default   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nb_parts     INTEGER,
  ADD COLUMN IF NOT EXISTS poids_cru_g  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS poids_cuit_g NUMERIC(10,2);

-- Un seul format par défaut par recette.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_formats_default
  ON recipe_formats (recipe_id)
  WHERE is_default;

ALTER TABLE recipe_formats
  DROP CONSTRAINT IF EXISTS chk_recipe_formats_nb_parts;
ALTER TABLE recipe_formats
  ADD CONSTRAINT chk_recipe_formats_nb_parts CHECK (nb_parts IS NULL OR nb_parts > 0);

COMMENT ON COLUMN recipe_formats.is_default IS 'Format canonique de la recette (remplace legacy recipes.contenant_id)';
COMMENT ON COLUMN recipe_formats.nb_parts IS 'Nombre de parts théoriques (vente à la part)';
