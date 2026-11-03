-- ═══════════════════════════════════════════════════════════════════════
-- 451 — Cycle de vente (O2C), lot L5 : encaissement
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 L5 / § 5.6 (G-CA-01/02/03/06/07)
--
--   1. Un règlement client se répartit sur plusieurs factures
--      (payment_allocations) ; le « réglé » d'une facture client est la somme
--      de ses affectations. Le client porte le règlement (payments.customer_id).
--   2. La part non affectée est une avance du client (4421, plus de produit
--      7585) ; elle s'affecte plus tard à une facture (écriture 4421 → 3421).
--   3. Axe de lettrage par facture sur les lignes d'écriture (invoice_id) :
--      un règlement réparti se lettre facture par facture.
--   4. Ticket à crédit : créance 3421 dès la vente (sales.sold_on_credit),
--      soldée par l'écriture d'encaissement.
--
-- Rollback : DROP TABLE payment_allocations ; DROP des colonnes ajoutées ;
--   DELETE du profil customer_advance ; restaurer fn_customer_exposure (mig 450).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Client du règlement ──────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_id) WHERE customer_id IS NOT NULL;
UPDATE payments p SET customer_id = i.customer_id
  FROM invoices i
 WHERE i.id = p.invoice_id AND i.invoice_type = 'emitted' AND p.customer_id IS NULL AND i.customer_id IS NOT NULL;

-- ─── 2. Affectations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  -- Montant soldé sur la facture, en DH au taux de la facture.
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  -- true : passée dans l'écriture du règlement ; false : affectation ultérieure
  -- d'une avance, avec sa propre écriture 4421 → 3421.
  posted_with_payment BOOLEAN NOT NULL DEFAULT true,
  allocated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_by        UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations (invoice_id);

-- Reprise : un règlement client existant = une affectation à sa facture.
INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_at, allocated_by)
SELECT p.id, p.invoice_id, COALESCE(p.settled_amount, p.amount), p.created_at, p.created_by
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
 WHERE p.type = 'income' AND i.invoice_type = 'emitted' AND p.voids_payment_id IS NULL AND p.amount > 0
   AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id);

-- Règlement saisi sur une facture client (chemin historique, imputation d'avoir) :
-- client renseigné et affectation créée d'office.
CREATE OR REPLACE FUNCTION fn_payment_customer_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT customer_id INTO NEW.customer_id FROM invoices WHERE id = NEW.invoice_id AND invoice_type = 'emitted';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payment_customer_fill ON payments;
CREATE TRIGGER trg_payment_customer_fill BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_customer_fill();

CREATE OR REPLACE FUNCTION fn_payment_auto_allocate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'income' AND NEW.invoice_id IS NOT NULL AND NEW.voids_payment_id IS NULL AND NEW.amount > 0
     AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND invoice_type = 'emitted') THEN
    INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_by)
    VALUES (NEW.id, NEW.invoice_id, COALESCE(NEW.settled_amount, NEW.amount), NEW.created_by);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_payment_auto_allocate ON payments;
CREATE TRIGGER trg_payment_auto_allocate AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_auto_allocate();

-- Affecté ≤ règlement (au COMMIT).
CREATE OR REPLACE FUNCTION fn_payment_alloc_le_amount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_pid uuid := COALESCE(NEW.payment_id, OLD.payment_id);
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE payment_id = v_pid)
     > (SELECT COALESCE(settled_amount, amount) FROM payments WHERE id = v_pid) + 0.005 THEN
    RAISE EXCEPTION 'Règlement affecté au-delà de son montant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_payment_alloc_le_amount ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_payment_alloc_le_amount AFTER INSERT OR UPDATE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_payment_alloc_le_amount();

-- ─── 3. Avance client : compte et profil ─────────────────────────────────
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side)
VALUES ('4421', 'Clients - Avances et acomptes reçus sur commandes en cours', 4, '44', '442', 'liability', 'C')
ON CONFLICT (code) DO NOTHING;
INSERT INTO posting_profiles (event_type, account_code, description)
VALUES ('customer_advance', '4421', 'Règlement client non affecté à une facture : avance du client (O2C L5, mig 451)')
ON CONFLICT DO NOTHING;

-- ─── 4. Axe de lettrage par facture ──────────────────────────────────────
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);
CREATE INDEX IF NOT EXISTS idx_jel_invoice ON journal_entry_lines (invoice_id) WHERE invoice_id IS NOT NULL;

-- ─── 5. Ticket à crédit ──────────────────────────────────────────────────
-- Les tickets impayés antérieurs n'ont pas d'écriture : ils restent sur le chemin
-- historique (écriture de vente complète à l'encaissement).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sold_on_credit BOOLEAN NOT NULL DEFAULT false;

-- ─── 6. Encours net des avances non affectées (remplace la version de la mig 450) ──
CREATE OR REPLACE FUNCTION fn_customer_exposure(p_customer UUID, p_exclude_order UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT ROUND(
      COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = p_customer AND s.payment_status = 'unpaid'), 0)
    + COALESCE((SELECT SUM(CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END
                           * GREATEST(i.total_amount - COALESCE(i.paid_amount, 0), 0)) FROM invoices i
                 WHERE i.customer_id = p_customer AND i.invoice_type = 'emitted' AND i.status NOT IN ('paid', 'cancelled')), 0)
      -- Règlements reçus pas encore affectés à une facture (avances).
    - COALESCE((SELECT SUM(GREATEST(COALESCE(p.settled_amount, p.amount)
                                    - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0), 0))
                  FROM payments p
                 WHERE p.customer_id = p_customer AND p.type = 'income' AND p.status <> 'void'
                   AND p.voids_payment_id IS NULL AND p.credit_note_id IS NULL), 0)
    + COALESCE((SELECT SUM(dni.subtotal + ROUND(dni.subtotal * COALESCE(dni.tva_rate, 0) / 100, 2))
                  FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
                 WHERE dn.customer_id = p_customer AND dn.status = 'delivered'), 0)
    + COALESCE((SELECT SUM(GREATEST(o.total * x.rest_ratio - COALESCE(o.advance_amount, 0), 0))
                  FROM orders o
                  JOIN LATERAL (
                    SELECT CASE WHEN SUM(oi.quantity) > 0
                                THEN SUM(GREATEST(oi.quantity - oi.qty_delivered - oi.qty_cancelled, 0)) / SUM(oi.quantity)
                                ELSE 0 END AS rest_ratio
                      FROM order_items oi WHERE oi.order_id = o.id) x ON true
                 WHERE o.customer_id = p_customer AND o.status NOT IN ('completed', 'cancelled')
                   AND (p_exclude_order IS NULL OR o.id <> p_exclude_order)
                   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.invoice_type = 'emitted' AND i.status <> 'cancelled')), 0)
  , 2)
$$;
