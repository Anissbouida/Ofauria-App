-- ═══════════════════════════════════════════════════════════════════════
-- 415 — Recettes : les fermetures de caisse du POS sont la seule source
--
-- POURQUOI
--   La saisie manuelle de caisse (mig 149) était une béquille du temps où le
--   POS n'était pas en production. Le POS enregistre désormais toutes les
--   ventes : chaque ticket est comptabilisé (caisse/banque, CA, TVA) et chaque
--   fermeture passe son écart en 6588/7588. La saisie manuelle s'est arrêtée
--   le 2026-08-01 sans que rien ne le signale, et la caisse 5161 a fini en
--   solde créditeur faute de recettes comptabilisées.
--
-- PORTÉE
--   1. manual_shift_entries gelée (trigger) : l'historique reste lisible et
--      continue de primer sur les tickets POS des mêmes jours (sinon double
--      comptage de juin-juillet 2026), mais plus aucune saisie n'est possible.
--   2. fn_close_checklist (mig 311) reprise avec cinq contrôles caisse :
--        bloquants : session de caisse non fermée, ticket sans écriture,
--                    caisse 5161 créditrice en fin de période ;
--        à examiner : écart de fermeture sans écriture, jour sans aucune vente.
--      « Jour sans vente » n'est pas bloquant : un jour de fermeture du
--      magasin est légitime, il faut le constater.
--
-- INVERSION
--   DROP TRIGGER manual_shift_entries_frozen ON manual_shift_entries ;
--   DROP FUNCTION trg_manual_shift_entries_frozen() ;
--   rejouer fn_close_checklist de la mig 311.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Gel des saisies manuelles ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_manual_shift_entries_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saisie manuelle de caisse retirée : les recettes viennent des fermetures de caisse du POS (historique en lecture seule).'
    USING ERRCODE = 'OF409';
END $$;
DROP TRIGGER IF EXISTS manual_shift_entries_frozen ON manual_shift_entries;
CREATE TRIGGER manual_shift_entries_frozen BEFORE INSERT OR UPDATE OR DELETE ON manual_shift_entries
  FOR EACH ROW EXECUTE FUNCTION trg_manual_shift_entries_frozen();
COMMENT ON TABLE manual_shift_entries IS
  'Saisies manuelles de caisse (mig 149), gelées par la mig 415 : historique en lecture seule, prime sur les tickets POS des mêmes jours.';

-- ═══ 2. Contrôles de clôture : caisse ═══════════════════════════════════
-- Les sept premiers contrôles sont ceux de la mig 311, inchangés.
CREATE OR REPLACE FUNCTION fn_close_checklist(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  SELECT 'previous_open', 'Période précédente encore ouverte',
         count(*), NULL::numeric, true
    FROM fiscal_periods f, p WHERE f.end_date = p.start_date - 1 AND f.status = 'open'
  UNION ALL
  SELECT 'invoices_unposted', 'Factures fournisseurs sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'payments_unposted', 'Paiements sans écriture',
         count(*), COALESCE(sum(pa.amount), 0), true
    FROM payments pa, p
   WHERE pa.status <> 'void' AND pa.amount > 0 AND pa.payment_method <> 'avoir'
     AND pa.payment_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = pa.id AND je.status = 'posted')
  UNION ALL
  SELECT 'outbox_pending', 'Comptabilisations en attente (file)',
         count(*), NULL::numeric, true
    FROM ledger_outbox o WHERE o.status <> 'posted'
  UNION ALL
  SELECT 'draft_entries', 'Écritures en brouillon dans la période',
         count(*), NULL::numeric, true
    FROM journal_entries je, p WHERE je.status = 'draft' AND je.fiscal_period_id = p.id
  UNION ALL
  SELECT 'grir_aged', 'Réceptions non facturées depuis plus de 30 jours',
         count(*), COALESCE(sum(g.open_amount), 0), false
    FROM v_grir_open_items g, p WHERE g.first_event <= p.end_date AND g.open_amount > 0 AND (p.end_date - g.first_event) > 30
  UNION ALL
  SELECT 'invoice_holds', 'Factures du mois avec blocage ouvert',
         count(DISTINCT h.invoice_id), NULL::numeric, false
    FROM invoice_holds h JOIN invoices i ON i.id = h.invoice_id, p
   WHERE h.released_at IS NULL AND i.invoice_date BETWEEN p.start_date AND p.end_date
  -- ─── Caisse (mig 415) ───
  UNION ALL
  SELECT 'pos_sessions_open', 'Sessions de caisse non fermées',
         count(*), NULL::numeric, true
    FROM cash_register_sessions cs, p
   WHERE cs.status <> 'closed'
     AND (cs.opened_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
  UNION ALL
  SELECT 'pos_sales_unposted', 'Tickets de caisse sans écriture',
         count(*), COALESCE(sum(s.total), 0), true
    FROM sales s, p
   WHERE s.payment_status IS DISTINCT FROM 'unpaid' AND s.total > 0
     AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = s.id AND je.status <> 'draft')
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m
                      WHERE m.store_id = s.store_id
                        AND m.entry_date = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca'))
  UNION ALL
  SELECT 'cash_credit_balance', 'Caisse (5161) en solde créditeur en fin de période',
         (CASE WHEN c.bal < 0 THEN 1 ELSE 0 END)::bigint, c.bal, true
    FROM (SELECT COALESCE(sum(l.debit) - sum(l.credit), 0) AS bal
            FROM journal_entry_lines l
            JOIN journal_entries je ON je.id = l.journal_entry_id
            JOIN accounts a ON a.id = l.account_id, p
           WHERE a.code = '5161' AND je.status IN ('posted','reversed') AND je.entry_date <= p.end_date) c
  UNION ALL
  SELECT 'pos_closure_diff_unposted', 'Écarts de fermeture de caisse sans écriture',
         count(*), COALESCE(sum(cs.difference), 0), false
    FROM cash_register_sessions cs, p
   WHERE cs.status = 'closed' AND COALESCE(cs.difference, 0) <> 0
     AND (cs.closed_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = cs.id AND je.source_kind = 'closure_diff' AND je.status <> 'draft')
  UNION ALL
  SELECT 'pos_days_without_sales', 'Jours sans aucune vente en caisse',
         count(*), NULL::numeric, false
    FROM p, generate_series(p.start_date, LEAST(p.end_date, CURRENT_DATE), interval '1 day') AS d(day)
   WHERE NOT EXISTS (SELECT 1 FROM sales s
                      WHERE DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') = d.day::date)
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m WHERE m.entry_date = d.day::date)
$$;
