-- Migration 223 : Re-réparer les produits dont tous les formats sont inactifs
--
-- POURQUOI
--   Même symptôme que mig 222 (Brownie) réapparu sur d'autres produits (ex. Amandine) :
--   une sauvegarde a désactivé tous les formats (branche « formats vide → tout désactiver »
--   de update, désormais supprimée). On répare l'état courant.
--
-- PORTÉE / NEUTRALITÉ : réactive un format par défaut (préférence is_default) pour les
--   produits sans aucun format actif. Drapeaux uniquement ⇒ coûts inchangés. Idempotent.

UPDATE recipe_formats f SET is_active = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false
    AND NOT EXISTS (SELECT 1 FROM recipe_formats a WHERE a.recipe_id = x.recipe_id AND a.is_active)
  ORDER BY x.recipe_id, x.is_default DESC, x.ordre, x.created_at
);

UPDATE recipe_formats f SET is_default = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false AND x.is_active
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = x.recipe_id AND d.is_default AND d.is_active)
  ORDER BY x.recipe_id, x.ordre, x.created_at
);
