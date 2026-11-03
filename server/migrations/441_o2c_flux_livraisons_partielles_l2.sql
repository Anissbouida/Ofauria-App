-- ═══════════════════════════════════════════════════════════════════════
-- 441 — Cycle de vente (O2C), lot L2 : flux documentaire et livraisons
--        partielles — docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 L2
--        (G-OM-02/06, G-GI-05/06/07/09, G-FF-01/02/03)
--
--   1. Machine à états des commandes : une table de transitions permises et un
--      trigger qui refuse le reste (fini « prête → en attente »). Statut
--      'partially_delivered' : une partie livrée, un reliquat attendu.
--      Réouverture d'une commande terminée ou partiellement livrée permise
--      uniquement pour l'annulation d'un BL (contrôlée par l'application).
--   2. Cumuls par ligne de commande, tenus par les pièces : livré (BL),
--      facturé (facture client), annulé (reliquat soldé). Livré + annulé ≤
--      commandé, facturé ≤ livré.
--   3. Plusieurs BL par commande (livraisons successives d'un reliquat) :
--      l'index d'unicité commande → BL disparaît.
--   4. Tolérance de sur-livraison par client (pesées, casse), en pourcentage.
--
-- Rollback : DROP TRIGGER trg_order_status_guard ON orders ; DROP TABLE
--   order_status_transitions ; DROP des colonnes ajoutées ; recréer
--   uq_delivery_notes_order ; restaurer orders_status_check.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Machine à états ──────────────────────────────────────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending', 'confirmed', 'in_production', 'ready', 'partially_delivered', 'completed', 'cancelled'));

CREATE TABLE IF NOT EXISTS order_status_transitions (
  from_status VARCHAR(30) NOT NULL,
  to_status   VARCHAR(30) NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO order_status_transitions (from_status, to_status) VALUES
  ('pending', 'confirmed'), ('pending', 'in_production'), ('pending', 'ready'), ('pending', 'cancelled'),
  ('confirmed', 'pending'), ('confirmed', 'in_production'), ('confirmed', 'ready'), ('confirmed', 'cancelled'),
  ('in_production', 'confirmed'), ('in_production', 'ready'), ('in_production', 'cancelled'),
  ('ready', 'partially_delivered'), ('ready', 'completed'), ('ready', 'cancelled'),
  ('partially_delivered', 'completed'), ('partially_delivered', 'ready'),
  -- Réouverture par annulation d'un BL (seul chemin applicatif autorisé).
  ('completed', 'ready'), ('completed', 'partially_delivered')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_order_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
       SELECT 1 FROM order_status_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Transition de commande interdite : % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_status_guard ON orders;
CREATE TRIGGER trg_order_status_guard BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_order_status_guard();

-- La réservation de stock se solde aussi à la livraison partielle puis complète :
-- la fonction de la mig 389 réagit au passage à « terminée » ; inchangée.

-- ─── 2. Cumuls par ligne ─────────────────────────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_delivered NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_invoiced  NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_cancelled NUMERIC(12,3) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT chk_order_items_cumuls CHECK (
    qty_delivered >= 0 AND qty_invoiced >= 0 AND qty_cancelled >= 0 AND qty_invoiced <= qty_delivered);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reprise : les commandes déjà livrées par BL ou remises en caisse sont livrées en entier.
UPDATE order_items oi SET qty_delivered = oi.quantity
  FROM orders o
 WHERE o.id = oi.order_id AND o.status = 'completed' AND oi.qty_delivered = 0;
UPDATE order_items oi SET qty_invoiced = oi.qty_delivered
  FROM orders o
 WHERE o.id = oi.order_id AND oi.qty_invoiced = 0
   AND (EXISTS (SELECT 1 FROM delivery_notes dn WHERE dn.order_id = o.id AND dn.status = 'invoiced')
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.invoice_type = 'emitted' AND i.status <> 'cancelled'));

-- ─── 3. Plusieurs BL par commande ────────────────────────────────────────
DROP INDEX IF EXISTS uq_delivery_notes_order;
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order ON delivery_notes (order_id) WHERE order_id IS NOT NULL;

-- ─── 4. Tolérance de sur-livraison par client ────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS over_delivery_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT chk_customers_over_delivery CHECK (over_delivery_tolerance_pct BETWEEN 0 AND 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 5. Dérive de schéma ─────────────────────────────────────────────────
-- Colonnes lues et écrites par les commandes (client de passage) mais créées
-- hors migration sur certaines bases : une base montée depuis les migrations
-- seules faisait échouer la modification d'une commande.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30);
