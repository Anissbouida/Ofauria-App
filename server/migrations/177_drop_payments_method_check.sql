-- Migration 177 : retirer le CHECK fige sur payments.payment_method.
--
-- La table `payments` (mig 019) limite payment_method a ('cash','bank','check',
-- 'transfer'), ce qui rejette 'traite' et 'mobile' avec une erreur 23514. Sur
-- l'UI, le bouton "Payer" tourne dans le vide quand l'utilisateur paie une
-- facture par traite. Comme pour mig 176 (orders/sales), le referentiel
-- `payment_methods` est la source de verite ; on supprime simplement la
-- contrainte figee.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

-- S'assurer que 'traite' existe dans le referentiel des modes de paiement.
-- Idempotent : ON CONFLICT DO NOTHING au cas ou l'utilisateur l'a deja ajoute
-- via l'UI.
INSERT INTO ref_entries (table_id, code, label, description, color, display_order)
VALUES ('payment_methods', 'traite', 'Traite', 'Traite bancaire (effet de commerce)', '#a16207', 7)
ON CONFLICT (table_id, code) DO NOTHING;
