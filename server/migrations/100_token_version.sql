-- OWASP A07-5 : invalidation des tokens existants lors de changements de
-- privileges (role, storeId, desactivation).
--
-- Pattern "token version" : chaque utilisateur a un compteur. Le JWT emis
-- embarque la valeur au moment de la creation. Le middleware auth compare
-- la version du token a celle de la DB et rejette tout token obsolete.
--
-- Alternative a la revocation individuelle par jti (qui requiert une table
-- grandissante et d'enumerer tous les jti emis pour un user).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
