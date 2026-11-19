-- G3-01 étape 2 — anonymisation d'une COPIE de la production pour le staging.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm=<nom_de_la_base_staging> -f server/scripts/anonymize-staging.sql
--
-- Garde-fou : `confirm` doit être égal au nom de la base courante, et la base ne doit pas
-- s'appeler comme une base de production connue. À ne JAMAIS lancer sur la production.
--
-- Ce que fait le script (une transaction) :
--  - clients, adresses clients, salariés, fournisseurs, utilisateurs : noms, téléphones, e-mails,
--    adresses, CIN, CNSS, RIB, ICE remplacés par des valeurs fictives stables (dérivées de l'id) ;
--  - comptes : mots de passe, codes PIN, secrets MFA et identités d'entreprise invalidés — se
--    connecter au staging avec les comptes de test (server/scripts/seed-test-accounts.ts) ;
--  - intégrations coupées : clés d'API révoquées, webhooks désactivés (secret effacé), jetons du
--    portail client révoqués, file d'e-mails en attente annulée ;
--  - journaux d'audit (audit_trail, config_audit_log, purchasing_master_audit) : valeurs des
--    tables ci-dessus masquées (les clés restent, pour garder la forme des écrans) ;
--  - auth_events : e-mail, IP et navigateur effacés.
-- Les déclencheurs d'audit sont suspendus le temps des mises à jour (sinon ils recopieraient les
-- anciennes valeurs dans les journaux), puis rétablis dans la même transaction.
--
-- Reste NON anonymisé (texte libre figé, protégé par le chaînage du grand livre ou les factures
-- émises figées) : libellés d'écritures et de paiements (« Salaire 11/2026 - Nom »), noms des
-- clients copiés sur les factures émises. Les montants (salaires, bulletins) sont conservés : une
-- fois les noms, CIN et RIB retirés, ils ne désignent plus personne. Accès au staging réservé à
-- l'équipe.

\set ON_ERROR_STOP 1
SELECT CASE
  WHEN :'confirm' <> current_database() THEN 'refus : confirm=' || :'confirm' || ' ne correspond pas à la base ' || current_database()
  WHEN current_database() IN ('ofauria', 'ofauria_prod', 'kalum', 'kalum_prod', 'postgres') THEN 'refus : nom de base de production'
  ELSE 'ok' END AS garde \gset
SELECT :'garde' = 'ok' AS garde_ok \gset
\if :garde_ok
\else
  \echo :garde
  \quit
\endif

BEGIN;

ALTER TABLE customers DISABLE TRIGGER USER;
ALTER TABLE customer_addresses DISABLE TRIGGER USER;
ALTER TABLE employees DISABLE TRIGGER USER;
ALTER TABLE suppliers DISABLE TRIGGER USER;
ALTER TABLE users DISABLE TRIGGER USER;

-- Valeur fictive stable : 8 premiers caractères hexadécimaux de l'id.
UPDATE customers SET
  first_name = 'Client', last_name = upper(left(replace(id::text, '-', ''), 8)),
  phone = CASE WHEN phone IS NULL THEN NULL ELSE '06' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0') END,
  email = CASE WHEN email IS NULL THEN NULL ELSE 'client-' || left(id::text, 8) || '@staging.invalid' END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Adresse de test' END,
  birthday = NULL,
  ice = CASE WHEN ice IS NULL THEN NULL ELSE lpad((abs(hashtext('ice' || id::text)) % 1000000000)::text, 15, '0') END;

UPDATE customer_addresses SET address_line = 'Adresse de test';

UPDATE employees SET
  first_name = 'Salarié', last_name = upper(left(replace(id::text, '-', ''), 8)),
  phone = CASE WHEN phone IS NULL THEN NULL ELSE '06' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0') END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Adresse de test' END,
  birth_date = CASE WHEN birth_date IS NULL THEN NULL ELSE make_date(extract(year FROM birth_date)::int, 1, 1) END,
  cin = CASE WHEN cin IS NULL THEN NULL ELSE 'ZZ' || lpad((abs(hashtext('cin' || id::text)) % 1000000)::text, 6, '0') END,
  cnss_number = CASE WHEN cnss_number IS NULL THEN NULL ELSE lpad((abs(hashtext('cnss' || id::text)) % 1000000000)::text, 9, '0') END,
  rib = CASE WHEN rib IS NULL THEN NULL ELSE '000' || lpad((abs(hashtext('rib' || id::text)) % 1000000000)::text, 21, '0') END,
  emergency_contact_name = CASE WHEN emergency_contact_name IS NULL THEN NULL ELSE 'Contact de test' END,
  emergency_contact_phone = CASE WHEN emergency_contact_phone IS NULL THEN NULL ELSE '0600000000' END;

