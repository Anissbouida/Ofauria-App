-- Refonte Utilisateurs, lot 7 : plusieurs établissements par compte.
--
-- user_stores : établissements auxquels un compte a accès, dont un « par défaut ». users.store_id
-- reste l'établissement par défaut (celui de la connexion) ; un déclencheur garde les deux
-- d'accord, si bien que tout code qui écrit users.store_id (création, fiche) reste juste.
-- L'établissement ACTIF est porté par le jeton de connexion : la personne bascule entre ses
-- établissements depuis la barre du haut (POST /api/auth/active-store), et la portée
-- « Son établissement » se lit sur l'établissement actif.
--
-- INVERSION : DROP TRIGGER trg_user_default_store_sync ON users ;
--   DROP FUNCTION fn_user_default_store_sync() ; DROP TABLE user_stores.

CREATE TABLE IF NOT EXISTS user_stores (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_stores_default ON user_stores (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_user_stores_store ON user_stores (store_id);
COMMENT ON TABLE user_stores IS 'Établissements accessibles par compte, un par défaut = users.store_id (lot 7).';

INSERT INTO user_stores (user_id, store_id, is_default)
SELECT id, store_id, true FROM users WHERE store_id IS NOT NULL
ON CONFLICT (user_id, store_id) DO NOTHING;

-- users.store_id → établissement par défaut dans user_stores (ajouté s'il manquait).
CREATE OR REPLACE FUNCTION fn_user_default_store_sync() RETURNS trigger AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    UPDATE user_stores SET is_default = false WHERE user_id = NEW.id AND is_default;
  ELSE
    UPDATE user_stores SET is_default = false
     WHERE user_id = NEW.id AND is_default AND store_id <> NEW.store_id;
    INSERT INTO user_stores (user_id, store_id, is_default) VALUES (NEW.id, NEW.store_id, true)
    ON CONFLICT (user_id, store_id) DO UPDATE SET is_default = true WHERE NOT user_stores.is_default;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_default_store_sync ON users;
CREATE TRIGGER trg_user_default_store_sync AFTER INSERT OR UPDATE OF store_id ON users
  FOR EACH ROW EXECUTE FUNCTION fn_user_default_store_sync();

-- Journal des changements de configuration (mig 328), comme user_roles.
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS user_stores_config_audit ON user_stores;
    CREATE TRIGGER user_stores_config_audit AFTER INSERT OR UPDATE OR DELETE ON user_stores
      FOR EACH ROW EXECUTE FUNCTION log_config_change('store_id', 'user_id');
  END IF;
END $$;
