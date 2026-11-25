-- Refonte Utilisateurs, lot 6 : exceptions individuelles qui s'ajoutent aux rôles.
--
-- Avant : les droits propres d'un compte (user_permissions) REMPLAÇAIENT tous les droits de ses
-- rôles, et le changement de rôle principal les effaçait.
-- Désormais : chaque ligne de user_permissions est une exception sur UN module. Elle remplace les
-- droits des rôles pour ce module seulement (accorder plus, retirer, ou ne plus donner accès) ; les
-- autres modules suivent les rôles. Les exceptions sur une action précise (user_action_permissions,
-- mig 547) gardent leur sens : accordée ou retirée, prioritaire sur les rôles.
-- Toute exception porte un motif et, au choix, une date de fin (incluse) ; passé ce jour, elle ne
-- compte plus et reste visible comme expirée.
--
-- Reprise : pour qu'aucun droit effectif ne change, un compte qui avait des droits propres reçoit
-- une exception « sans accès » pour chaque module que ses rôles donnent et que ses droits propres
-- ne listaient pas.
--
-- INVERSION : ALTER TABLE user_permissions DROP COLUMN reason, DROP COLUMN ends_on,
--   DROP COLUMN updated_by, DROP COLUMN updated_at ; ALTER TABLE user_action_permissions
--   DROP COLUMN ends_on ; supprimer les lignes reprises (reason LIKE 'Reprise :%').

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS reason     text,
  ADD COLUMN IF NOT EXISTS ends_on    date,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN user_permissions.reason  IS 'Motif de l''exception individuelle (lot 6).';
COMMENT ON COLUMN user_permissions.ends_on IS 'Dernier jour où l''exception compte ; null = sans fin (lot 6).';

ALTER TABLE user_action_permissions ADD COLUMN IF NOT EXISTS ends_on date;
COMMENT ON COLUMN user_action_permissions.ends_on IS 'Dernier jour où l''exception compte ; null = sans fin (lot 6).';

-- Reprise des droits propres existants (comptes non administrateurs).
WITH owners AS (
  SELECT DISTINCT up.user_id FROM user_permissions up
  JOIN users u ON u.id = up.user_id
),
user_role_codes AS (
  SELECT o.user_id, ur.role_code FROM owners o JOIN user_roles ur ON ur.user_id = o.user_id
  UNION
  SELECT o.user_id, u.role FROM owners o JOIN users u ON u.id = o.user_id
   WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = o.user_id)
),
not_admin AS (
  SELECT o.user_id FROM owners o
   WHERE NOT EXISTS (SELECT 1 FROM user_role_codes c JOIN roles r ON r.code = c.role_code
                      WHERE c.user_id = o.user_id AND r.base_role = 'admin')
)
INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config, reason)
SELECT DISTINCT c.user_id, rp.module, false, false, false, false, '{}'::jsonb,
       'Reprise : module absent des anciens droits propres'
  FROM user_role_codes c
  JOIN not_admin n ON n.user_id = c.user_id
  JOIN role_permissions rp ON rp.role_code = c.role_code
 WHERE (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete)
   AND NOT EXISTS (SELECT 1 FROM user_permissions x WHERE x.user_id = c.user_id AND x.module = rp.module)
ON CONFLICT (user_id, module) DO NOTHING;

UPDATE user_permissions SET reason = 'Reprise : anciens droits propres' WHERE reason IS NULL;
UPDATE user_action_permissions SET reason = 'Reprise : exception existante' WHERE reason IS NULL OR btrim(reason) = '';
