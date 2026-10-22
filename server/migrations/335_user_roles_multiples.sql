-- ═══════════════════════════════════════════════════════════════════════
-- 335 — Rôles multiples par utilisateur (alignement ERP, Phase 1)
--   Jusqu'ici un utilisateur portait UN rôle (users.role). Les grands ERP
--   (Odoo, SAP, NetSuite, Dynamics) attachent PLUSIEURS rôles/groupes à un
--   utilisateur et appliquent l'UNION de leurs droits. On introduit cette
--   table de liaison tout en gardant users.role comme rôle PRINCIPAL
--   (celui qui porte le rôle de base dans le jeton, pour ne rien casser).
--
--   user_roles        : N-N utilisateur ↔ rôle. is_primary = le rôle repris
--                       dans users.role (périmètre technique du jeton).
--   Droits effectifs  : union des role_permissions de tous les rôles de
--                       l'utilisateur (le plus permissif gagne par
--                       module × action ; les verbes métier et la portée des
--                       données, stockés dans role_permissions.config, sont
--                       également fusionnés). Les exceptions par utilisateur
--                       (user_permissions) continuent, quand elles existent,
--                       de remplacer entièrement les droits du rôle.
--
--   Verbes métier (config.verbs) et portée des données (config.scope) :
--   stockés dans le JSONB `config` déjà présent sur role_permissions et
--   user_permissions — aucune colonne ajoutée. Voir shared/constants/modules.ts
--   (MODULE_VERBS, DATA_SCOPES) et services/access-rules.ts.
--
-- INVERSION
--   DROP TABLE user_roles ;  -- users.role reste la source mono-rôle.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code   VARCHAR(30) NOT NULL REFERENCES roles(code) ON UPDATE CASCADE ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_code)
);
COMMENT ON TABLE user_roles IS 'Rôles multiples par utilisateur (mig 335). is_primary = rôle repris dans users.role. Droits = union.';

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_code);
-- Un seul rôle principal par utilisateur.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_primary ON user_roles(user_id) WHERE is_primary;

-- Reprise : chaque utilisateur ayant déjà un rôle devient titulaire de ce rôle,
-- marqué principal. Rôle inconnu (ne référence pas roles) ignoré par la FK.
INSERT INTO user_roles (user_id, role_code, is_primary)
SELECT u.id, u.role, true
  FROM users u
  JOIN roles r ON r.code = u.role
 WHERE u.role IS NOT NULL
ON CONFLICT (user_id, role_code) DO NOTHING;

-- Journal du paramétrage (mig 328) : traçabilité des affectations de rôle.
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS user_roles_config_audit ON user_roles;
    CREATE TRIGGER user_roles_config_audit AFTER INSERT OR UPDATE OR DELETE ON user_roles
      FOR EACH ROW EXECUTE FUNCTION log_config_change('role_code', 'user_id');
  END IF;
END $$;
