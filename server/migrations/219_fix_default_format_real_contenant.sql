-- Migration 219 : Préférer un contenant RÉEL au placeholder « Assemblage » pour le défaut
--
-- POURQUOI
--   Après mig 218, certaines recettes (ex. Amandine) ont gardé comme format par
--   défaut un placeholder « Assemblage (format à définir) » (rendement 1) alors
--   qu'un format à contenant réel existe (ex. Cadre 40×60, rendement 50). On bascule
--   le défaut sur le contenant réel et on resynchronise sa BOM = recipe_components.
--
-- PORTÉE
--   Seulement les composés dont le défaut est « Assemblage » ET qui ont un autre
--   format à contenant réel. Cost-neutral (recipe_components inchangé).
--
-- INVERSION : repositionner is_default sur l'Assemblage.

-- Désactiver le défaut Assemblage là où un contenant réel existe.
UPDATE recipe_formats f SET is_default = false, is_active = false, updated_at = NOW()
WHERE f.is_default
  AND f.contenant_id = '11111111-1111-4111-8111-111111111111'
  AND f.recipe_id IN (SELECT id FROM recipes WHERE is_base = false AND mode_cout = 'compose')
  AND EXISTS (
    SELECT 1 FROM recipe_formats o JOIN production_contenants opc ON opc.id = o.contenant_id
    WHERE o.recipe_id = f.recipe_id AND opc.nom NOT ILIKE '%assemblage%'
  );

-- Promouvoir le 1er format à contenant réel comme défaut actif.
UPDATE recipe_formats f SET is_default = true, is_active = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (o.recipe_id) o.id
  FROM recipe_formats o
  JOIN production_contenants opc ON opc.id = o.contenant_id
  JOIN recipes r ON r.id = o.recipe_id
  WHERE r.is_base = false AND r.mode_cout = 'compose'
    AND opc.nom NOT ILIKE '%assemblage%'
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = o.recipe_id AND d.is_default)
  ORDER BY o.recipe_id, o.ordre, o.created_at
);

-- Re-synchroniser la BOM du format par défaut = recipe_components.
DELETE FROM recipe_format_components c
USING recipe_formats f
WHERE c.format_id = f.id AND f.is_default
  AND f.recipe_id IN (SELECT id FROM recipes WHERE is_base = false AND mode_cout = 'compose');

INSERT INTO recipe_format_components
  (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre)
SELECT f.id, rc.role, rc.source_recipe_id, rc.source_ingredient_id, rc.quantite, rc.unite, rc.ordre
FROM recipe_components rc
JOIN recipe_formats f ON f.recipe_id = rc.recipe_id AND f.is_default
JOIN recipes r ON r.id = rc.recipe_id
WHERE r.is_base = false AND r.mode_cout = 'compose';
