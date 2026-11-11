-- Phase 8.4 — Caisse hors-ligne : socle d'idempotence du checkout.
--
-- Quand la caisse encaisse pendant une coupure réseau, la vente est mise en file locale
-- et rejouée à la reconnexion. Pour qu'un rejeu (ou un double envoi) ne crée PAS deux
-- ventes, le checkout porte une clé d'idempotence : deux envois de la même clé renvoient
-- la même vente. Additif : clé nullable, les ventes existantes ne sont pas touchées.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_idempotency_key
  ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL;
