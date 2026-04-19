-- OWASP A02 — Cryptographic Failures
-- Retire la contrainte UNIQUE sur pin_code.
--
-- Avec des PINs hashes (bcrypt, depuis migration 094), la contrainte UNIQUE est :
-- 1. Inefficace : deux PINs identiques produisent des hashs differents (sel aleatoire),
--    donc la contrainte n'empeche plus les collisions de PIN clair.
-- 2. Dangereuse : elle ne protege plus rien, et la verification d'unicite doit
--    desormais se faire cote application (comparaison bcrypt).
-- 3. Un vecteur d'enumeration si jamais on re-stockait des PINs clairs :
--    le conflit 23505 revele qu'un PIN est deja utilise.
--
-- On conserve l'index pour les performances de lookup (si utilise ailleurs),
-- mais on retire la contrainte d'unicite.

-- Postgres stocke la contrainte UNIQUE avec un nom auto-genere (users_pin_code_key).
-- On la drop via ALTER TABLE ... DROP CONSTRAINT avec IF EXISTS pour idempotence.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pin_code_key;

-- Par securite, chercher et drop toute autre contrainte unique residuelle sur pin_code
DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'users'
      AND c.contype = 'u'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(c.conkey)
          AND a.attname = 'pin_code'
      )
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;
