-- Migration 184 : retirer le CHECK fige sur invoices.expected_payment_mode.
--
-- Meme probleme que les migrations 176 (orders/sales) et 177 (payments) : la
-- table `invoices` (mig 137) limite expected_payment_mode a
-- ('cash','check','transfer'), ce qui rejette 'traite' avec une erreur 23514
-- ("violates check constraint invoices_expected_payment_mode_check") des qu'on
-- enregistre une facture dont le reglement prevu est une traite.
--
-- Le referentiel `payment_methods` (mig 058 + 177 pour 'traite') est la source
-- de verite ; la coherence est garantie applicativement (accounting.controller
-- valide expectedPaymentMode contre ce referentiel). On supprime donc la
-- contrainte figee. Le format reste VARCHAR(20).

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_expected_payment_mode_check;
