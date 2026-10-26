-- Migration 354 : deux processus de commande — particuliers (caisse) et professionnels (direction)
--
-- POURQUOI
--   Une commande de particulier se règle en caisse (avance non remboursable,
--   solde intégral au retrait) ; une commande de professionnel est gérée par la
--   direction (prix remisé, TVA par ligne, livraison sur BL signé, facture selon
--   le rythme du client, règlement par la direction uniquement).
--
-- PORTEE
--   1. order_items.tva_rate : TVA par ligne des commandes de professionnels
--      (prix HT) ; NULL pour les particuliers (prix TTC caisse).
--   2. customers.billing_frequency : rythme de facturation d'un professionnel —
--      'per_delivery' (facture à chaque BL) ou 'monthly' (BL regroupés).
--   3. order_reschedules : journal des reports de date de retrait (qui, quand,
--      ancienne/nouvelle date, motif, forcé par la direction à moins de 24 h).
--   4. orders.cancelled_at / cancelled_by / cancel_reason : annulation tracée
--      (l'avance d'un particulier reste acquise).
--   5. delivery_notes.received_by_name / received_at : réception signée du BL.
--   6. Ticket fantôme VNT-20260726-0001 : créé par l'ancien règlement de la
--      facture FE-2026-0001 (commande CMD-20260616-0001), il comptait une
--      seconde fois en ventes un montant déjà porté par la facture. Sans ligne,
--      sans session de caisse ni écriture : il est supprimé (garde-fous ci-dessous).
--
-- INVERSION
--   ALTER TABLE order_items DROP COLUMN tva_rate;
--   ALTER TABLE customers DROP COLUMN billing_frequency;
--   DROP TABLE order_reschedules;
--   ALTER TABLE orders DROP COLUMN cancelled_at, DROP COLUMN cancelled_by, DROP COLUMN cancel_reason;
--   ALTER TABLE delivery_notes DROP COLUMN received_by_name, DROP COLUMN received_at;
--   Ticket : INSERT INTO sales (id, sale_number, customer_id, user_id, subtotal, tax_amount, discount_amount, total,
--            payment_method, notes, created_at, store_id, sale_type, payment_status, paid_at)
--            VALUES ('c932ee4e-85d0-405f-a301-392b82bc1352', 'VNT-20260726-0001', <client>, <user>, 3160.40, 0, 0, 3160.40,
--            'bank', 'Livraison commande CMD-20260616-0001 — Paiement facture FE-2026-0001', '2026-07-27 03:46:58.949368+00',
--            '00000000-0000-0000-0000-000000000001', 'standard', 'paid', '2026-07-27 03:46:58.949368+00');

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tva_rate NUMERIC(5, 2);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_billing_frequency_check') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_billing_frequency_check
      CHECK (billing_frequency IN ('per_delivery', 'monthly'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_reschedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_pickup_date TIMESTAMPTZ,
  new_pickup_date TIMESTAMPTZ NOT NULL,
  reason TEXT,
  forced BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_reschedules_order ON order_reschedules(order_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS received_by_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

DELETE FROM sales s
 WHERE s.id = 'c932ee4e-85d0-405f-a301-392b82bc1352'
   AND s.sale_number = 'VNT-20260726-0001'
   AND s.session_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.original_sale_id = s.id OR r.exchange_sale_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_id = s.id);
