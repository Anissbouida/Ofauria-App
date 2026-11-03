-- Facture = pièce du fournisseur (analyse d'écart P2P, lot L1 —
-- docs/AUDIT_P2P_GAP_ANALYSIS.md).
--
-- Aujourd'hui 81 % des factures reçues sont FABRIQUÉES depuis le bon de
-- réception (quantités = quantité livrée, prix = dernier prix reçu) et naissent
-- « validées » : la facture ne porte jamais le n° ni les montants IMPRIMÉS du
-- fournisseur (declared_ht/vat/ttc restent NULL). Du coup le rapprochement à
-- trois (commande / réception / facture) ne compare la facture qu'à elle-même.
--
-- Ce lot rend la facture reçue à son rôle de pièce du fournisseur :
--   (1) elle naît en BROUILLON ;
--   (2) un drapeau marque les factures auto d'historique sans pièce, sans les rouvrir ;
--   (3) on ne peut la VALIDER qu'avec n° fournisseur + total TTC déclaré ;
--   (4) un compteur « facturé » par ligne de BC (qty_invoiced_base), alimenté par
--       des événements append-only IR / IR_REVERSAL comme reçu/annulé le sont ;
--   (5) la ligne de facture garde son lien vers la ligne de réception / de BC.
-- Le POSTING comptable (GR/IR, écart de prix) n'est pas touché ici : il relève
-- du lot L3 (prix et valorisation).

-- (1) La facture reçue naît en brouillon ; validée seulement après confrontation.
ALTER TABLE invoices ALTER COLUMN validation_status SET DEFAULT 'draft';

-- (2) Drapeau « pièce fournisseur manquante » + reprise de l'historique sans rouvrir.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS needs_supplier_document BOOLEAN NOT NULL DEFAULT false;
UPDATE invoices SET needs_supplier_document = true
 WHERE invoice_type = 'received' AND source IN ('legacy_auto', 'from_receipt')
   AND (NULLIF(btrim(supplier_invoice_number), '') IS NULL OR declared_ttc IS NULL)
   AND needs_supplier_document = false;
COMMENT ON COLUMN invoices.needs_supplier_document IS
  'Facture d''historique née sans pièce fournisseur (n° + TTC déclaré) ; marquée sans être rouverte (mig 438, lot L1 P2P).';

-- (3) Valider une facture reçue exige la pièce : n° fournisseur + total TTC imprimé.
--     Le contrôle porte sur la transition brouillon → validée (UPDATE) ; la
--     création en brouillon n'est pas gênée.
CREATE OR REPLACE FUNCTION fn_invoice_validation_requires_document() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_type = 'received' AND NEW.kind IN ('invoice', 'credit_note')
     AND NEW.validation_status = 'validated'
     AND OLD.validation_status IS DISTINCT FROM 'validated'
     AND (NULLIF(btrim(NEW.supplier_invoice_number), '') IS NULL OR NEW.declared_ttc IS NULL) THEN
    RAISE EXCEPTION 'Validation impossible : numéro et total TTC de la facture fournisseur requis'
      USING ERRCODE = 'OF409';
  END IF;
  IF NEW.validation_status = 'validated' AND OLD.validation_status IS DISTINCT FROM 'validated' THEN
    NEW.validated_at := COALESCE(NEW.validated_at, now());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_invoice_requires_document ON invoices;
CREATE TRIGGER trg_invoice_requires_document BEFORE UPDATE OF validation_status ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_validation_requires_document();

