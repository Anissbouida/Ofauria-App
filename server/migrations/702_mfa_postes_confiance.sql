-- Double authentification : postes de confiance.
-- Après un code valide, la personne peut cocher « Mémoriser ce poste » : le navigateur reçoit un
-- cookie HttpOnly et la double authentification n'est plus demandée sur ce poste pendant
-- 14 jours (paramètre security.mfa.trustedDeviceDays, 0 = désactivé). Le mot de passe reste
-- exigé à chaque connexion. Seule l'empreinte SHA-256 du jeton est conservée.
-- Révocation : changement de mot de passe, fermeture des sessions, désactivation du compte,
-- réinitialisation ou désactivation de la double authentification, ou « Oublier mes postes ».
-- Retour arrière : DROP TABLE mfa_trusted_devices;
CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  label        text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS ix_mfa_trusted_devices_user_open
  ON mfa_trusted_devices (user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE mfa_trusted_devices IS 'Postes de confiance de la double authentification (mig 702) ; jeton stocké en empreinte SHA-256.';
