-- Diagnostic des divergences legacy <-> ledger (bandeau de reconciliation).
-- A lancer en lecture seule sur la base concernee (ex. prod) pour comprendre,
-- facture par facture, l'origine de chaque ecart AVANT toute correction.
--
--   psql "$DATABASE_URL" -f server/scripts/diagnose-reconciliation.sql
--
-- Aucune ecriture n'est modifiee : SELECT uniquement.

\echo '=== 1. Synthese des divergences ==='
SELECT invoice_number, invoice_type, invoice_date::date,
       total_amount, legacy_remaining, ledger_remaining,
       ROUND((legacy_remaining - ledger_remaining)::numeric, 2) AS delta,
       has_ledger_entries
FROM v_reconciliation_check
WHERE ABS(legacy_remaining - ledger_remaining) > 0.01
   OR NOT has_ledger_entries
ORDER BY NOT has_ledger_entries DESC, ABS(legacy_remaining - ledger_remaining) DESC;

\echo ''
\echo '=== 2. Type C : ecritures DOUBLONS sur un meme tiers (source_id + detail) ==='
\echo '    Plusieurs ecritures posted non-reversed pour la meme source => le solde'
\echo '    du tiers est compte plusieurs fois. La correction = extourner les doublons'
\echo '    (en gardant la plus ancienne) via le service reverseEntriesForSource.'
SELECT je.source_id, je.source_kind, COALESCE(je.source_detail, '') AS detail,
       COUNT(*) AS nb_ecritures,
       STRING_AGG(je.entry_number, ', ' ORDER BY je.created_at) AS ecritures
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.status = 'posted'
  AND a.code IN ('3421', '4411')
GROUP BY je.source_id, je.source_kind, COALESCE(je.source_detail, '')
HAVING COUNT(*) > 1;

\echo ''
\echo '=== 3. Detail ligne a ligne des factures divergentes ==='
\echo '    Type B (ledger < legacy) : un paiement existe cote ecritures mais paid_amount'
\echo '    ne le reflete pas. Comparer la colonne payments vs les lignes du journal.'
WITH div AS (
  SELECT invoice_id, invoice_number, invoice_type
  FROM v_reconciliation_check
  WHERE ABS(legacy_remaining - ledger_remaining) > 0.01
)
SELECT d.invoice_number, d.invoice_type,
       je.entry_number, je.entry_date::date, je.source_kind,
       a.code AS compte, jel.debit, jel.credit,
       (jel.lettrage_id IS NOT NULL) AS lettre
FROM div d
JOIN journal_entries je
  ON je.status = 'posted'
 AND (je.source_id = d.invoice_id
      OR je.source_id IN (SELECT id FROM payments WHERE invoice_id = d.invoice_id))
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
ORDER BY d.invoice_number, je.entry_date, je.entry_number, a.code;

\echo ''
\echo '=== 4. Paiements legacy enregistres pour les factures divergentes ==='
WITH div AS (
  SELECT invoice_id, invoice_number
  FROM v_reconciliation_check
  WHERE ABS(legacy_remaining - ledger_remaining) > 0.01
)
SELECT d.invoice_number, p.id AS payment_id, p.amount, p.payment_method,
       p.payment_date::date, p.reference
FROM div d
LEFT JOIN payments p ON p.invoice_id = d.invoice_id
ORDER BY d.invoice_number, p.payment_date;
