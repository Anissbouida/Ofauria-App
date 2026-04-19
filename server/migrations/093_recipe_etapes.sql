-- Déplacer les étapes de production du contenant vers la recette
-- Les étapes sont propres à la recette, pas au contenant physique

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS etapes JSONB NOT NULL DEFAULT '[]';

-- Migrer les étapes existantes : copier etapes_defaut du contenant vers chaque recette liée
UPDATE recipes r
SET etapes = pc.etapes_defaut
FROM production_contenants pc
WHERE r.contenant_id = pc.id
  AND pc.etapes_defaut IS NOT NULL
  AND pc.etapes_defaut != '[]'::jsonb;