UPDATE suppliers SET
  contact_name = CASE WHEN contact_name IS NULL THEN NULL ELSE 'Contact de test' END,
  phone = CASE WHEN phone IS NULL THEN NULL ELSE '05' || lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0') END,
  email = CASE WHEN email IS NULL THEN NULL ELSE 'fournisseur-' || left(id::text, 8) || '@staging.invalid' END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Adresse de test' END,
  rib = CASE WHEN rib IS NULL THEN NULL ELSE '000' || lpad((abs(hashtext('rib' || id::text)) % 1000000000)::text, 21, '0') END;
-- Raison sociale des fournisseurs conservée (personnes morales, utile pour reconnaître les achats).

UPDATE users SET
  first_name = 'Utilisateur', last_name = upper(left(replace(id::text, '-', ''), 8)),
  email = CASE WHEN email LIKE '%@kalum.local' THEN email ELSE 'user-' || left(id::text, 8) || '@staging.invalid' END,
  password_hash = '!staging-invalide', pin_code = NULL, totp_secret_enc = NULL,
  must_change_password = true, token_version = token_version + 1;

ALTER TABLE customers ENABLE TRIGGER USER;
ALTER TABLE customer_addresses ENABLE TRIGGER USER;
ALTER TABLE employees ENABLE TRIGGER USER;
ALTER TABLE suppliers ENABLE TRIGGER USER;
ALTER TABLE users ENABLE TRIGGER USER;

DELETE FROM user_identities;
UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now());
UPDATE webhook_endpoints SET is_active = false, secret = 'staging', url = 'https://staging.invalid/webhook';
UPDATE customer_portal_tokens SET revoked_at = COALESCE(revoked_at, now());
UPDATE email_outbox SET status = 'cancelled', last_error = 'staging : annulé à l''anonymisation' WHERE status IN ('pending', 'failed');
UPDATE email_outbox SET to_email = 'masque@staging.invalid', to_name = NULL;
UPDATE auth_events SET email = NULL, ip = NULL, user_agent = NULL;

-- Journaux d'audit en ajout seul : garde suspendue pour masquer les valeurs, puis rétablie.
ALTER TABLE audit_trail DISABLE TRIGGER trg_audit_trail_append_only;
UPDATE audit_trail SET changed = (SELECT COALESCE(jsonb_object_agg(k, '"***"'::jsonb), '{}'::jsonb) FROM jsonb_object_keys(changed) k)
 WHERE table_name IN ('customers', 'customer_addresses', 'employees', 'suppliers', 'users') AND jsonb_typeof(changed) = 'object';
ALTER TABLE audit_trail ENABLE TRIGGER trg_audit_trail_append_only;

ALTER TABLE config_audit_log DISABLE TRIGGER config_audit_log_append_only;
UPDATE config_audit_log SET diff = NULL, old_row = NULL, new_row = NULL
 WHERE table_name IN ('customers', 'employees', 'suppliers', 'users', 'user_identities');
ALTER TABLE config_audit_log ENABLE TRIGGER config_audit_log_append_only;

ALTER TABLE purchasing_master_audit DISABLE TRIGGER purchasing_master_audit_append_only;
UPDATE purchasing_master_audit SET diff = NULL, old_row = NULL, new_row = NULL WHERE table_name = 'suppliers';
ALTER TABLE purchasing_master_audit ENABLE TRIGGER purchasing_master_audit_append_only;

-- Contrôle : plus aucune adresse e-mail réelle sur les fiches.
SELECT 'clients' AS fiche, count(*) FILTER (WHERE email IS NOT NULL AND email NOT LIKE '%@staging.invalid') AS emails_reels FROM customers
UNION ALL SELECT 'fournisseurs', count(*) FILTER (WHERE email IS NOT NULL AND email NOT LIKE '%@staging.invalid') FROM suppliers
UNION ALL SELECT 'utilisateurs', count(*) FILTER (WHERE email NOT LIKE '%@staging.invalid' AND email NOT LIKE '%@kalum.local') FROM users;

COMMIT;
\echo 'Anonymisation terminée. Créer ensuite les comptes de test sur le staging : DATABASE_URL=… npx tsx scripts/seed-test-accounts.ts'
