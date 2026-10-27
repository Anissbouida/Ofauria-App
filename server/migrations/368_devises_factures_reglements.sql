-- 368 — Plusieurs devises, lot 2 : factures fournisseurs, règlements, écarts de change
--
-- Suite de la mig 363 (BC et devis en devise). Principe comptable (CGNC) :
--   - la facture d'un BC en devise est comptabilisée en DH au taux figé du BC (c'est
--     aussi le taux qui a valorisé le stock à la réception) ; elle garde son montant
--     en devise (foreign_total_amount) ;
--   - le règlement se fait en devise, au taux du jour du paiement : la trésorerie sort
--     le montant réel en DH (payments.amount), le fournisseur 4411 est soldé au taux
--     de la facture (payments.settled_amount) ; la différence est une perte de change
--     (6331, débit) ou un gain de change (7331, crédit), réalisée au règlement ;
--   - le restant dû d'une facture en devise se suit en devise (foreign_paid_amount).
-- Les écarts latents sur factures ouvertes (réévaluation au taux du jour) sont
-- calculés pour information, sans écriture automatique (écarts de conversion de clôture).
--
-- Rollback :
--   DROP TRIGGER invoices_currency ON invoices ; DROP FUNCTION trg_invoices_currency() ;
--   ALTER TABLE invoices DROP COLUMN currency_code, DROP COLUMN exchange_rate, DROP COLUMN foreign_total_amount, DROP COLUMN foreign_paid_amount ;
--   ALTER TABLE payments DROP COLUMN currency_code, DROP COLUMN exchange_rate, DROP COLUMN foreign_amount, DROP COLUMN settled_amount, DROP COLUMN fx_difference ;
--   DELETE FROM posting_profiles WHERE event_type IN ('fx_loss', 'fx_gain') ; DELETE FROM accounts WHERE code IN ('6331', '7331') ;
--   et restaurer fn_refresh_invoice_vat (SUM(amount)).

-- ─── 1. Comptes et profils ────────────────────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active)
VALUES ('6331', 'Pertes de change propres à l''exercice', 6, '63', '633', 'expense', 'D', false, true),
       ('7331', 'Gains de change propres à l''exercice', 7, '73', '733', 'revenue', 'C', false, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO posting_profiles (event_type, account_code, description) VALUES
  ('fx_loss', '6331', 'Perte de change réalisée au règlement d''une facture en devise (mig 368)'),
  ('fx_gain', '7331', 'Gain de change réalisé au règlement d''une facture en devise (mig 368)')
ON CONFLICT DO NOTHING;

-- ─── 2. Factures ──────────────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS foreign_total_amount NUMERIC(14,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS foreign_paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN invoices.exchange_rate IS 'Taux de la facture (DH pour 1 unité) : celui du BC pour une facture de BC (mig 368).';
COMMENT ON COLUMN invoices.foreign_total_amount IS 'Total TTC en devise ; NULL pour une facture en DH (mig 368).';

-- Une facture de BC en devise hérite de sa devise et de son taux ; le total en devise
-- suit le total DH quel que soit le chemin de création ou de modification.
CREATE OR REPLACE FUNCTION trg_invoices_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cur CHAR(3); v_rate NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purchase_order_id IS NOT NULL AND NEW.currency_code = 'MAD' THEN
    SELECT currency_code, exchange_rate INTO v_cur, v_rate FROM purchase_orders WHERE id = NEW.purchase_order_id;
    IF v_cur IS NOT NULL AND v_cur <> 'MAD' THEN
      NEW.currency_code := v_cur; NEW.exchange_rate := v_rate;
    END IF;
  END IF;
  IF NEW.currency_code = 'MAD' THEN
    NEW.exchange_rate := 1; NEW.foreign_total_amount := NULL;
  ELSE
    NEW.foreign_total_amount := round(NEW.total_amount / NEW.exchange_rate, 2);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoices_currency ON invoices;
CREATE TRIGGER invoices_currency BEFORE INSERT OR UPDATE OF total_amount, currency_code, exchange_rate ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoices_currency();

-- Factures déjà créées depuis un BC en devise (mig 363) : reprise.
UPDATE invoices i SET currency_code = po.currency_code, exchange_rate = po.exchange_rate
  FROM purchase_orders po
 WHERE po.id = i.purchase_order_id AND po.currency_code <> 'MAD' AND i.currency_code = 'MAD';

-- ─── 3. Règlements ────────────────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS foreign_amount NUMERIC(14,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(14,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fx_difference NUMERIC(14,2);
COMMENT ON COLUMN payments.amount IS 'Montant en DH sorti (ou entré) en trésorerie ; pour un règlement en devise : devise × taux du jour du paiement.';
COMMENT ON COLUMN payments.settled_amount IS 'Part de la facture soldée en DH au taux de la facture (mig 368) ; NULL = amount.';
COMMENT ON COLUMN payments.fx_difference IS 'amount − settled_amount : > 0 perte de change (6331), < 0 gain de change (7331) (mig 368).';

-- La TVA récupérable au paiement compare le cumul soldé au total de la facture.
CREATE OR REPLACE FUNCTION fn_refresh_invoice_vat(p_invoice uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_inv invoices%ROWTYPE; v_paid numeric; v_last date; v_cash boolean;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR v_inv.invoice_type <> 'received' THEN RETURN; END IF;
  SELECT COALESCE(SUM(COALESCE(settled_amount, amount)), 0),
         MAX(payment_date) FILTER (WHERE status <> 'void' AND amount > 0),
         bool_or(non_deductible AND status <> 'void')
    INTO v_paid, v_last, v_cash
    FROM payments WHERE invoice_id = p_invoice;
  UPDATE invoices SET
    vat_recoverable_from = CASE WHEN v_paid >= total_amount - 0.01 AND total_amount > 0 THEN v_last END,
    is_vat_recoverable = CASE
      WHEN COALESCE(v_cash, false) THEN false
      WHEN vat_non_recoverable_reason = 'cash_over_limit' THEN true
      ELSE is_vat_recoverable END,
    vat_non_recoverable_reason = CASE
      WHEN COALESCE(v_cash, false) THEN 'cash_over_limit'
      WHEN vat_non_recoverable_reason = 'cash_over_limit' THEN NULL
      ELSE vat_non_recoverable_reason END
  WHERE id = p_invoice
    AND (vat_recoverable_from IS DISTINCT FROM CASE WHEN v_paid >= total_amount - 0.01 AND total_amount > 0 THEN v_last END
         OR COALESCE(v_cash, false) <> (vat_non_recoverable_reason IS NOT DISTINCT FROM 'cash_over_limit'));
END $$;
