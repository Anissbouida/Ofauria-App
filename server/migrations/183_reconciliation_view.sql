-- Migration 183 : Vue de reconciliation legacy <-> ledger
--
-- POURQUOI
--   Tant qu'on conserve les deux sources de verite (paid_amount sur invoices
--   + ecritures comptables), il est essentiel de pouvoir verifier en permanence
--   qu'elles donnent la meme valeur de "reste a payer". Cette vue calcule la
--   difference pour chaque facture vivante et expose une vue diff facile a
--   monitorer.
--
-- Pour chaque invoice non annulee :
--   legacy_remaining = total_amount - paid_amount (legacy)
--   ledger_remaining = solde non-lettre des lignes 4411/3421 rattachees a cette facture
--   delta            = legacy - ledger    (devrait etre 0 si tout va bien)
--
-- Usage :
--   SELECT * FROM v_reconciliation_check WHERE ABS(delta) > 0.01;
--
-- INVERSION : DROP VIEW v_reconciliation_check;

CREATE OR REPLACE VIEW v_reconciliation_check AS
SELECT
  inv.id                            AS invoice_id,
  inv.invoice_number,
  inv.invoice_type,
  inv.invoice_date,
  inv.total_amount,
  inv.status,
  -- Calcul legacy : (total - paid)
  ROUND((inv.total_amount - COALESCE(inv.paid_amount, 0))::NUMERIC, 2) AS legacy_remaining,
  -- Calcul ledger : solde non-lettre sur le compte tiers
  ROUND(COALESCE((
    SELECT
      CASE WHEN inv.invoice_type = 'emitted'
           THEN SUM(jel.debit)  - SUM(jel.credit)   -- 3421 : debit positif = creance
           ELSE SUM(jel.credit) - SUM(jel.debit)    -- 4411 : credit positif = dette
      END
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.lettrage_id IS NULL
      AND je.status = 'posted'
      AND a.code IN ('3421', '4411')
      AND (
        je.source_id = inv.id
        OR je.source_id IN (SELECT id FROM payments WHERE invoice_id = inv.id)
      )
  ), 0)::NUMERIC, 2) AS ledger_remaining,
  -- Booleen : la facture a-t-elle au moins une ecriture comptable ?
  EXISTS (
    SELECT 1 FROM journal_entries je2
    WHERE je2.status = 'posted'
      AND (je2.source_id = inv.id
           OR je2.source_id IN (SELECT id FROM payments WHERE invoice_id = inv.id))
  ) AS has_ledger_entries
FROM invoices inv
WHERE inv.status != 'cancelled';

COMMENT ON VIEW v_reconciliation_check IS
  'Compare legacy (paid_amount) vs ledger (solde non-lettre 3421/4411) pour chaque facture.';
