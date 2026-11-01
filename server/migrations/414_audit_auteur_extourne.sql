-- ═══════════════════════════════════════════════════════════════════════
-- 414 — Journal d'audit comptable : auteur de l'extourne
--
-- POURQUOI
--   Les chemins d'annulation qui ne posent pas app.user_id (cancelPayrollPayment,
--   reverseEntriesForSource appelé hors setAuditUser…) laissaient l'événement
--   « reverse » de ledger_audit_log (mig 413) attribué à « Système », alors que
--   la contre-passation a bien un auteur. Constaté à l'annulation d'une avance
--   sur salaire le 2026-11-01.
--
-- PORTÉE
--   trg_journal_entry_audit : l'auteur d'une extourne retombe sur posted_by de
--   l'écriture de contre-passation quand le contexte applicatif est absent.
--   Le reste de la fonction est inchangé (mig 413).
--
-- INVERSION
--   Rejouer la définition de trg_journal_entry_audit de la mig 413.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_journal_entry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    VALUES ('draft_delete', OLD.id, OLD.entry_number, fn_ledger_actor(),
            jsonb_build_object('source_kind', OLD.source_kind, 'source_id', OLD.source_id));
    RETURN OLD;
  END IF;
  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted') THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    VALUES ('post', NEW.id, NEW.entry_number, COALESCE(fn_ledger_actor(), NEW.posted_by),
            jsonb_build_object('source_kind', NEW.source_kind, 'source_id', NEW.source_id,
                               'total', (SELECT COALESCE(sum(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.id)));
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'reversed' THEN
    INSERT INTO ledger_audit_log (event, entry_id, entry_number, actor, details)
    SELECT 'reverse', NEW.id, NEW.entry_number, COALESCE(fn_ledger_actor(), r.posted_by),
           jsonb_build_object('reversed_by_entry_id', NEW.reversed_by_entry_id, 'reversed_by_number', r.entry_number)
      FROM (SELECT NULL) AS one
      LEFT JOIN journal_entries r ON r.id = NEW.reversed_by_entry_id;
  END IF;
  RETURN NEW;
END $$;
