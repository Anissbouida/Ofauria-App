-- OWASP A07-2 / A07-3 : Revocation de tokens JWT.
--
-- Solution : ajouter un claim `jti` (unique par token) et maintenir une table
-- des jti revoques. Le middleware auth refuse tout token dont le jti est present.
-- La table est purgee automatiquement par un job (ou a la verification a la volee)
-- des que expires_at est passe.

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index pour purge efficace des tokens expires.
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires
  ON revoked_tokens(expires_at);
