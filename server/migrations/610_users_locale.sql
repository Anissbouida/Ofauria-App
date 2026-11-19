-- G6-05 (plan d'action 2026-11) — traductions, phase 1 : langue de l'interface par utilisateur.
--
-- L'interface est en français ; la phase 1 pose le socle de traduction (client/src/i18n)
-- avec l'arabe (écriture de droite à gauche) et l'anglais. Chaque utilisateur choisit sa
-- langue dans son menu ; elle le suit d'un poste à l'autre, d'où le stockage en base.
--   NULL  = langue par défaut de la société (aucun réglage société à ce jour → français).
--   'fr' / 'ar' / 'en' = choix explicite.
-- Les contenus saisis (désignations, fiches techniques, champs _ar des fiches masterclass)
-- ne sont pas concernés : seule la langue des libellés de l'application change.
--
-- INVERSION :
--   ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_locale;
--   ALTER TABLE users DROP COLUMN IF EXISTS locale;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale varchar(5);

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_locale;
ALTER TABLE users ADD CONSTRAINT chk_users_locale CHECK (locale IS NULL OR locale IN ('fr', 'ar', 'en'));

COMMENT ON COLUMN users.locale IS 'G6-05 : langue de l''interface (fr, ar, en) ; NULL = langue par défaut de la société.';
