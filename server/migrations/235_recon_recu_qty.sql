-- Migration 235 : Quantité reçue confirmée par la caissière (colonne REÇU du bon de transfert)
-- Module Contrôle des ventes (ISOLE, TEMPORAIRE).
-- L'écart de vente (appro - vendu - invendu) reste inchangé ; recu_qty permet de
-- détecter séparément les écarts de transfert production → magasin (appro ≠ reçu).
-- DROP : ALTER TABLE recon_lines DROP COLUMN IF EXISTS recu_qty;

ALTER TABLE recon_lines ADD COLUMN IF NOT EXISTS recu_qty NUMERIC(12,3) NOT NULL DEFAULT 0;
