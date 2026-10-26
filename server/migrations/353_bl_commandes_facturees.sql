-- Migration 353 : bons de livraison des commandes déjà facturées
--
-- POURQUOI
--   Les bons de livraison clients (mig 352) n'existaient pas avant : les
--   commandes de professionnels livrées puis facturées directement depuis la
--   commande (« Générer la facture ») n'ont aucun BL, l'historique des
--   livraisons est incomplet. Désormais la facture depuis commande crée son BL
--   (services/order-delivery-note.ts) ; cette reprise fait de même pour le passé.
--
-- PORTEE
--   Pour chaque facture client active rattachée à une commande avec fiche client
--   et sans BL : un BL « facturé », rattaché à la facture, daté de la livraison
--   (la plus ancienne date entre fin de commande et date de facture), avec les
--   lignes de la facture. Numérotés dans l'ordre chronologique. Aucune écriture,
--   aucun montant ni statut de facture modifié. Idempotent.
--
-- INVERSION
--   DELETE FROM delivery_notes WHERE notes LIKE 'Reprise mig 353%';

DO $$
DECLARE
  r record;
  v_number text;
  v_note uuid;
BEGIN
  FOR r IN
    SELECT i.id AS invoice_id, i.invoice_number, i.store_id, i.created_by, o.id AS order_id, o.order_number, o.customer_id,
           LEAST((o.completed_at AT TIME ZONE 'Africa/Casablanca')::date, i.invoice_date) AS delivery_date, i.invoice_date
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
     WHERE i.invoice_type = 'emitted' AND i.status <> 'cancelled' AND o.customer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.order_id = o.id AND d.status <> 'cancelled')
     ORDER BY LEAST((o.completed_at AT TIME ZONE 'Africa/Casablanca')::date, i.invoice_date), i.invoice_number
  LOOP
    v_number := next_document_number('delivery_note', COALESCE(r.delivery_date, r.invoice_date));
    INSERT INTO delivery_notes (number, customer_id, store_id, order_id, delivery_date, status, invoice_id, notes, created_by)
    VALUES (v_number, r.customer_id, r.store_id, r.order_id, COALESCE(r.delivery_date, r.invoice_date), 'invoiced', r.invoice_id,
            'Reprise mig 353 : livraison de la commande ' || r.order_number || ', facturée par ' || r.invoice_number, r.created_by)
    RETURNING id INTO v_note;
    INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, tva_rate, subtotal)
    SELECT v_note, ii.product_id, COALESCE(NULLIF(btrim(ii.description), ''), p.name, 'Article'), ii.quantity, ii.unit_price, ii.tva_rate,
           ROUND(COALESCE(ii.subtotal, ii.quantity * ii.unit_price), 2)
      FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id = r.invoice_id AND ii.quantity > 0 AND ii.unit_price >= 0;
  END LOOP;
END $$;