-- (4) Compteur « facturé » par ligne de BC, tenu comme reçu/annulé (journal d'événements).
ALTER TABLE po_line_events DROP CONSTRAINT IF EXISTS po_line_events_event_type_check;
ALTER TABLE po_line_events ADD CONSTRAINT po_line_events_event_type_check
  CHECK (event_type IN ('GR', 'GR_REVERSAL', 'CANCEL', 'CANCEL_REVERSAL', 'LEGACY_ADJUST', 'IR', 'IR_REVERSAL'));
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS qty_invoiced_base NUMERIC(14,4) NOT NULL DEFAULT 0;
COMMENT ON COLUMN purchase_order_items.qty_invoiced_base IS
  'Quantité facturée (base), tenue par les événements IR/IR_REVERSAL de po_line_events, posés à la validation / annulation de la facture (mig 438, lot L1 P2P).';

-- Le trigger d'application (mig 307) maintient aussi qty_invoiced_base, dans la
-- même fenêtre app.po_events que les autres compteurs, et refuse la sur-facturation.
CREATE OR REPLACE FUNCTION trg_po_line_events_apply()
RETURNS TRIGGER AS $$
DECLARE
  v_line purchase_order_items%ROWTYPE;
  v_tol  NUMERIC;
  v_po   TEXT;
BEGIN
  PERFORM set_config('app.po_events', 'on', true);
  UPDATE purchase_order_items SET
    qty_received_base  = qty_received_base  + CASE WHEN NEW.event_type IN ('GR', 'GR_REVERSAL', 'LEGACY_ADJUST') THEN NEW.sign * NEW.qty_base ELSE 0 END,
    qty_cancelled_base = qty_cancelled_base + CASE WHEN NEW.event_type IN ('CANCEL', 'CANCEL_REVERSAL') THEN NEW.sign * NEW.qty_base ELSE 0 END,
    qty_invoiced_base  = qty_invoiced_base  + CASE WHEN NEW.event_type IN ('IR', 'IR_REVERSAL') THEN NEW.sign * NEW.qty_base ELSE 0 END
  WHERE id = NEW.po_line_id
  RETURNING * INTO v_line;
  -- Pendant la reprise, le compteur historique fait foi jusqu'au rapprochement final.
  IF COALESCE(current_setting('app.backfill', true), '') <> 'on' THEN
    UPDATE purchase_order_items SET quantity_delivered = qty_received_base
     WHERE id = NEW.po_line_id AND quantity_delivered IS DISTINCT FROM qty_received_base;
  END IF;
  PERFORM set_config('app.po_events', '', true);

  IF v_line.qty_received_base < -0.0001 OR v_line.qty_cancelled_base < -0.0001 OR v_line.qty_invoiced_base < -0.0001 THEN
    RAISE EXCEPTION 'Ligne de BC : compteur négatif (reçu %, annulé %, facturé %)',
      v_line.qty_received_base, v_line.qty_cancelled_base, v_line.qty_invoiced_base
      USING ERRCODE = 'OF409';
  END IF;

  -- Sur-réception : inchangé (ne concerne que reçu + clôturé vs commandé).
  IF COALESCE(current_setting('app.backfill', true), '') <> 'on'
     AND NEW.event_type IN ('GR', 'GR_REVERSAL', 'CANCEL', 'CANCEL_REVERSAL', 'LEGACY_ADJUST') AND NEW.sign > 0 THEN
    SELECT COALESCE((value ->> 'pct')::numeric, 0) INTO v_tol FROM module_parameters WHERE key = 'purchasing.over_receipt_tolerance_pct';
    IF v_line.qty_received_base + v_line.qty_cancelled_base > v_line.quantity_ordered * (1 + COALESCE(v_tol, 0) / 100) + 0.0001 THEN
      SELECT order_number INTO v_po FROM purchase_orders WHERE id = v_line.purchase_order_id;
      RAISE EXCEPTION 'BC % : la ligne dépasserait la quantité commandée (% reçu + % clôturé > % commandé, tolérance % %%)',
        v_po, v_line.qty_received_base, v_line.qty_cancelled_base, v_line.quantity_ordered, COALESCE(v_tol, 0)
        USING ERRCODE = 'OF409';
    END IF;
  END IF;

  -- Sur-facturation : on ne facture pas plus qu'on a reçu (tolérance quantité globale).
  IF COALESCE(current_setting('app.backfill', true), '') <> 'on' AND NEW.event_type = 'IR' AND NEW.sign > 0 THEN
    SELECT COALESCE(qty_pct, 0) INTO v_tol FROM match_tolerances WHERE scope_type = 'global' AND scope_id IS NULL LIMIT 1;
    IF v_line.qty_invoiced_base > v_line.qty_received_base * (1 + COALESCE(v_tol, 0) / 100) + 0.0001 THEN
      SELECT order_number INTO v_po FROM purchase_orders WHERE id = v_line.purchase_order_id;
      RAISE EXCEPTION 'BC % : la ligne serait sur-facturée (% facturé > % reçu, tolérance % %%)',
        v_po, v_line.qty_invoiced_base, v_line.qty_received_base, COALESCE(v_tol, 0)
        USING ERRCODE = 'OF409';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- La garde des compteurs protège aussi qty_invoiced_base : il ne bouge que par événement.
CREATE OR REPLACE FUNCTION trg_poi_counters_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(current_setting('app.po_events', true), '') <> 'on'
     AND (NEW.quantity_delivered IS DISTINCT FROM OLD.quantity_delivered
          OR NEW.qty_received_base IS DISTINCT FROM OLD.qty_received_base
          OR NEW.qty_cancelled_base IS DISTINCT FROM OLD.qty_cancelled_base
          OR NEW.qty_invoiced_base IS DISTINCT FROM OLD.qty_invoiced_base) THEN
    RAISE EXCEPTION 'Les quantités d''une ligne de BC (reçu / clôturé / facturé) ne se modifient que par un événement de ligne'
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- (5) La ligne de facture reçue liée à un BC garde aussi son lien de réception.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS reception_voucher_item_id UUID
  REFERENCES reception_voucher_items(id);
CREATE INDEX IF NOT EXISTS ix_invoice_items_poi ON invoice_items(purchase_order_item_id);
CREATE INDEX IF NOT EXISTS ix_invoice_items_rvi ON invoice_items(reception_voucher_item_id);
