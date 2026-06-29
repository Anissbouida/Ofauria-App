-- Migration 201 : Backfill d'un format par défaut sur les produits assemblés
--
-- POURQUOI
--   La nomenclature (mig 200) s'accroche à un FORMAT. Les produits composés
--   existants n'ont (pour 24/26) aucun format. On leur crée un format par défaut
--   « format actuel » qui servira de point d'ancrage à la reprise (mig 202).
--   recipe_formats.contenant_id étant NOT NULL, on introduit un contenant
--   générique « Assemblage (format à définir) » que l'atelier précisera ensuite
--   (Ø16, cadre, à la part…).
--
-- PORTÉE
--   (a) 1 contenant générique (idempotent, id fixe).
--   (b) marque is_default sur le format existant (ordre min) des produits qui en
--       ont déjà un (ex : Brownie, OFAURIA) — sans en créer.
--   (c) crée un format par défaut (placeholder quantite=1 g, affiné en mig 202)
--       pour les produits assemblés sans aucun format.
--   Idempotent : ON CONFLICT + gardes NOT EXISTS.
--
-- INVERSION
--   DELETE FROM recipe_formats WHERE contenant_id = '11111111-1111-4111-8111-111111111111';
--   UPDATE recipe_formats SET is_default = false WHERE is_default;  -- selon besoin
--   DELETE FROM production_contenants WHERE id = '11111111-1111-4111-8111-111111111111';

-- (a) contenant générique
INSERT INTO production_contenants (id, nom, type_production, unite_lancement, is_active)
VALUES ('11111111-1111-4111-8111-111111111111', 'Assemblage (format à définir)', 3, 'unit', true)
ON CONFLICT (id) DO NOTHING;

-- (b) produits assemblés AVEC un format existant → marquer le format d'ordre min comme défaut
WITH cand AS (
  SELECT DISTINCT ON (f.recipe_id) f.id
  FROM recipe_formats f
  JOIN recipes p ON p.id = f.recipe_id
  WHERE f.is_active
    AND p.product_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM recipe_sub_recipes s WHERE s.recipe_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = f.recipe_id AND d.is_default)
  ORDER BY f.recipe_id, f.ordre, f.created_at
)
UPDATE recipe_formats SET is_default = true WHERE id IN (SELECT id FROM cand);

-- (c) produits assemblés SANS aucun format → créer un format par défaut générique
INSERT INTO recipe_formats
  (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite, nb_par_defaut, is_default, ordre, is_active)
SELECT p.id, '11111111-1111-4111-8111-111111111111', 1, 'g', 1, true, 0, true
FROM recipes p
WHERE p.product_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM recipe_sub_recipes s WHERE s.recipe_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = p.id)
ON CONFLICT (recipe_id, contenant_id) DO NOTHING;
