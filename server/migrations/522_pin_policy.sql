-- G0-06 (plan d'action 2026-11) — connexion par PIN et politique des secrets.
--
-- La connexion par PIN passe par le choix du nom puis la saisie du PIN : le
-- serveur ne compare plus qu'UN hachage (avant : un par utilisateur actif).
--
-- pin_length : longueur du PIN, connue à la pose du PIN (ou apprise à la
--   première connexion réussie pour un PIN antérieur). Le PIN étant haché, c'est
--   la seule façon de signaler à l'administrateur les PIN de moins de 6 chiffres.
--   NULL = PIN antérieur dont la longueur n'est pas encore connue.
-- must_change_password : posé à la connexion quand le mot de passe saisi ne
--   respecte pas la politique en vigueur ; levé au changement de mot de passe.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pin_length           smallint,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
