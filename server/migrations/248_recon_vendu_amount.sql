-- Migration 248 : Montant net réel des ventes Loyverse par ligne (module Contrôle des ventes, ISOLE, TEMPORAIRE).
-- Le CSV item-sales-summary fournit les « Ventes nettes » exactes par produit ;
-- jusqu'ici seul un prix unitaire arrondi (net/qté) était conservé, donc le total
-- « montant vendu » (qté × prix) divergeait du chiffre Loyverse réel.
-- vendu_amount est écrasé à chaque réimport (comme vendu_qty) ; 0 = pas d'import
-- avec montant → le front retombe sur qté × prix.
-- DROP : ALTER TABLE recon_lines DROP COLUMN IF EXISTS vendu_amount;

ALTER TABLE recon_lines ADD COLUMN IF NOT EXISTS vendu_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
