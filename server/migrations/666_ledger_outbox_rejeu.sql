-- ═══════════════════════════════════════════════════════════════════════
-- 666 — Plan d'action compta, étape 5 (audit C-07) : file d'écritures rejouée automatiquement
--
--   Une pièce dont la comptabilisation échoue est enregistrée quand même (mode « outbox ») et
--   inscrite dans ledger_outbox. Jusqu'ici, seul un bouton manuel rejouait la file : une cause
--   corrigée (compte renseigné, période rouverte) n'avait aucun effet tant que personne ne
--   cliquait, et personne n'était prévenu.
--
--   - next_attempt_at : prochain rejeu automatique (délai croissant : 15 min, 1 h, 6 h, 24 h) ;
--   - error_code      : cause classée (compte manquant, période close, prix absent…), pour que
--                       l'écran propose la bonne correction ;
--   - notified_at     : le comptable a été prévenu (une seule notification par pièce) ;
--   - tâche planifiée « ledger_outbox_replay » toutes les 15 minutes.
--
-- Rollback : DROP des trois colonnes ; DELETE FROM scheduled_jobs WHERE key = 'ledger_outbox_replay'.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ledger_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE ledger_outbox ADD COLUMN IF NOT EXISTS error_code VARCHAR(40);
ALTER TABLE ledger_outbox ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

COMMENT ON COLUMN ledger_outbox.next_attempt_at IS 'Prochain rejeu automatique ; NULL = dès le prochain passage de la tâche.';
COMMENT ON COLUMN ledger_outbox.error_code IS 'Cause classée : MISSING_ACCOUNT, PERIOD_CLOSED, MISSING_PRICE, MISSING_AUXILIARY, UNSUPPORTED_PAYMENT_METHOD, UNSUPPORTED_AVOIR, OTHER.';

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('ledger_outbox_replay', 'Rejeu des écritures en attente',
   'Rejoue les pièces enregistrées dont l''écriture comptable a échoué (compte manquant, période close…) et prévient le comptable de celles qui restent bloquées.',
   'accounting', 15, 61)
ON CONFLICT (key) DO NOTHING;
