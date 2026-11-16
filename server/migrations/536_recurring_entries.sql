-- G1-09 (plan d'action 2026-11) — écritures récurrentes.
--
-- Un modèle d'écriture (mig 391) ne s'instanciait qu'à la main. Il peut désormais porter
-- une périodicité : la tâche `recurring_entries` (services/scheduler.ts) instancie chaque
-- jour les modèles dont la prochaine échéance est atteinte (loyer, abonnement, leasing…).
--
--   recurrence        : monthly | quarterly | yearly (NULL = modèle manuel, comme avant)
--   recurrence_anchor : première échéance ; les suivantes en sont déduites (ancre + n
--                       périodes), pour qu'un 31 ne glisse pas au 30 puis au 28
--   next_run_on       : prochaine échéance à instancier
--   end_on            : dernière échéance possible (NULL = sans fin)
--   run_count         : nombre d'échéances déjà instanciées
--   last_run_on       : date de la dernière échéance instanciée (garde d'idempotence)
--
-- La tâche est ACTIVÉE : elle ne fait rien tant qu'aucun modèle n'a de périodicité, et
-- c'est le gérant qui la pose, modèle par modèle.
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'recurring_entries';
--             ALTER TABLE journal_entry_templates DROP COLUMN recurrence, DROP COLUMN recurrence_anchor,
--               DROP COLUMN next_run_on, DROP COLUMN end_on, DROP COLUMN run_count, DROP COLUMN last_run_on;
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS recurrence        varchar(10);
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS recurrence_anchor date;
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS next_run_on       date;
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS end_on            date;
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS run_count         integer NOT NULL DEFAULT 0;
ALTER TABLE journal_entry_templates ADD COLUMN IF NOT EXISTS last_run_on       date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_entry_templates_recurrence') THEN
    ALTER TABLE journal_entry_templates ADD CONSTRAINT chk_entry_templates_recurrence
      CHECK (recurrence IS NULL OR (recurrence IN ('monthly', 'quarterly', 'yearly') AND recurrence_anchor IS NOT NULL));
  END IF;
END $$;

INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('recurring_entries',
   'Écritures récurrentes',
   'Instancie les modèles d''écritures dotés d''une périodicité dont l''échéance est atteinte (une écriture par échéance).',
   'accounting', true, 1440, 62)
ON CONFLICT (key) DO NOTHING;
