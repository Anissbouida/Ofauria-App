-- G0-28 (plan d'action 2026-11) — utilisateur technique « Système ».
--
-- Les tâches planifiées créaient des documents avec un auteur NULL forcé par le code
-- (`null as unknown as string`). Elles agissent désormais au nom d'un compte technique :
-- inactif (aucune connexion possible), sans mot de passe utilisable, marqué is_system
-- pour ne pas apparaître dans la gestion des utilisateurs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, is_system)
VALUES ('systeme@kalum.local', '!', 'Système', 'Kalum', 'admin', false, true)
ON CONFLICT (email) DO UPDATE SET is_system = true, is_active = false;

-- Un seul compte technique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_single_system ON users ((true)) WHERE is_system;
