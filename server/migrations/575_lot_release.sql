-- M7-04 — Libération du lot.
-- Un lot de produit fini pour lequel le plan de contrôle a généré un contrôle final naît
-- « en attente de libération » (pending_release) : ni vendable, ni livrable, ni transférable
-- (le FEFO ne lit que les lots actifs, la caisse et le bon de livraison le refusent
-- explicitement). Il est libéré par un rôle qualité, ou automatiquement quand toutes ses
-- inspections sont conformes et que la politique quality.auto_release le permet.
-- Les matières suivent la quarantaine de réception existante (mig 461).
-- Rollback : UPDATE product_lots SET status = 'active' WHERE status = 'pending_release' ;
--   recréer product_lots_status_check sans 'pending_release'.

ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_status_check;
ALTER TABLE product_lots ADD CONSTRAINT product_lots_status_check
  CHECK (status IN ('active', 'depleted', 'expired', 'disposed', 'recalled', 'pending_release'));

ALTER TABLE product_lots
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_note TEXT;
CREATE INDEX IF NOT EXISTS idx_product_lots_pending ON product_lots (product_id, store_id) WHERE status = 'pending_release';
