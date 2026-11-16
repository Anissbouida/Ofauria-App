-- G0-01 (plan d'action 2026-11) — API publique : clé d'idempotence.
--
-- Un site marchand qui rejoue une requête (délai dépassé, double envoi) avec
-- le même en-tête Idempotency-Key reçoit la réponse déjà enregistrée, sans
-- créer une seconde commande. La clé est propre à la clé d'API.
-- response_body NULL = requête encore en cours (ou échouée puis retirée).
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  api_key_id    uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  key           text NOT NULL,
  status_code   integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency_keys (created_at);
