-- Migration 246 : L'écart se calcule sur le REÇU (confirmé caissière), plus sur l'appro.
-- Module Contrôle des ventes (ISOLE, TEMPORAIRE).
--   Écart = Reçu − Vendu − Invendu.  Positif = manque à expliquer (perte / vol / erreur).
--   Repli : si le reçu n'est pas saisi (0), on retombe sur l'appro pour ne pas
--   fausser les journées existantes où seule la colonne appro était renseignée.
-- Les colonnes générées ne peuvent pas être modifiées en place : DROP puis re-ADD.
-- DROP : (revenir à la formule appro) re-créer les colonnes avec appro_qty - vendu_qty - invendu_qty.

ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_qty;
ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_value;

ALTER TABLE recon_lines ADD COLUMN ecart_qty NUMERIC(12,3) GENERATED ALWAYS AS (
  (CASE WHEN recu_qty > 0 THEN recu_qty ELSE appro_qty END) - vendu_qty - invendu_qty
) STORED;

ALTER TABLE recon_lines ADD COLUMN ecart_value NUMERIC(14,2) GENERATED ALWAYS AS (
  ((CASE WHEN recu_qty > 0 THEN recu_qty ELSE appro_qty END) - vendu_qty - invendu_qty) * unit_price
) STORED;
