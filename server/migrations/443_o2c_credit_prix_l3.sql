-- ═══════════════════════════════════════════════════════════════════════
-- 443 — Cycle de vente (O2C), lot L3 : crédit et prix
--        docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 L3 (G-CR-01/02/03/05, G-OM-03/04/05)
--
--   1. Encours client unique (fn_customer_exposure), appelé par la commande,
--      la caisse et le BL : tickets impayés + factures client ouvertes + BL
--      livrés non facturés + reste à livrer des commandes ouvertes (net de
--      l'avance). Il remplace les deux calculs divergents d'avant.
--   2. Journal des contrôles de crédit : décision à chaque jalon (création,
--      confirmation, expédition) et dérogation de la direction, motivée.
--   3. Prix grille figé sur la ligne de commande (list_price) ; un prix saisi
--      différent est une dérogation tracée (auteur, motif).
--   4. Canal de vente porté par la commande et le devis (repris par le ticket
--      de remise) : « commande » pour un particulier, « gros » pour un pro.
--
-- Rollback : DROP FUNCTION fn_customer_exposure ; DROP TABLE credit_check_events ;
--   DROP des colonnes ajoutées.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Encours unique ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_customer_exposure(p_customer UUID, p_exclude_order UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT ROUND(
      -- Tickets de caisse à crédit non réglés.
      COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = p_customer AND s.payment_status = 'unpaid'), 0)
      -- Factures client ouvertes (reste dû).
    + COALESCE((SELECT SUM(GREATEST(i.total_amount - COALESCE(i.paid_amount, 0), 0)) FROM invoices i
                 WHERE i.customer_id = p_customer AND i.invoice_type = 'emitted' AND i.status NOT IN ('paid', 'cancelled')), 0)
      -- BL livrés non facturés (TTC).
    + COALESCE((SELECT SUM(dni.subtotal + ROUND(dni.subtotal * COALESCE(dni.tva_rate, 0) / 100, 2))
                  FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
                 WHERE dn.customer_id = p_customer AND dn.status = 'delivered'), 0)
      -- Commandes ouvertes : part non livrée de leur total, moins l'avance encaissée.
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

-- ─── 2. Journal des contrôles de crédit ──────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_check_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('order', 'quote', 'delivery_note', 'sale')),
  document_id   UUID,
  checkpoint    VARCHAR(20) NOT NULL CHECK (checkpoint IN ('create', 'confirm', 'ship', 'sale')),
  exposure      NUMERIC(12,2) NOT NULL,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_limit  NUMERIC(12,2),
  on_hold       BOOLEAN NOT NULL DEFAULT false,
  decision      VARCHAR(10) NOT NULL CHECK (decision IN ('pass', 'warn', 'block', 'override')),
  decided_by    UUID REFERENCES users(id),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (decision <> 'override' OR (decided_by IS NOT NULL AND NULLIF(btrim(reason), '') IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_check_events_customer ON credit_check_events (customer_id, created_at DESC);

-- ─── 3. Prix grille et dérogation ────────────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS list_price NUMERIC(12,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_override_by UUID REFERENCES users(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_override_reason TEXT;
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT chk_order_items_override_reason
    CHECK (price_override_by IS NULL OR NULLIF(btrim(price_override_reason), '') IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 4. Canal de vente ───────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES sales_channels(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES sales_channels(id);
-- Reprise : « gros » pour les clients professionnels, « commande » pour les autres.
UPDATE orders o SET channel_id = (SELECT id FROM sales_channels WHERE code = CASE
         WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND COALESCE(c.customer_type, 'particulier') <> 'particulier')
         THEN 'gros' ELSE 'commande' END)
 WHERE o.channel_id IS NULL;
UPDATE quotes q SET channel_id = (SELECT id FROM sales_channels WHERE code = CASE
         WHEN EXISTS (SELECT 1 FROM customers c WHERE c.id = q.customer_id AND COALESCE(c.customer_type, 'particulier') <> 'particulier')
         THEN 'gros' ELSE 'commande' END)
 WHERE q.channel_id IS NULL;
-- Tickets issus d'une commande (avance, remise) : canal de la commande.
UPDATE sales s SET channel_id = o.channel_id FROM orders o
 WHERE s.order_id = o.id AND s.channel_id IS NULL AND o.channel_id IS NOT NULL;
