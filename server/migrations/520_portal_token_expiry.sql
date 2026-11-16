-- G0-03 (plan d'action 2026-11) — le jeton du portail client expire.
--
-- Avant : un jeton émis restait valable indéfiniment tant qu'il n'était pas
-- révoqué. Désormais chaque jeton porte une date d'expiration (30, 90 ou 365
-- jours au choix à l'émission ; 90 par défaut) et la date de dernière utilisation.
-- Rattrapage : les jetons existants reçoivent 90 jours à compter de la migration.
ALTER TABLE customer_portal_tokens
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

UPDATE customer_portal_tokens
   SET expires_at = now() + interval '90 days'
 WHERE expires_at IS NULL;

ALTER TABLE customer_portal_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Reprise de l'historique : la dernière connexion connue vaut dernière utilisation.
UPDATE customer_portal_tokens SET last_used_at = last_login_at
 WHERE last_used_at IS NULL AND last_login_at IS NOT NULL;
