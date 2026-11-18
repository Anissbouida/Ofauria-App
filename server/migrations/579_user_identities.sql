-- G6-02 — Connexion d'entreprise (OpenID Connect : Google, Microsoft).
-- Une identité externe (fournisseur + sujet) se rattache à un compte existant et actif par
-- son e-mail vérifié, à la première connexion ; aucun compte n'est créé automatiquement.
-- Rollback : DROP TABLE user_identities.

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);
