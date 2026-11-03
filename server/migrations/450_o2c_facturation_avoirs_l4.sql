-- ═══════════════════════════════════════════════════════════════════════
-- 450 — Cycle de vente (O2C), lot L4 : facturation sur livré et avoirs
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 L4 / § 5.5
--        (G-IV-01/02/06/08/09/10/11, G-OM-01)
--
--   1. Ligne de facture client rattachée à la ligne de BL qu'elle facture
--      (et à la ligne de commande) ; facturé net par ligne de BL tenu en base
--      et borné par le livré (contrôle différé au COMMIT).
--   2. Avoir client : pièce AV numérotée (série continue), liée à la facture
--      d'origine (ligne à ligne), avec un motif : annulation (les BL repassent
--      à facturer), retour, erreur de prix, geste commercial.
--   3. Imputation d'un avoir sur une facture : un règlement « avoir » qui
--      porte l'avoir (payments.credit_note_id), sans flux de trésorerie.
--   4. Encours client net des avoirs non imputés.
--   5. Tâche planifiée de facturation des BL (mensuelle / à chaque livraison).
--
-- Numéro 450 : 444-446 sont pris par la branche achats (P2P L3) en cours.
-- Rollback : DROP des colonnes, triggers et fonctions ajoutés ; DELETE de la
--   série credit_note_emitted et de la tâche monthly_invoicing.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Liens ligne à ligne ──────────────────────────────────────────────
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS delivery_note_item_id UUID REFERENCES delivery_note_items(id);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id);
-- Ligne d'avoir → ligne de la facture qu'elle crédite.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS credited_item_id UUID REFERENCES invoice_items(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_dni ON invoice_items (delivery_note_item_id) WHERE delivery_note_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_credited ON invoice_items (credited_item_id) WHERE credited_item_id IS NOT NULL;

ALTER TABLE delivery_note_items ADD COLUMN IF NOT EXISTS qty_invoiced NUMERIC(12,3) NOT NULL DEFAULT 0;

-- ─── 2. Avoirs clients ───────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credited_invoice_id UUID REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_reason VARCHAR(20);
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT chk_invoices_credit_reason
    CHECK (credit_reason IS NULL OR credit_reason IN ('cancellation', 'return', 'price', 'commercial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT chk_emitted_credit_note_origin
    CHECK (invoice_type <> 'emitted' OR kind <> 'credit_note' OR (credited_invoice_id IS NOT NULL AND credit_reason IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_invoices_credited ON invoices (credited_invoice_id) WHERE credited_invoice_id IS NOT NULL;

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('credit_note_emitted', 'Avoir client', 'accounting', 'AV-{YYYY}-{SEQ}', 4, 'year', 'invoices', 'invoice_number', true, 41)
ON CONFLICT (doc_type) DO NOTHING;

-- ─── 3. Imputation d'un avoir ────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS credit_note_id UUID REFERENCES invoices(id);
CREATE INDEX IF NOT EXISTS idx_payments_credit_note ON payments (credit_note_id) WHERE credit_note_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_credit_note_method
    CHECK (credit_note_id IS NULL OR payment_method = 'avoir');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Reprise des factures déjà émises depuis des BL ──────────────────────
-- Appariement ligne de facture ↔ ligne de BL par (facture, produit, quantité, prix),
-- dans l'ordre des BL. Les lignes de factures validées sont verrouillées (mig 439) :
-- le verrou laisse désormais poser les liens (aucun montant, aucune quantité ne change).
CREATE OR REPLACE FUNCTION fn_guard_emitted_invoice_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  -- Liens de traçabilité seuls (ligne de BL, de commande, ligne créditée) : permis.
  IF TG_OP = 'UPDATE'
     AND (NEW.invoice_id, NEW.product_id, NEW.ingredient_id, NEW.description, NEW.quantity, NEW.unit_price,
          NEW.subtotal, NEW.tva_rate, NEW.tva_amount, NEW.tax_code, NEW.category_id)
         IS NOT DISTINCT FROM
         (OLD.invoice_id, OLD.product_id, OLD.ingredient_id, OLD.description, OLD.quantity, OLD.unit_price,
          OLD.subtotal, OLD.tva_rate, OLD.tva_amount, OLD.tax_code, OLD.category_id) THEN
    RETURN NEW;
  END IF;
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
WITH ii AS (
  SELECT ii.id, ii.invoice_id, ii.product_id, ii.quantity, ii.unit_price,
         row_number() OVER (PARTITION BY ii.invoice_id, ii.product_id, ii.quantity, ii.unit_price ORDER BY ii.created_at, ii.id) AS rn
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE i.invoice_type = 'emitted' AND ii.delivery_note_item_id IS NULL
), dni AS (
  SELECT d.id, dn.invoice_id, d.product_id, d.quantity, d.unit_price, d.order_item_id,
         row_number() OVER (PARTITION BY dn.invoice_id, d.product_id, d.quantity, d.unit_price
                            ORDER BY dn.delivery_date, dn.number, d.description, d.id) AS rn
    FROM delivery_note_items d JOIN delivery_notes dn ON dn.id = d.delivery_note_id
   WHERE dn.invoice_id IS NOT NULL
)
UPDATE invoice_items x SET delivery_note_item_id = dni.id, order_item_id = dni.order_item_id
  FROM ii JOIN dni ON dni.invoice_id = ii.invoice_id AND dni.product_id IS NOT DISTINCT FROM ii.product_id
                  AND dni.quantity = ii.quantity AND dni.unit_price = ii.unit_price AND dni.rn = ii.rn
 WHERE x.id = ii.id;

UPDATE delivery_note_items d SET qty_invoiced = d.quantity
  FROM delivery_notes dn
 WHERE dn.id = d.delivery_note_id AND dn.status = 'invoiced' AND d.qty_invoiced = 0;

-- ─── 4. Facturé net ≤ livré, par ligne de BL ─────────────────────────────
-- Net = factures non annulées − avoirs d'annulation (seuls ceux-là rendent la
-- quantité à facturer ; un avoir de prix ou un geste commercial ne la rend pas).
CREATE OR REPLACE FUNCTION fn_refresh_dni_invoiced(p_dni UUID) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_net NUMERIC; v_delivered NUMERIC;
BEGIN
  IF p_dni IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN
                             CASE WHEN i.credit_reason = 'cancellation' THEN -ii.quantity ELSE 0 END
                           ELSE ii.quantity END), 0)
    INTO v_net
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.delivery_note_item_id = p_dni AND i.invoice_type = 'emitted' AND i.status <> 'cancelled';
  SELECT quantity INTO v_delivered FROM delivery_note_items WHERE id = p_dni;
  IF v_net > v_delivered + 0.0005 THEN
    RAISE EXCEPTION 'Ligne de BL facturée au-delà du livré (facturé %, livré %)', v_net, v_delivered USING ERRCODE = 'check_violation';
  END IF;
  IF v_net < -0.0005 THEN
    RAISE EXCEPTION 'Avoir au-delà de la quantité facturée sur la ligne de BL' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE delivery_note_items SET qty_invoiced = v_net WHERE id = p_dni AND qty_invoiced IS DISTINCT FROM v_net;
END $$;

CREATE OR REPLACE FUNCTION fn_invoice_items_dni_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM fn_refresh_dni_invoiced(OLD.delivery_note_item_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.delivery_note_item_id IS DISTINCT FROM OLD.delivery_note_item_id
                            OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN
    PERFORM fn_refresh_dni_invoiced(NEW.delivery_note_item_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_items_dni_guard ON invoice_items;
CREATE CONSTRAINT TRIGGER trg_invoice_items_dni_guard AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_invoice_items_dni_guard();

-- Une facture (ou un avoir) annulée change le net de ses lignes de BL.
CREATE OR REPLACE FUNCTION fn_invoice_status_dni_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.invoice_type = 'emitted' AND NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'cancelled' OR OLD.status = 'cancelled') THEN
    FOR r IN SELECT DISTINCT delivery_note_item_id AS id FROM invoice_items
              WHERE invoice_id = NEW.id AND delivery_note_item_id IS NOT NULL LOOP
      PERFORM fn_refresh_dni_invoiced(r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_status_dni_refresh ON invoices;
CREATE TRIGGER trg_invoice_status_dni_refresh AFTER UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_status_dni_refresh();

-- ─── 5. Encours net des avoirs non imputés (remplace la version de la mig 443) ──
CREATE OR REPLACE FUNCTION fn_customer_exposure(p_customer UUID, p_exclude_order UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT ROUND(
      COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = p_customer AND s.payment_status = 'unpaid'), 0)
      -- Factures client ouvertes (reste dû), moins les avoirs pas encore imputés.
    + COALESCE((SELECT SUM(CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END
                           * GREATEST(i.total_amount - COALESCE(i.paid_amount, 0), 0)) FROM invoices i
                 WHERE i.customer_id = p_customer AND i.invoice_type = 'emitted' AND i.status NOT IN ('paid', 'cancelled')), 0)
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

-- ─── 6. Facturation planifiée des BL ─────────────────────────────────────
-- Désactivée à l'installation : à son premier passage elle facturerait d'un coup tous les
-- BL livrés des mois passés. On l'active dans Paramètres › Tâches planifiées.
INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order, enabled) VALUES
  ('monthly_invoicing', 'Facturation des bons de livraison',
   'Facture les BL livrés non facturés : clients mensuels une fois le mois terminé (une facture par client et par mois, datée du dernier jour), clients « à chaque livraison » dès le lendemain.',
   'sales', 1440, 35, false)
ON CONFLICT (key) DO NOTHING;
