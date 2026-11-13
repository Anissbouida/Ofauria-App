-- 509 — Diffusion des modules : par établissement et en pilote (plan Production
-- générique, lot P0c).
--
-- Au-dessus des modules effectifs de la société (mig 507) :
--   * PILOTE : un module actif n'est visible que des rôles et utilisateurs listés
--     (le temps de le tester), puis on l'ouvre à tous d'un clic ;
--   * PAR ÉTABLISSEMENT : un module actif peut être fermé pour certains
--     établissements (le labo a Production, la boutique non). Seuls les modules
--     déclarés « par établissement » dans shared (module-activation.ts) s'y prêtent.
-- Le module reste actif pour la société : ses données ne bougent pas.
--
-- Additif. Retour arrière : DROP TABLE store_module_settings, module_pilot_members,
-- company_module_pilots.

CREATE TABLE IF NOT EXISTS company_module_pilots (
  module_key  VARCHAR(40) PRIMARY KEY,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS module_pilot_members (
  id          BIGSERIAL PRIMARY KEY,
  module_key  VARCHAR(40) NOT NULL REFERENCES company_module_pilots(module_key) ON DELETE CASCADE,
  role_code   VARCHAR(30) REFERENCES roles(code) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_pilot_member_one CHECK ((role_code IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pilot_member_role ON module_pilot_members (module_key, role_code) WHERE role_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pilot_member_user ON module_pilot_members (module_key, user_id) WHERE user_id IS NOT NULL;

-- Une ligne = module FERMÉ pour cet établissement.
CREATE TABLE IF NOT EXISTS store_module_settings (
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  module_key  VARCHAR(40) NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, module_key)
);

-- Journal du paramétrage (mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS company_module_pilots_config_audit ON company_module_pilots;
    CREATE TRIGGER company_module_pilots_config_audit AFTER INSERT OR UPDATE OR DELETE ON company_module_pilots
      FOR EACH ROW EXECUTE FUNCTION log_config_change('module_key', '');
    DROP TRIGGER IF EXISTS module_pilot_members_config_audit ON module_pilot_members;
    CREATE TRIGGER module_pilot_members_config_audit AFTER INSERT OR UPDATE OR DELETE ON module_pilot_members
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'module_key');
    DROP TRIGGER IF EXISTS store_module_settings_config_audit ON store_module_settings;
    CREATE TRIGGER store_module_settings_config_audit AFTER INSERT OR UPDATE OR DELETE ON store_module_settings
      FOR EACH ROW EXECUTE FUNCTION log_config_change('module_key', 'store_id');
  END IF;
END $$;
