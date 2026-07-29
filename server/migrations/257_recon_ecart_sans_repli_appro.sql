-- Migration 257 : Suppression du repli sur l'appro (module Contrôle des ventes, ISOLE, TEMPORAIRE).
--   Écart = Vendu + Reste − Reçu, calculé uniquement sur le reçu saisi.
--   Tant que le reçu n'est pas saisi (0), l'écart reste basé sur 0 reçu — l'appro
--   n'est plus utilisé comme base de calcul (il servait à afficher des manques
--   fictifs de toute la journée avant saisie du reçu).
--   Ex : appro 20, reçu 0, vendu 0, reste 0 → écart 0 (au lieu de −20).
-- DROP : re-créer les colonnes avec la formule de la migration 247 (repli appro si recu = 0).

ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_qty;
ALTER TABLE recon_lines DROP COLUMN IF EXISTS ecart_value;

ALTER TABLE recon_lines ADD COLUMN ecart_qty NUMERIC(12,3) GENERATED ALWAYS AS (
  vendu_qty + invendu_qty - recu_qty
) STORED;

ALTER TABLE recon_lines ADD COLUMN ecart_value NUMERIC(14,2) GENERATED ALWAYS AS (
  (vendu_qty + invendu_qty - recu_qty) * unit_price
) STORED;
