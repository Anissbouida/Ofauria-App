-- Phase 8.1 — Annulation de ticket avec autorisation.
--
-- Un ticket peut être annulé avec un motif et un approbateur : l'écriture comptable est
-- extournée et le stock vitrine restitué. L'annulation laisse une trace (qui, quand,
-- motif, qui a approuvé). Interdite si la caisse est déjà clôturée. Additif.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancel_approved_by UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_sales_cancelled ON sales (cancelled_at) WHERE cancelled_at IS NOT NULL;
