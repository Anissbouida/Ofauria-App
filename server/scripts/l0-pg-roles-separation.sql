-- =============================================================================
-- L0 — Séparation des rôles PostgreSQL (analyse d'écart P2P, lot L0)
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
-- =============================================================================
-- Constat : aujourd'hui l'application se connecte avec UN seul rôle qui est
-- propriétaire de tous les objets. En base locale (Docker) ce rôle est même
-- SUPERUSER + BYPASSRLS. Conséquences :
--   * une injection SQL ou un bug donne les pleins pouvoirs (DROP, lecture de
--     pg_authid, création de rôles…) ;
--   * toute politique RLS future (cloisonnement multi-boutiques / multi-tenant)
--     serait contournée d'office, car le propriétaire et BYPASSRLS ignorent RLS.
--
-- Cible : deux rôles distincts.
--   * kalum_owner — propriétaire des objets, exécute les migrations (DDL,
--     DISABLE TRIGGER des mig 310/413…). Utilisé UNIQUEMENT par le job de
--     migration, jamais par le serveur applicatif.
--   * kalum_app   — rôle d'exécution du serveur : LOGIN, NOSUPERUSER,
--     NOBYPASSRLS, NOCREATEDB, NOCREATEROLE. Droits DML seulement. Le code
--     applicatif n'a besoin ni de DDL, ni de DISABLE TRIGGER, ni de
--     session_replication_role (déjà contourné à la main côté runtime,
--     cf. inventory.repository.ts:565), donc ce périmètre est suffisant.
--
-- ⚠️  CE SCRIPT N'EST PAS UNE MIGRATION. Il vit dans server/scripts/ et n'est
--     jamais joué automatiquement par le runner (server/src/config/migrate.ts
--     ne lit que server/migrations/). Il se joue à la main, par un rôle
--     d'administration de l'instance, APRÈS :
--       1. un essai sur staging (dry-run) avec comparatif avant/après ;
--       2. un build Docker local qui démarre le serveur sous kalum_app
--          (une erreur de droits fait planter le boot — à voir AVANT la prod).
--
-- Déploiement associé (hors de ce fichier) :
--   * secret DATABASE_URL du serveur        → connexion kalum_app ;
--   * secret dédié du job de migration      → connexion kalum_owner
--     (config/migrate.ts lit la même URL aujourd'hui : prévoir MIGRATION_DATABASE_URL) ;
--   * ordre de bascule : créer les rôles → transférer la propriété → migrer en
--     owner → repointer l'app sur kalum_app → redémarrer.
--
-- Usage (exemple, à adapter au nom de l'instance) :
--   psql "$ADMIN_URL" \
--     -v owner_pwd="'…'" -v app_pwd="'…'" -v current_owner=postgres \
--     -f server/scripts/l0-pg-roles-separation.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- Valeurs par défaut si non fournies en ligne de commande.
\if :{?owner_pwd} \else \set owner_pwd '''CHANGE_ME_owner''' \endif
\if :{?app_pwd}   \else \set app_pwd   '''CHANGE_ME_app'''   \endif
\if :{?current_owner} \else \set current_owner 'postgres' \endif

-- 1. Création idempotente des deux rôles -------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kalum_owner') THEN
    EXECUTE format('CREATE ROLE kalum_owner LOGIN PASSWORD %L', :owner_pwd);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kalum_app') THEN
    EXECUTE format('CREATE ROLE kalum_app LOGIN PASSWORD %L', :app_pwd);
  END IF;
END $$;

-- Durcissement explicite du rôle applicatif (au cas où il préexisterait).
ALTER ROLE kalum_app  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- L'owner n'est pas superuser non plus : il lui faut seulement posséder les objets.
ALTER ROLE kalum_owner NOSUPERUSER NOBYPASSRLS NOCREATEDB NOREPLICATION;

-- 2. Transfert de la propriété des objets existants à kalum_owner ------------
-- REASSIGN OWNED doit être exécuté par un rôle membre de :current_owner et de
-- kalum_owner (ou par l'administration de l'instance). Sur Cloud SQL, exécuter
-- sous l'utilisateur d'administration après GRANT kalum_owner TO <admin>.
REASSIGN OWNED BY :current_owner TO kalum_owner;

-- 3. Droits de connexion + schéma --------------------------------------------
GRANT CONNECT ON DATABASE :"DBNAME" TO kalum_app;  -- :DBNAME = base courante
GRANT USAGE ON SCHEMA public TO kalum_app;
-- kalum_app ne doit PAS pouvoir créer d'objets dans public.
REVOKE CREATE ON SCHEMA public FROM kalum_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 4. Droits DML sur les objets actuels ---------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO kalum_app;
GRANT USAGE, SELECT, UPDATE         ON ALL SEQUENCES  IN SCHEMA public TO kalum_app;
GRANT EXECUTE                       ON ALL FUNCTIONS  IN SCHEMA public TO kalum_app;

-- 5. Droits DML sur les objets FUTURS (créés par kalum_owner via migrations) --
ALTER DEFAULT PRIVILEGES FOR ROLE kalum_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES   TO kalum_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kalum_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO kalum_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kalum_owner IN SCHEMA public
  GRANT EXECUTE                        ON FUNCTIONS TO kalum_app;

-- 6. Vérification ------------------------------------------------------------
-- Les deux rôles doivent être NON superuser et NON bypassrls.
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname IN ('kalum_owner', 'kalum_app') ORDER BY rolname;

-- Aucune table ne doit rester propriété de :current_owner.
SELECT tableowner, count(*)
FROM pg_tables WHERE schemaname = 'public' GROUP BY tableowner ORDER BY tableowner;
