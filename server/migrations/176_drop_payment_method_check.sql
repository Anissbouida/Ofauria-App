-- Migration 176 : retirer le CHECK fige sur payment_method (orders, sales).
--
-- Le referentiel `payment_methods` (mig 058) est devenu la source de verite
-- pour les modes de paiement et propose desormais cash/card/mobile/check/
-- transfer/deferred + entrees custom (traite, etc.). Or la table `orders`
-- (mig 008) et la table `sales` (mig 011) ont conserve un CHECK code en dur
-- a `('cash','card','mobile')` qui rejette toute commande / vente reglee par
-- cheque, virement, paiement reporte, etc. avec une erreur 23514, sans aucun
-- message lisible cote UI (la requete renvoie 500).
--
-- On supprime simplement les contraintes ; le format reste VARCHAR(20) et la
-- coherence est garantie applicativement via le referentiel.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE sales  DROP CONSTRAINT IF EXISTS sales_payment_method_check;
