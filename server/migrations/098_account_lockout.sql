-- OWASP A04 — Insecure Design
-- A04-2 : Lockout de compte apres N tentatives de connexion echouees.
--
-- Colonnes :
--   failed_login_count  : compteur reinitialise a chaque login reussi.
--   locked_until        : timestamp futur = compte verrouille jusqu'a cette date.
--   last_failed_login_at: pour debug / monitoring.
--
-- La verification/incrementation se fait dans auth.controller.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;

-- Index partiel pour purge/debug rapide des comptes verrouilles
CREATE INDEX IF NOT EXISTS idx_users_locked_until
  ON users(locked_until) WHERE locked_until IS NOT NULL;
