-- Refonte Utilisateurs, lot 8 : politique de sécurité paramétrable, sessions et appareils.
--
-- 1. Politique (module_parameters 'security.policy') : longueur minimale du mot de passe,
--    renouvellement, verrouillage après échecs, délai pour configurer la double authentification,
--    longueur minimale du PIN, déconnexion après inactivité. Valeurs par défaut = celles fixées
--    jusqu'ici dans le code : rien ne change tant que la politique n'est pas modifiée.
-- 2. users.password_changed_at (renouvellement) : posé à maintenant pour les comptes existants,
--    puis tenu à jour par déclencheur à chaque changement de mot de passe.
-- 3. users.mfa_grace_started_at : début du délai accordé pour configurer la double authentification.
-- 4. user_sessions : une ligne par jeton émis (appareil, adresse, ouverture, dernière activité,
--    fermeture). La révocation effective reste la liste noire revoked_tokens et token_version.
--
-- INVERSION : DROP TABLE user_sessions ; DROP TRIGGER trg_users_password_changed ON users ;
--   DROP FUNCTION fn_users_password_changed() ; ALTER TABLE users DROP COLUMN password_changed_at,
--   DROP COLUMN mfa_grace_started_at ; DELETE FROM module_parameters WHERE key = 'security.policy'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_grace_started_at timestamptz;
UPDATE users SET password_changed_at = now() WHERE password_changed_at IS NULL;
ALTER TABLE users ALTER COLUMN password_changed_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION fn_users_password_changed() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.password_changed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_password_changed ON users;
CREATE TRIGGER trg_users_password_changed BEFORE UPDATE OF password_hash ON users
  FOR EACH ROW EXECUTE FUNCTION fn_users_password_changed();

CREATE TABLE IF NOT EXISTS user_sessions (
  jti            uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version  integer NOT NULL DEFAULT 0,
  store_id       uuid REFERENCES stores(id) ON DELETE SET NULL,
  method         varchar(20),
  ip             varchar(64),
  user_agent     varchar(400),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason varchar(30)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, created_at DESC);
COMMENT ON TABLE user_sessions IS 'Sessions ouvertes par jeton (appareil, adresse, activité) — refonte Utilisateurs, lot 8.';

INSERT INTO module_parameters (key, value, description, updated_at)
VALUES ('security.policy',
        '{"passwordMinLength":12,"passwordMaxAgeDays":0,"lockoutThreshold":5,"lockoutMinutes":15,"mfaGraceDays":0,"pinMinLength":6,"idleMinutes":15}'::jsonb,
        'Politique de sécurité : mot de passe, verrouillage, délai de double authentification, PIN, inactivité (Utilisateurs › Sécurité et connexions).',
        now())
ON CONFLICT (key) DO NOTHING;
