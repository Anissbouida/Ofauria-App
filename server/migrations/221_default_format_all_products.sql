-- Migration 221 : Garantir un format par défaut actif pour TOUS les produits
--
-- POURQUOI
--   La mig 218 n'a posé un format par défaut que pour les produits COMPOSÉS.
--   Les produits legacy (ratio_poids, ex. Brownie) peuvent avoir un format non
--   marqué is_default, ou aucun format. L'éditeur unifié et son fallback ont besoin
--   d'un format par défaut par produit pour : (a) afficher la compo legacy, (b)
--   resynchroniser recipe_components à la sauvegarde du format par défaut.
--
-- PORTÉE / NEUTRALITÉ
--   Ne touche QUE les drapeaux is_active / is_default des recipe_formats (pas la
--   composition ni les coûts) ⇒ v_recipe_total_cost inchangée. Idempotent.
--
-- INVERSION : remettre is_default/is_active manuellement (cosmétique).

-- A. Réactiver un format pour les produits sans AUCUN format actif (mais en ayant un).
UPDATE recipe_formats f SET is_active = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false
    AND NOT EXISTS (SELECT 1 FROM recipe_formats a WHERE a.recipe_id = x.recipe_id AND a.is_active)
  ORDER BY x.recipe_id, x.is_default DESC, x.ordre, x.created_at
);

-- B. Créer un format « Assemblage » pour les produits SANS aucun format.
INSERT INTO recipe_formats
  (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite,
   nb_par_defaut, is_default, ordre, is_active)
SELECT r.id, '11111111-1111-4111-8111-111111111111', 1, 'g',
       GREATEST(1, round(COALESCE(NULLIF(r.yield_quantity, 0), 1))::int), false, 0, true
FROM recipes r
WHERE r.is_base = false
  AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id);

-- C. Garantir UN is_default actif par produit.
UPDATE recipe_formats f SET is_default = false, updated_at = NOW()
WHERE f.is_default AND NOT f.is_active
  AND f.recipe_id IN (SELECT id FROM recipes WHERE is_base = false)
  AND NOT EXISTS (SELECT 1 FROM recipe_formats a
                  WHERE a.recipe_id = f.recipe_id AND a.is_active AND a.is_default);

UPDATE recipe_formats f SET is_default = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false AND x.is_active
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = x.recipe_id AND d.is_default)
  ORDER BY x.recipe_id, x.ordre, x.created_at
);
