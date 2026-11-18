-- G6-01 — Double authentification par code à usage unique (TOTP, RFC 6238).
-- Le secret est chiffré (AES-256-GCM, clé dérivée du secret du serveur) ; les codes de
-- secours sont stockés hachés (SHA-256) et consommés une fois. Les rôles listés dans
-- security.mfa.requiredRoles (codes de rôle de base ou de rôle configuré) doivent activer
-- la double authentification avant toute autre action.
-- Rollback : ALTER TABLE users DROP COLUMN totp_secret_enc, totp_enabled, totp_enabled_at,
--   totp_backup_codes ; DELETE FROM module_parameters WHERE key = 'security.mfa'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO module_parameters (key, value, description) VALUES
  ('security.mfa', '{"requiredRoles": ["admin", "comptable", "finance"]}'::jsonb,
   'Double authentification : rôles (codes) qui doivent l''activer avant toute autre action.')
ON CONFLICT (key) DO NOTHING;
