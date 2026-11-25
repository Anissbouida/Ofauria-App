-- Refonte Utilisateurs, lot 4 : page d'accueil d'un rôle.
-- Un compte ouvre Kalum sur la page d'accueil de son rôle principal (sauf préférence personnelle
-- d'espace de travail) ; à défaut, sur celle du secteur. Les rôles créés par l'assistant de
-- configuration reprennent la page d'accueil de leur modèle (sector_role_templates.home_route).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS home_route varchar(80);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_home_route_format') THEN
    ALTER TABLE roles ADD CONSTRAINT roles_home_route_format
      CHECK (home_route IS NULL OR home_route ~ '^/[a-z0-9/_-]*$');
  END IF;
END $$;

-- Rôles déjà créés depuis un modèle du secteur : même code que le modèle.
DO $$
BEGIN
  IF to_regclass('public.sector_role_templates') IS NOT NULL THEN
    UPDATE roles r SET home_route = t.home_route
      FROM sector_role_templates t
     WHERE t.code = r.code AND NOT r.is_system AND r.home_route IS NULL
       AND t.home_route IS NOT NULL AND t.home_route ~ '^/[a-z0-9/_-]*$' AND t.home_route <> '/';
  END IF;
END $$;

COMMENT ON COLUMN roles.home_route IS 'Page d''accueil des comptes dont c''est le rôle principal (refonte Utilisateurs, lot 4) ; NULL = celle du secteur.';
