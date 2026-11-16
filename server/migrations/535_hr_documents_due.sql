-- G1-12 (plan d'action 2026-11) — échéances des documents du personnel, tâche planifiée.
--
-- Rien ne prévenait qu'une carte d'identité, une visite médicale, un CDD ou une période
-- d'essai arrivait à échéance. La tâche `hr_documents_due` (services/scheduler.ts) notifie
-- chaque jour le gérant, pour chaque seuil du paramètre hr.documents_due (30 et 7 jours à
-- la livraison) :
--   - CIN                : employees.cin_expires_on ;
--   - documents datés    : employee_documents.expires_on (visite médicale, certificat…) ;
--   - fin de CDD         : employee_contracts.end_date du contrat actif ;
--   - fin d'essai        : employee_contracts.trial_end_date du contrat actif.
-- Une alerte par échéance et par seuil : la date fait partie de la clé, une échéance
-- reportée (document renouvelé) est donc signalée de nouveau.
--
-- ACTIVÉE : elle ne fait que notifier.
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'hr_documents_due';
--             DELETE FROM module_parameters WHERE key = 'hr.documents_due';
--             DROP TABLE hr_due_alerts;
CREATE TABLE IF NOT EXISTS hr_due_alerts (
  kind           varchar(20) NOT NULL CHECK (kind IN ('cin', 'document', 'cdd_end', 'trial_end')),
  ref_id         uuid        NOT NULL,
  threshold_days smallint    NOT NULL CHECK (threshold_days > 0),
  due_on         date        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id, threshold_days, due_on)
);

INSERT INTO module_parameters (key, value, description) VALUES
  ('hr.documents_due', '{"days":[30,7],"email":false}'::jsonb,
   'Échéances du personnel (CIN, documents datés, fin de CDD, fin d''essai) : seuils en jours avant l''échéance et envoi d''un e-mail aux responsables.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('hr_documents_due',
   'Échéances du personnel',
   'Notifie les échéances proches : carte d''identité, documents datés (visite médicale…), fin de CDD, fin de période d''essai.',
   'hr', true, 1440, 70)
ON CONFLICT (key) DO NOTHING;
