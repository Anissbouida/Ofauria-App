-- 623 — Le gérant archive et restaure les fiches techniques (scénario 1, constat 111).
--
-- POURQUOI
--   Archiver et restaurer une fiche étaient réservés à l'administrateur : le gérant voyait
--   les boutons et recevait un refus (403) sans message. Archiver n'efface rien (la fiche
--   reste restaurable) : c'est un geste de gestion courante du catalogue de fiches.
--
-- CE QUI CHANGE
--   Les clés recipes.delete (archiver une fiche, DELETE /recipes/:id), recipes.bulk_archive,
--   recipes.restore et recipes.bulk_restore passent aux rôles bâtis sur le rôle de base
--   « gérant » (defaultRoles mis à jour dans shared PERMISSIONS ; ces clés déjà amorcées ne
--   sont pas réécrites par l'amorçage, d'où cette reprise). La suppression définitive
--   (recipes.bulk_delete) reste à l'administrateur. Réglable dans Utilisateurs › Rôles.
--
-- INVERSION
--   Retirer ces quatre clés de role_action_permissions pour les rôles de base « manager ».

INSERT INTO role_action_permissions (role_code, permission_key)
SELECT r.code, k.key
  FROM roles r
 CROSS JOIN unnest(ARRAY['recipes.delete', 'recipes.bulk_archive', 'recipes.restore', 'recipes.bulk_restore']) AS k(key)
 WHERE r.base_role = 'manager'
ON CONFLICT DO NOTHING;
