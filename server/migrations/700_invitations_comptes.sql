-- Refonte Utilisateurs, lot 3 : invitation d'un nouveau compte.
-- L'administrateur crée le compte sans en connaître le mot de passe ; la personne reçoit un lien
-- valable 72 h et choisit elle-même son mot de passe. Seule l'empreinte SHA-256 du jeton est
-- conservée (le jeton n'est jamais stocké en clair). Une invitation renvoyée annule la précédente.
CREATE TABLE IF NOT EXISTS user_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz
);

-- Une seule invitation ouverte par compte.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_invitations_open
  ON user_invitations (user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE user_invitations IS 'Invitations à choisir son mot de passe (refonte Utilisateurs, lot 3) ; jeton stocké en empreinte SHA-256.';
