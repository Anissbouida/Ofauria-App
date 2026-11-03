-- ═══════════════════════════════════════════════════════════════════════
-- 439 — Cycle de vente (O2C), lot L0 : correctifs bloquants
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 5.2 (G-GI-12, G-IV-03/04/07)
--
--   1. Types de mouvements produits finis : le code écrivait 'adjust' et
--      'retour_invendus', refusés par la contrainte → la transaction entière
--      échouait (retour d'invendus, régularisation de surplus, suppression
--      d'une perte, contrôle d'ouverture). Le code passe à 'adjustment' et
--      'unsold_return' ; on ouvre aussi les types d'expédition du lot L1.
--   2. Facture client validée : en-tête figé (montants, date, client) et
--      lignes non modifiables, correction par annulation (avoir) ; annulation
--      refusée si un règlement existe. La transaction qui crée la facture
--      reste libre d'insérer ses lignes : on la reconnaît à created_at = now()
--      (now() est l'heure de début de la transaction en cours, comme SYSDATE
--      figé d'une transaction), ce qui tient aussi à travers les SAVEPOINT.
--
-- Rollback : restaurer les CHECK de 088/316 ; DROP TRIGGER
--   trg_guard_emitted_invoice_lock ON invoices, trg_guard_emitted_invoice_items ON invoice_items.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Types de mouvements ──────────────────────────────────────────────
ALTER TABLE product_stock_transactions DROP CONSTRAINT IF EXISTS product_stock_transactions_type_check;
ALTER TABLE product_stock_transactions ADD CONSTRAINT product_stock_transactions_type_check CHECK (type IN (
  'production', 'sale', 'return', 'adjustment', 'waste', 'exchange', 'loss', 'replenishment_in',
  'unsold_return', 'delivery', 'delivery_reversal'));

ALTER TABLE product_lot_movements DROP CONSTRAINT IF EXISTS product_lot_movements_kind_check;
ALTER TABLE product_lot_movements ADD CONSTRAINT product_lot_movements_kind_check CHECK (kind IN (
  'display', 'sale', 'waste', 'recycle', 'return', 'delivery', 'delivery_reversal', 'adjustment'));

-- ─── 2. Facture client validée : verrou ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_guard_emitted_invoice_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_type = 'emitted' AND OLD.validation_status = 'validated' AND OLD.created_at <> now() THEN
    IF (NEW.amount, NEW.tax_amount, NEW.total_amount, NEW.invoice_date, NEW.customer_id, NEW.invoice_number)
       IS DISTINCT FROM (OLD.amount, OLD.tax_amount, OLD.total_amount, OLD.invoice_date, OLD.customer_id, OLD.invoice_number) THEN
      RAISE EXCEPTION 'Facture % validée : elle ne se modifie plus, la correction passe par son annulation (avoir)', OLD.invoice_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.invoice_type = 'emitted' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
     AND COALESCE(OLD.paid_amount, 0) > 0.005 THEN
    RAISE EXCEPTION 'Facture % réglée (%) : annulez d''abord ses règlements', OLD.invoice_number, OLD.paid_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_emitted_invoice_lock ON invoices;
CREATE TRIGGER trg_guard_emitted_invoice_lock BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_guard_emitted_invoice_lock();

CREATE OR REPLACE FUNCTION fn_guard_emitted_invoice_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = v_id AND invoice_type = 'emitted'
               AND validation_status = 'validated' AND created_at <> now()) THEN
    RAISE EXCEPTION 'Lignes d''une facture client validée : non modifiables (correction par avoir)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Une ligne déplacée vers une autre facture ne quitte pas non plus une facture validée.
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
     AND EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND invoice_type = 'emitted'
                   AND validation_status = 'validated' AND created_at <> now()) THEN
    RAISE EXCEPTION 'Lignes d''une facture client validée : non modifiables (correction par avoir)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_guard_emitted_invoice_items ON invoice_items;
CREATE TRIGGER trg_guard_emitted_invoice_items BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION fn_guard_emitted_invoice_items();

-- ─── 3. Facture client : validée dès sa création ─────────────────────────
-- La mig 438 (P2P L1) passe le défaut de validation_status à 'draft' pour que
-- la facture REÇUE naisse en brouillon ; la facture client, elle, n'a pas de
-- brouillon (elle naît du BL ou de la facturation périodique, numérotée dans
-- la série continue) : elle reste validée dès l'insertion.
CREATE OR REPLACE FUNCTION fn_emitted_invoice_born_validated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_type = 'emitted' AND NEW.validation_status = 'draft' THEN
    NEW.validation_status := 'validated';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_emitted_invoice_born_validated ON invoices;
CREATE TRIGGER trg_emitted_invoice_born_validated BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_emitted_invoice_born_validated();

UPDATE invoices SET validation_status = 'validated'
 WHERE invoice_type = 'emitted' AND validation_status = 'draft';
