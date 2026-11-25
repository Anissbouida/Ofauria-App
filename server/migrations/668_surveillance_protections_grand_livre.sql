-- ═══════════════════════════════════════════════════════════════════════
-- 668 — Plan d'action compta, étape 10 (audit C-08) : surveillance des protections du grand livre
--
--   L'inaltérabilité repose sur des triggers (équilibre, gel des écritures validées, verrou de
--   période, audit) et sur la chaîne d'empreintes. Un trigger désactivé ne bloque plus rien et
--   personne n'en était prévenu : la mig 413 a elle-même constaté un trigger de garde désactivé
--   en développement, sans trace.
--
--   1. fn_ledger_guards_status() : état (actif ou non) de chaque trigger dont dépend
--      l'inaltérabilité. Un trigger absent ou désactivé sort avec enabled = false.
--   2. Tâche planifiée « ledger_guards_check » (15 min) : lit cette fonction, repère un
--      session_replication_role forcé, vérifie la chaîne au plus toutes les 6 h, trace le résultat
--      (événement « guards_check ») et prévient les responsables au premier passage en anomalie.
--   3. Contrôle de clôture « ledger_guards » (bloquant) quand la dernière vérification a échoué.
--
--   Limite assumée : un superutilisateur peut aussi désactiver cette tâche. La vraie barrière est
--   un rôle de connexion sans droit de propriété sur les tables (étape 20 du plan).
--
-- Rollback : DROP FUNCTION fn_ledger_guards_status() ; DELETE FROM scheduled_jobs WHERE key =
--   'ledger_guards_check' ; recréer fn_close_checklist_extra depuis la mig 664.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_ledger_guards_status()
RETURNS TABLE (table_name text, trigger_name text, enabled boolean) LANGUAGE sql STABLE AS $$
  SELECT e.tbl, e.trg, COALESCE(t.tgenabled IN ('O', 'A'), false)
    FROM (VALUES
      ('journal_entries',      'trg_check_journal_entry_balance'),
      ('journal_entries',      'trg_check_period_lock'),
      ('journal_entries',      'trg_journal_entry_guard'),
      ('journal_entries',      'trg_journal_entry_audit'),
      ('journal_entry_lines',  'trg_journal_line_guard'),
      ('journal_entry_lines',  'trg_journal_line_lettrage_audit'),
      ('fiscal_periods',       'trg_fiscal_period_status')
    ) AS e (tbl, trg)
    LEFT JOIN pg_class c ON c.relname = e.tbl AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trg AND NOT t.tgisinternal
$$;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('ledger_guards_check', 'Surveillance des protections du grand livre',
   'Vérifie que les verrous de l''inaltérabilité sont actifs (triggers, mode de réplication) et que la chaîne d''empreintes est intacte ; prévient les responsables au premier signe d''anomalie.',
   'accounting', 15, 62)
ON CONFLICT (key) DO NOTHING;

-- Contrôles de clôture supplémentaires (reprend la mig 664 et ajoute la surveillance).
CREATE OR REPLACE FUNCTION fn_close_checklist_extra(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  -- TVA collectée sur un compte sans taux : à classer avant de déclarer (mig 664).
  SELECT 'vat_unclassified'::text, 'TVA collectée sur un compte sans taux (à classer)'::text,
         count(DISTINCT je.id), sum(l.credit - l.debit), true
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id, p
   WHERE a.tva_direction = 'collected' AND a.tva_rate IS NULL
     AND je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening'
     AND je.entry_date BETWEEN p.start_date AND p.end_date
  HAVING COALESCE(sum(l.credit - l.debit), 0) <> 0
  UNION ALL
  -- Protections du grand livre : la dernière surveillance a relevé une anomalie (mig 668).
  SELECT 'ledger_guards'::text, 'Protections du grand livre en anomalie (triggers désactivés ou chaîne rompue)'::text,
         COALESCE(jsonb_array_length(g.details->'disabled'), 0)::bigint, NULL::numeric, true
    FROM (SELECT l.details FROM ledger_audit_log l WHERE l.event = 'guards_check' ORDER BY l.id DESC LIMIT 1) g
   WHERE COALESCE((g.details->>'ok')::boolean, false) IS NOT TRUE
$$;
