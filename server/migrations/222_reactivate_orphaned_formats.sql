-- Migration 222 : Réparer les produits dont TOUS les formats sont inactifs
--
-- POURQUOI
--   Une ancienne sauvegarde « Mettre à jour » du formulaire envoyait une liste de
--   formats vide → soft-delete (is_active=false) de tous les formats de la recette.
--   Résultat : l'éditeur par format affiche « Aucun format » et la compo (legacy ou
--   composée) n'est plus visible. Le code corrigé n'envoie plus de formats en édition
--   unifiée ; cette migration répare l'état existant.
--
-- PORTÉE / NEUTRALITÉ
--   Réactive un format (préférence : is_default, sinon 1er par ordre) pour les produits
--   sans aucun format actif, et garantit un is_default actif. Ne touche que les drapeaux
--   is_active/is_default ⇒ coûts inchangés. Idempotent.

-- A. Réactiver un format pour les produits sans AUCUN format actif (mais en ayant un).
UPDATE recipe_formats f SET is_active = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false
    AND NOT EXISTS (SELECT 1 FROM recipe_formats a WHERE a.recipe_id = x.recipe_id AND a.is_active)
  ORDER BY x.recipe_id, x.is_default DESC, x.ordre, x.created_at
);

-- B. Garantir UN is_default actif par produit (si le défaut réactivé l'est déjà, rien).
UPDATE recipe_formats f SET is_default = true, updated_at = NOW()
WHERE f.id IN (
  SELECT DISTINCT ON (x.recipe_id) x.id
  FROM recipe_formats x JOIN recipes r ON r.id = x.recipe_id
  WHERE r.is_base = false AND x.is_active
    AND NOT EXISTS (SELECT 1 FROM recipe_formats d WHERE d.recipe_id = x.recipe_id AND d.is_default AND d.is_active)
  ORDER BY x.recipe_id, x.ordre, x.created_at
);
