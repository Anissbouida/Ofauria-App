-- 617 — Double authentification exigée par compte.
-- Jusqu'ici la double authentification n'était imposée que par rôle (paramètre
-- security.mfa.requiredRoles). L'administrateur peut désormais l'exiger pour un compte
-- précis : exigée = rôle listé OU users.mfa_required. Le compte concerné doit la
-- configurer à sa prochaine connexion (écran MfaSetup forcé), comme pour un rôle.
-- Retour arrière : ALTER TABLE users DROP COLUMN mfa_required;

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.mfa_required IS
  'Double authentification exigée pour ce compte par l''administrateur (en plus des rôles de security.mfa).';
