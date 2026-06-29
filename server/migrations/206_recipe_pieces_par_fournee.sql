-- Migration 206 : Pièces par fournée (taille de lot de production)
--
-- POURQUOI
--   Modèle confirmé par les fiches chef : la composition est PAR PIÈCE
--   (ex. « Mousse Citron 70 g par unité »). Le coût total recette = coût d'1 pièce
--   (yield_quantity reste à 1 unité). On stocke à part combien de pièces produit
--   UNE fournée (« Total = 42 P »), pour la planification de production — sans
--   impacter le coût/pièce.
--
-- PORTÉE
--   ALTER TABLE recipes ADD pieces_par_fournee (nullable). Aucune donnée modifiée.
--
-- INVERSION : ALTER TABLE recipes DROP COLUMN pieces_par_fournee;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS pieces_par_fournee INTEGER;

ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS chk_recipes_pieces_par_fournee;
ALTER TABLE recipes
  ADD CONSTRAINT chk_recipes_pieces_par_fournee CHECK (pieces_par_fournee IS NULL OR pieces_par_fournee > 0);

COMMENT ON COLUMN recipes.pieces_par_fournee IS 'Nb de pièces produites par une fournée (production). La compo reste PAR PIÈCE.';
