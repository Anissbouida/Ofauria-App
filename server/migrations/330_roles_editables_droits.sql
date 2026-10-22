-- ═══════════════════════════════════════════════════════════════════════
-- 330 — Rôles éditables et droits appliqués côté serveur (audit Paramètres, lot 3)
--   Jusqu'ici les 9 rôles étaient une liste codée (contrainte users_role_check,
--   constante DEFAULT_ROLE_MODULES) et l'API ne vérifiait que le rôle : retirer
--   un module à un utilisateur masquait le menu sans bloquer les appels.
--
--   roles             : rôles système (les 9 existants) + rôles créés par
--                       l'administrateur. Un rôle créé s'appuie sur un rôle de
--                       base (système, hors admin) qui fixe son périmètre
--                       technique (routes accessibles, filtres magasin, catégories
--                       des chefs) ; ses droits par module sont les siens.
--   role_permissions  : droits par module du rôle (voir / créer / modifier /
--                       supprimer). Repris de DEFAULT_ROLE_MODULES avec les quatre
--                       droits, sauf Supprimer dans Personnel (déjà réservé) : la
--                       liste de rôles de chaque route continue de borner l'accès,
--                       l'administrateur retire ensuite ce qu'il veut.
--   Droits effectifs  : exceptions de l'utilisateur (user_permissions) si
--                       elles existent — elles remplacent alors celles du rôle,
--                       comme avant —, sinon droits du rôle.
--   company_settings.security_module_enforcement :
--       'log'     (défaut) les appels hors droits sont journalisés (Journal ›
--                 Connexions, « Accès hors droits ») mais pas bloqués ;
--       'enforce' ils sont refusés (403) ;
--       'off'     contrôle désactivé.
--   Passer en 'enforce' après une période d'observation sans refus inattendu.
--
-- INVERSION
--   ALTER TABLE users DROP CONSTRAINT users_role_fkey ; recréer users_role_check ;
--   ALTER TABLE company_settings DROP COLUMN security_module_enforcement ;
--   DROP TABLE role_permissions, roles.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS roles (
  code         VARCHAR(30) PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  label        VARCHAR(60) NOT NULL,
  description  TEXT,
  base_role    VARCHAR(30) NOT NULL CHECK (base_role IN
                 ('admin', 'manager', 'cashier', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale', 'saleswoman', 'magasinier')),
  is_system    BOOLEAN NOT NULL DEFAULT false,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Un rôle système est son propre rôle de base ; un rôle créé ne peut pas hériter d'admin.
  CONSTRAINT roles_base_coherent CHECK (
    (is_system AND base_role = code) OR (NOT is_system AND base_role <> 'admin'))
);
COMMENT ON TABLE roles IS 'Rôles utilisateurs : 9 rôles système + rôles créés (mig 330). base_role = périmètre technique.';

INSERT INTO roles (code, label, base_role, is_system) VALUES
  ('admin',        'Administrateur', 'admin',        true),
  ('manager',      'Gérant',         'manager',      true),
  ('cashier',      'Caissier',       'cashier',      true),
  ('saleswoman',   'Vendeuse',       'saleswoman',   true),
  ('baker',        'Boulanger',      'baker',        true),
  ('pastry_chef',  'Pâtissier',      'pastry_chef',  true),
  ('viennoiserie', 'Viennoiserie',   'viennoiserie', true),
  ('beldi_sale',   'Beldi & Salé',   'beldi_sale',   true),
  ('magasinier',   'Magasinier',     'magasinier',   true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code   VARCHAR(30) NOT NULL REFERENCES roles(code) ON DELETE CASCADE ON UPDATE CASCADE,
  module      VARCHAR(50) NOT NULL,
  can_view    BOOLEAN NOT NULL DEFAULT false,
  can_create  BOOLEAN NOT NULL DEFAULT false,
  can_edit    BOOLEAN NOT NULL DEFAULT false,
  can_delete  BOOLEAN NOT NULL DEFAULT false,
  config      JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (role_code, module)
);
COMMENT ON TABLE role_permissions IS 'Droits par module des rôles (mig 330). L''administrateur a tous les droits sans ligne.';

-- Reprise de DEFAULT_ROLE_MODULES (shared/src/constants/modules.ts).
INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete)
SELECT r.code, m.module, true, true, true, (m.module <> 'employees')
  FROM (VALUES
    ('manager',      ARRAY['dashboard','pos','sales','orders','products','customers','stock','recipes','production','employees','accounting','purchasing','reports','replenishment','unsold','packaging','reconciliation','controle']),
    ('cashier',      ARRAY['pos','orders','customers','production','replenishment','unsold']),
    ('saleswoman',   ARRAY['pos','orders','customers','production','replenishment','unsold']),
    ('baker',        ARRAY['stock','recipes','production','replenishment','packaging']),
    ('pastry_chef',  ARRAY['stock','recipes','production','replenishment','packaging']),
    ('viennoiserie', ARRAY['stock','recipes','production','replenishment','packaging']),
    ('beldi_sale',   ARRAY['stock','recipes','production','replenishment','packaging']),
    ('magasinier',   ARRAY['stock','replenishment','packaging'])
  ) AS d(role, modules)
  JOIN roles r ON r.code = d.role
  CROSS JOIN LATERAL unnest(d.modules) AS m(module)
ON CONFLICT (role_code, module) DO NOTHING;

-- Le rôle d'un utilisateur doit exister (remplace la liste figée).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
-- Codes de rôle jusqu'à 30 caractères (la colonne en acceptait 20).
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(30);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_fkey
      FOREIGN KEY (role) REFERENCES roles(code) ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS security_module_enforcement VARCHAR(10) NOT NULL DEFAULT 'log';
ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_security_enforcement_check;
ALTER TABLE company_settings ADD CONSTRAINT company_settings_security_enforcement_check
  CHECK (security_module_enforcement IN ('off', 'log', 'enforce'));

-- Journal du paramétrage (mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS roles_config_audit ON roles;
    CREATE TRIGGER roles_config_audit AFTER INSERT OR UPDATE OR DELETE ON roles
      FOR EACH ROW EXECUTE FUNCTION log_config_change('code', '');
    DROP TRIGGER IF EXISTS role_permissions_config_audit ON role_permissions;
    CREATE TRIGGER role_permissions_config_audit AFTER INSERT OR UPDATE OR DELETE ON role_permissions
      FOR EACH ROW EXECUTE FUNCTION log_config_change('module', 'role_code');
  END IF;
END $$;
