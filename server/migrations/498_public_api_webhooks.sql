-- Phase 10.2 — API publique : clés d'accès + notifications sortantes (webhooks).
--
-- Un site marchand appelle l'API avec une clé (Bearer) pour créer une commande,
-- et Kalum le notifie en retour (webhook signé) quand un événement survient
-- (ex. order.created). Additif : trois tables neuves, aucune route existante
-- modifiée ; l'app interne (cookie + JWT) n'est pas touchée.

-- Clés d'accès. La clé en clair n'est JAMAIS stockée : seul son hash SHA-256
-- l'est, plus un préfixe lisible pour la retrouver et l'afficher. Portée par
-- `scopes` (ex. {orders:create, products:read}) et optionnellement par magasin.
CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  key_prefix  text NOT NULL UNIQUE,
  key_hash    text NOT NULL,
  scopes      text[] NOT NULL DEFAULT '{}',
  store_id    uuid REFERENCES stores(id),
  created_by  uuid REFERENCES users(id),
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Points de notification sortante. `secret` sert à signer chaque livraison en
-- HMAC-SHA256 : le site marchand vérifie l'en-tête X-Kalum-Signature.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  url         text NOT NULL,
  secret      text NOT NULL,
  events      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- File des livraisons. Même esprit que email_outbox (mig 364) : on met en file,
-- la tâche planifiée poste et retente. Un échec n'interrompt jamais l'action
-- métier qui a produit l'événement.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id  uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  signature    text NOT NULL,
  status       text NOT NULL DEFAULT 'queued',  -- queued | sent | failed
  attempts     int  NOT NULL DEFAULT 0,
  last_error   text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON webhook_deliveries (endpoint_id);

-- Tâche planifiée qui poste les livraisons en attente et retente les échecs,
-- comme email_outbox. Modifiable dans Paramètres › Tâches planifiées.
INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, enabled, display_order)
VALUES ('webhook_outbox', 'Notifications sortantes (webhooks)',
        'Poste les webhooks en attente (API publique) et retente les échecs.',
        'system', 1, true, 90)
ON CONFLICT (key) DO NOTHING;
