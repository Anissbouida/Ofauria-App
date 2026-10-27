-- 364 — Envoi d'e-mails et tâches planifiées
--
-- Deux briques transverses dont dépendent les modules SAV, Projets, Maintenance et Achats :
--
-- 1. E-mails. Une règle de notification (mig 332) peut aussi partir par e-mail. Un trigger
--    sur `notifications` met en file (`email_outbox`) un message par destinataire ayant une
--    adresse ; la tâche planifiée `email_outbox` les envoie. Les identifiants du serveur
--    d'envoi (SMTP) restent dans les variables d'environnement, jamais en base ; la base
--    ne porte que l'expéditeur affiché, la réponse et le pied de message.
--
-- 2. Tâches planifiées. Catalogue `scheduled_jobs` (fréquence, activation, dernier passage)
--    et historique `scheduled_job_runs`. Le moteur tourne dans le serveur (toutes les
--    minutes tant qu'une instance est active) et peut être déclenché de l'extérieur
--    (Cloud Scheduler → POST /api/v1/cron/tick avec le secret CRON_SECRET). Un verrou
--    consultatif garantit qu'un seul passage tourne à la fois.
--
-- Rollback :
--   DROP TRIGGER notifications_email ON notifications ; DROP FUNCTION trg_notification_email() ;
--   DROP TABLE scheduler_state, scheduled_job_runs, scheduled_jobs, email_outbox, mail_settings ;
--   ALTER TABLE notification_rules DROP COLUMN email_enabled ;
--   ALTER TABLE complaints DROP COLUMN overdue_notified_at ; ALTER TABLE project_tasks DROP COLUMN overdue_notified_at ;
--   ALTER TABLE rfqs DROP COLUMN deadline_notified_at ; ALTER TABLE maintenance_plans DROP COLUMN due_notified_on ;
--   DELETE FROM notification_rules WHERE type IN ('rfq_deadline').

-- ─── 1. Réglages d'envoi (sans secret) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS mail_settings (
  id           BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  from_name    VARCHAR(120),
  reply_to     VARCHAR(255),
  footer       TEXT CHECK (char_length(COALESCE(footer, '')) <= 500),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO mail_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
COMMENT ON TABLE mail_settings IS 'Envoi d''e-mails (mig 364) : expéditeur affiché, réponse, pied. Identifiants SMTP en variables d''environnement.';

-- ─── 2. File d'envoi ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_outbox (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email         VARCHAR(255) NOT NULL,
  to_name          VARCHAR(200),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  subject          VARCHAR(255) NOT NULL,
  body_text        TEXT NOT NULL,
  notification_id  UUID,
  type             VARCHAR(60),
  reference_type   VARCHAR(50),
  reference_id     UUID,
  status           VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
  attempts         SMALLINT NOT NULL DEFAULT 0,
  last_error       TEXT,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox (created_at DESC);
COMMENT ON TABLE email_outbox IS 'File d''envoi des e-mails (mig 364) : 5 tentatives espacées, puis échec visible dans Paramètres.';

ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN notification_rules.email_enabled IS 'Envoie aussi la notification par e-mail aux destinataires qui ont une adresse (mig 364).';

-- Destinataires : la personne visée (target_user_id), sinon les comptes actifs du rôle,
-- du même établissement ou sans établissement. 'all' sans personne = trop large : pas d'e-mail.
-- Une même personne ne reçoit pas deux fois le même événement en 10 minutes (copies des
-- rôles supplémentaires, double clic).
CREATE OR REPLACE FUNCTION trg_notification_email() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM notification_rules WHERE type = NEW.type AND email_enabled) THEN
    RETURN NULL;
  END IF;
  INSERT INTO email_outbox (to_email, to_name, user_id, subject, body_text, notification_id, type, reference_type, reference_id, created_by)
  SELECT u.email, u.first_name || ' ' || u.last_name, u.id, left(NEW.title, 255), NEW.message, NEW.id, NEW.type,
         NEW.reference_type, NEW.reference_id, NEW.created_by
    FROM users u
   WHERE u.is_active IS NOT FALSE
     AND u.email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' AND u.email !~* '\.(local|test|invalid)$'
     AND (CASE WHEN NEW.target_user_id IS NOT NULL THEN u.id = NEW.target_user_id
               WHEN NEW.target_role = 'all' THEN false
               ELSE u.role = NEW.target_role AND (NEW.store_id IS NULL OR u.store_id IS NULL OR u.store_id = NEW.store_id) END)
     AND (NEW.created_by IS NULL OR u.id <> NEW.created_by)
     AND NOT EXISTS (SELECT 1 FROM email_outbox o
                      WHERE o.to_email = u.email AND o.type = NEW.type
                        AND o.reference_id IS NOT DISTINCT FROM NEW.reference_id
                        AND o.created_at > now() - interval '10 minutes');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS notifications_email ON notifications;
