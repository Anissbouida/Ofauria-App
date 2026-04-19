-- OWASP A09-2 : audit trail des evenements d'authentification et d'autorisation.
-- Permet l'analyse forensique en cas d'incident et la detection proactive
-- de patterns suspects (nombreux echecs, escalade de privileges, etc.).
--
-- Insertions faites via authEventRepository. Purge recommandee >= 90 jours
-- (a piloter selon contraintes legales / RGPD).

CREATE TABLE IF NOT EXISTS auth_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(40) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  ip INET,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour requetes forensiques frequentes :
--   - par user et date (timeline)
--   - par type d'event (ex: detecter pics de login_failed)
CREATE INDEX IF NOT EXISTS idx_auth_events_user
  ON auth_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_type
  ON auth_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_email
  ON auth_events(email, created_at DESC) WHERE email IS NOT NULL;
