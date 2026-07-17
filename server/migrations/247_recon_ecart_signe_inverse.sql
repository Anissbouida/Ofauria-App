-- Migration 247 : Inversion du signe de l'écart (module Contrôle des ventes, ISOLE, TEMPORAIRE).
--   Écart = Vendu + Invendu − Reçu.  Négatif = manque à expliquer (perte / vol / erreur),
--   positif = surplus (vendu plus que reçu).
--   Ex : reçu 18, vendu 17, reste 0 → écart −1 (1 article manquant).
--   Repli inchangé : si le reçu n'est pas saisi (0), l'appro sert de base.
-- DROP : re-créer les colonnes avec la formule de la migration 246 (recu - vendu - invendu).

ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_qty;
ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_value;

ALTER TABLE recon_lines ADD COLUMN ecart_qty NUMERIC(12,3) GENERATED ALWAYS AS (
  vendu_qty + invendu_qty - (CASE WHEN recu_qty > 0 THEN recu_qty ELSE appro_qty END)
) STORED;

ALTER TABLE recon_lines ADD COLUMN ecart_value NUMERIC(14,2) GENERATED ALWAYS AS (
  (vendu_qty + invendu_qty - (CASE WHEN recu_qty > 0 THEN recu_qty ELSE appro_qty END)) * unit_price
) STORED;