CREATE TRIGGER notifications_email AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION trg_notification_email();

-- ─── 3. Tâches planifiées ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  key               VARCHAR(40) PRIMARY KEY,
  label             VARCHAR(120) NOT NULL,
  description       TEXT,
  domain            VARCHAR(30) NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  interval_minutes  INTEGER NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
  next_run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at       TIMESTAMPTZ,
  last_status       VARCHAR(10) CHECK (last_status IN ('ok', 'error')),
  last_message      TEXT,
  last_duration_ms  INTEGER,
  display_order     SMALLINT NOT NULL DEFAULT 0,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE scheduled_jobs IS 'Tâches planifiées (mig 364) : le code de chaque tâche est dans le serveur, la base porte fréquence, activation et dernier passage.';

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key      VARCHAR(40) NOT NULL REFERENCES scheduled_jobs(key) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  items        INTEGER NOT NULL DEFAULT 0,
  message      TEXT,
  trigger      VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto', 'manual', 'external')),
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_job_runs ON scheduled_job_runs (job_key, started_at DESC);

-- Battement du moteur : prouve que le déclencheur (interne ou externe) passe, même sans tâche due.
CREATE TABLE IF NOT EXISTS scheduler_state (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  last_internal_tick  TIMESTAMPTZ,
  last_external_tick  TIMESTAMPTZ
);
INSERT INTO scheduler_state (id) VALUES (true) ON CONFLICT DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('email_outbox',       'Envoi des e-mails',               'Envoie les e-mails en attente ; nouvel essai espacé en cas d''échec (5 au plus).', 'system', 1, 10),
  ('complaints_overdue', 'Réclamations en retard',          'Prévient le responsable SAV quand une réclamation dépasse son délai de traitement.', 'sav', 15, 20),
  ('project_tasks_overdue', 'Tâches de projet en retard',   'Prévient la personne affectée (ou le gérant) d''une tâche dont l''échéance est passée.', 'projects', 60, 30),
  ('maintenance_due',    'Entretiens préventifs à échéance','Crée l''intervention des plans arrivés à échéance et prévient le responsable.', 'maintenance', 60, 40),
  ('rfq_deadline',       'Appels d''offres à échéance',     'Prévient l''acheteur quand la date limite de réponse d''un appel d''offres est passée.', 'purchasing', 60, 50),
  ('housekeeping',       'Nettoyage',                       'Supprime l''historique des tâches de plus de 30 jours et les e-mails envoyés de plus de 90 jours.', 'system', 1440, 90)
ON CONFLICT (key) DO NOTHING;

-- ─── 4. Marqueurs « déjà prévenu » (une alerte par retard, pas une par passage) ──
ALTER TABLE complaints        ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;
ALTER TABLE project_tasks     ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;
ALTER TABLE rfqs              ADD COLUMN IF NOT EXISTS deadline_notified_at TIMESTAMPTZ;
ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS due_notified_on DATE;

INSERT INTO notification_rules (type, label, domain) VALUES
  ('rfq_deadline', 'Appel d''offres : date limite passée', 'purchasing')
ON CONFLICT (type) DO NOTHING;

-- Les alertes de retard partent aussi par e-mail par défaut (sans effet tant que l'envoi
-- n'est pas configuré) ; le reste reste dans la cloche, à activer au cas par cas.
UPDATE notification_rules SET email_enabled = true
 WHERE type IN ('complaint_critical', 'complaint_overdue', 'project_task_overdue', 'maintenance_due', 'rfq_deadline', 'product_recall', 'haccp_alert');
