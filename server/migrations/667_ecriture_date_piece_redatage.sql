-- ═══════════════════════════════════════════════════════════════════════
-- 667 — Plan d'action compta, étapes 8 et 10 (audit C-11, C-08) : redatage tracé, surveillance
--
--   1. journal_entries.document_date : date de la PIÈCE d'origine. Quand la période de cette date
--      est fermée, fn_accounting_date (mig 311) écrit l'écriture au premier jour de la première
--      période ouverte — sans aucune trace, jusqu'ici. La date d'origine est maintenant conservée
--      sur l'écriture ; elle n'entre pas dans l'empreinte de chaîne (colonne hors du contenu
--      canonique : aucune écriture scellée n'est touchée, aucune ne change).
--   2. Paramètre ledger.closed_period_policy : « redate » (comportement historique, défaut) ou
--      « refuse » (la pièce part en file avec la cause PERIOD_CLOSED au lieu d'être redatée).
--   3. Événements d'audit « redated » (écriture redatée) et « guards_check » (vérification
--      planifiée des protections du grand livre, étape 10).
--
-- Rollback : ALTER TABLE journal_entries DROP COLUMN document_date ; DELETE FROM module_parameters
--   WHERE key = 'ledger.closed_period_policy' ; remettre la contrainte de la mig 466.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS document_date DATE;
COMMENT ON COLUMN journal_entries.document_date IS
  'Date de la pièce d''origine. Différente de entry_date quand la période de la pièce était fermée (écriture redatée).';

INSERT INTO module_parameters (key, value, description) VALUES
  ('ledger.closed_period_policy', '{"policy":"redate"}',
   'Pièce datée d''une période fermée : redate = l''écriture est passée au premier jour de la période ouverte (la date de la pièce est conservée) ; refuse = la pièce part en file avec la cause « période fermée »')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE ledger_audit_log DROP CONSTRAINT IF EXISTS ledger_audit_log_event_check;
ALTER TABLE ledger_audit_log ADD CONSTRAINT ledger_audit_log_event_check CHECK (event IN (
  'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
  'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export',
  'letter_partial', 'unletter_partial', 'redated', 'guards_check'));
