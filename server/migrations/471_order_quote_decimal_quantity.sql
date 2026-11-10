-- Migration 471 : quantités décimales sur les lignes de commande et de devis
--
-- Phase 3.4 (ERP multi-secteur) — les lignes client acceptent une quantité
-- fractionnaire (2,5 unités, 0,75 m, 1,2 kg à la pièce…). Jusqu'ici seules
-- order_items.quantity (mig 008) et quote_items.quantity (mig 365) étaient
-- restées en entier ; tout l'aval de la chaîne O2C est DÉJÀ décimal :
--   delivery_note_items.quantity  numeric(12,3)  (mig 352)
--   invoice_items.quantity        numeric(12,4)  (mig 055)
--   order_stock_reservations      numeric(10,2)  (mig 389)
-- Le code commande (order.controller : Number(qty), round2(unitPrice*qty)) et
-- la saisie pro (ProSalesTab : step 0.001) étaient déjà prêts.
--
-- Élargissement int → numeric(12,3) : conversion sans perte (toute valeur
-- entière reste valide), le CHECK (quantity > 0) de quote_items est conservé.
-- Hors périmètre : sale_items (caisse, le poids y est stocké en grammes
-- entiers) et return_items (retours de caisse) — lot séparé si besoin.

ALTER TABLE order_items ALTER COLUMN quantity TYPE numeric(12,3);
ALTER TABLE quote_items ALTER COLUMN quantity TYPE numeric(12,3);
