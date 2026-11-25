-- ═══════════════════════════════════════════════════════════════════════
-- 664 — Plan d'action compta, étape 3 (audit C-02) : TVA par taux, comptes sans taux visibles
--
--   1. 4455 (TVA facturée, compte générique) et 3455 (TVA récupérable, générique) portent
--      désormais un sens de TVA : la déclaration les lit. Jusqu'ici tva_direction était NULL,
--      donc la TVA d'un ticket à plusieurs taux (comptabilisée au taux moyen, sans compte
--      propre) sortait de la déclaration sans aucune alerte.
--   2. Contrôles de clôture extensibles : fn_close_checklist reprend sa définition (mig 452)
--      et ajoute le résultat de fn_close_checklist_extra(période). Les étapes suivantes du plan
--      ajoutent leurs contrôles en remplaçant seulement cette fonction, sans recopier les 450
--      lignes de l'autre. Premier contrôle : « vat_unclassified », bloquant.
--
-- Rollback : remettre tva_direction à NULL sur 4455 / 3455 ; recréer fn_close_checklist depuis
--   la mig 452 ; DROP FUNCTION fn_close_checklist_extra(uuid).
-- ═══════════════════════════════════════════════════════════════════════

UPDATE accounts SET tva_direction = 'collected'  WHERE code = '4455' AND tva_direction IS NULL;
UPDATE accounts SET tva_direction = 'deductible' WHERE code = '3455' AND tva_direction IS NULL;

CREATE OR REPLACE FUNCTION fn_close_checklist_extra(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  -- TVA collectée sur un compte sans taux : à classer avant de déclarer.
  SELECT 'vat_unclassified'::text, 'TVA collectée sur un compte sans taux (à classer)'::text,
         count(DISTINCT je.id), sum(l.credit - l.debit), true
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id, p
   WHERE a.tva_direction = 'collected' AND a.tva_rate IS NULL
     AND je.status IN ('posted', 'reversed') AND je.source_kind <> 'opening'
     AND je.entry_date BETWEEN p.start_date AND p.end_date
  HAVING COALESCE(sum(l.credit - l.debit), 0) <> 0
$$;

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
           WHERE a.code = '5161' AND je.status IN ('posted', 'reversed') AND je.entry_date <= p.end_date
             AND je.entry_date >= fn_ledger_window_start(p.end_date, 5)) c
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
  -- ─── Cycle de vente (mig 452, O2C L6) ───
  UNION ALL
  SELECT 'customer_invoices_unposted', 'Factures clients sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'emitted' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'o2c_unbilled_deliveries', 'BL livrés non facturés à la fin de la période (factures à établir non passées)',
         count(*), COALESCE(sum(x.ht), 0), false
    FROM p, v_o2c_unbilled_at x
   WHERE x.as_of = p.end_date
     AND NOT EXISTS (SELECT 1 FROM period_end_operations o WHERE o.period_id = p.id AND o.kind = 'fae' AND o.superseded_at IS NULL)
  UNION ALL
  SELECT 'fg_stock_not_valued', 'Stock de produits finis non valorisé pour la période',
         (CASE WHEN EXISTS (SELECT 1 FROM period_end_operations o WHERE o.period_id = p.id AND o.kind = 'fg_stock' AND o.superseded_at IS NULL)
               THEN 0 ELSE 1 END)::bigint, NULL::numeric, false
    FROM p
  UNION ALL
  SELECT * FROM fn_close_checklist_extra(p_period)
$$;
