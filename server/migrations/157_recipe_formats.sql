-- Migration 157 : recipe_formats — Multi-formats de production par recette
--
-- Probleme : recipes.contenant_id est 1:1. Une recette de pate produit pourtant
-- souvent plusieurs formats simultanement (ex: Cake Nature -> 3 moules moyens
-- 600g + 3 petits 300g). Impossible aujourd'hui d'avoir un cout par format
-- et donc un prix de vente correct par format.
--
-- Solution : table pivot recipe_formats (recipe -> N contenants). Chaque ligne
-- decrit un format produit avec son poids de pate et son nombre attendu.
-- recipes.contenant_id n'est pas supprime — conserve pour compat descendante
-- (UI legacy, exports xlsx). Sera retire dans une migration future une fois
-- que tout le code lit via recipe_formats.
--
-- Auto-migration : pour chaque recette existante ayant un contenant_id non
-- null, on cree une ligne recipe_formats unique qui preserve exactement le
-- calcul de cout actuel. La cle UNIQUE (recipe_id, contenant_id) empeche les
-- doublons en cas de re-lancement.

CREATE TABLE IF NOT EXISTS recipe_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  contenant_id UUID NOT NULL REFERENCES production_contenants(id) ON DELETE RESTRICT,
  -- Poids de pate consomme par 1 unite de ce format, en grammes
  quantite_par_format_g DECIMAL(10,2) NOT NULL CHECK (quantite_par_format_g > 0),
  -- Nombre de formats produits par defaut sur une fournee standard
  nb_par_defaut INT NOT NULL DEFAULT 1 CHECK (nb_par_defaut > 0),
  -- Cout emballage unitaire (DH/unite), optionnel
  cout_emballage_unitaire DECIMAL(10,4) NOT NULL DEFAULT 0,
  -- Ordre d'affichage dans l'UI
  ordre INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (recipe_id, contenant_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_formats_recipe ON recipe_formats(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_formats_contenant ON recipe_formats(contenant_id);

COMMENT ON TABLE recipe_formats IS
  'Formats produits par une recette. Remplace la relation 1:1 recipes.contenant_id (toujours present mais deprecated).';
COMMENT ON COLUMN recipe_formats.quantite_par_format_g IS
  'Poids de pate consomme par 1 unite de ce format, en grammes (ex: 600 pour un moule cake moyen).';
COMMENT ON COLUMN recipe_formats.nb_par_defaut IS
  'Nombre de formats produits par defaut sur une fournee standard (la fournee reelle peut overrider).';

-- Auto-migration : transfert des contenants existants vers recipe_formats.
-- Le couple (poids_par_format, nb_par_defaut) est calcule pour preserver
-- exactement le cout/unite actuel. Le chef ajustera apres pour le multi-format.
INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format_g, nb_par_defaut, ordre)
SELECT r.id,
       r.contenant_id,
       -- Poids par format : on prend le poids_total_recette / yield_quantity, en g.
       -- Si poids non calculable (recettes sans ingredients ponderables) -> 1000g par defaut.
       GREATEST(
         1,
         COALESCE(
           ROUND((vtw.total_weight_kg * 1000.0) / NULLIF(r.yield_quantity, 0), 2),
           1000
         )
       ),
       -- nb_par_defaut : entier le plus proche du yield_quantity, min 1.
       GREATEST(1, ROUND(r.yield_quantity)::INT),
       0
FROM recipes r
LEFT JOIN v_recipe_total_weight_kg vtw ON vtw.id = r.id
WHERE r.contenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM recipe_formats rf WHERE rf.recipe_id = r.id AND rf.contenant_id = r.contenant_id)
ON CONFLICT DO NOTHING;
