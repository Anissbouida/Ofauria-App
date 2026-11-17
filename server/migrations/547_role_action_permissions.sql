-- M2-04 (plan d'action 2026-11) — référentiel des permissions par action.
--
-- Les routes passent de authorize(...groupes de rôles en dur) à can('clé') :
-- la décision vient de la base, rôle par rôle, et se règle depuis l'écran des rôles.
--
--   role_action_permissions   : le rôle détient la clé (présence de la ligne).
--   user_action_permissions   : exception pour un utilisateur (accordée ou retirée),
--                               prioritaire sur ses rôles.
--   permission_seeded_keys    : clés déjà amorcées. Une clé du référentiel
--                               (shared/src/constants/permissions.ts) absente d'ici est
--                               amorcée par le serveur (services/permissions.ts) : chaque
--                               rôle dont le rôle de base figure dans ses defaultRoles la
--                               reçoit — exactement les rôles que la garde authorize(...)
--                               d'origine acceptait. Une clé amorcée n'est plus jamais
--                               réécrite : un retrait fait depuis l'écran des rôles tient.
--
-- Les clés ne sont pas contraintes par une clé étrangère : le référentiel vit dans le
-- code (comme les modules de role_permissions).
--
-- INVERSION : DROP TABLE user_action_permissions, role_action_permissions, permission_seeded_keys;
CREATE TABLE IF NOT EXISTS role_action_permissions (
  role_code      varchar(30)  NOT NULL REFERENCES roles(code) ON UPDATE CASCADE ON DELETE CASCADE,
  permission_key varchar(120) NOT NULL,
  granted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_action_permissions_key ON role_action_permissions (permission_key);

CREATE TABLE IF NOT EXISTS user_action_permissions (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key varchar(120) NOT NULL,
  granted        boolean NOT NULL,
  reason         text,
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS permission_seeded_keys (
  permission_key varchar(120) PRIMARY KEY,
  seeded_at      timestamptz NOT NULL DEFAULT now()
);
