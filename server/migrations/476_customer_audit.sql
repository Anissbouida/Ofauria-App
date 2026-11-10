-- Migration 476 : archivage + piste d'audit du client (phase 4.4)
--
-- On n'efface plus un client (hard DELETE) : on l'ARCHIVE (is_active = false),
-- pour qu'il garde tout son historique (commandes, ventes, factures, créances).
-- archived_at date l'archivage. Un journal applicatif trace les actions
-- (création, modification, archivage, restauration) pour l'afficher sur la
-- fiche — équivalent client du journal fournisseurs (purchasing_master_audit),
-- alimenté par l'application (comme ref_audit_log) et non par trigger.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_audit (
  id          BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'archive', 'restore')),
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detail      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_customer_audit_customer ON customer_audit(customer_id, changed_at DESC);
