-- Phase 10.3 — portail client : jeton d'accès par client.
--
-- Un client professionnel consulte ses commandes, ses factures et son relevé,
-- et télécharge ses factures. L'accès se fait par un jeton Bearer rattaché au
-- client (aucun compte utilisateur interne). Comme pour les clés d'API, seul le
-- hash est stocké ; le jeton en clair n'est montré qu'à l'émission.

CREATE TABLE IF NOT EXISTS customer_portal_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_prefix  text NOT NULL UNIQUE,
  token_hash    text NOT NULL,
  created_by    uuid REFERENCES users(id),
  last_login_at timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer
  ON customer_portal_tokens (customer_id) WHERE revoked_at IS NULL;
