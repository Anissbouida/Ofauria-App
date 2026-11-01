-- ═══════════════════════════════════════════════════════════════════════
-- 417 — Journal d'audit comptable : export du FEC (lot Essentiel 3)
--
-- POURQUOI
--   Le Fichier des Écritures Comptables (avis CNC n° 24, art. 210 CGI) se
--   remet à l'administration lors d'un contrôle : qui l'a produit, quand, sur
--   quelle période et avec quelle empreinte doit rester tracé.
--
-- PORTÉE
--   Nouvel événement 'fec_export' dans ledger_audit_log (mig 413).
--
-- INVERSION
--   Retirer 'fec_export' de la contrainte ledger_audit_log_event_check.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ledger_audit_log DROP CONSTRAINT IF EXISTS ledger_audit_log_event_check;
ALTER TABLE ledger_audit_log ADD CONSTRAINT ledger_audit_log_event_check CHECK (event IN (
  'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
  'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export'));
