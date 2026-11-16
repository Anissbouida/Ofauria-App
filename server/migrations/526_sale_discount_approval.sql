-- G0-19 (plan d'action 2026-11) — remise de caisse plafonnée par rôle.
--
-- La remise manuelle d'un ticket est désormais comparée au plafond du rôle
-- (sales.pricing). Au-delà, un responsable valide par son PIN : la dérogation
-- est tracée sur le ticket (qui, quel taux), comme les dérogations de prix des
-- commandes. manual_discount_amount isole la remise du caissier, que
-- discount_amount mélange avec les promotions et les points de fidélité.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS manual_discount_amount numeric(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS manual_discount_pct    numeric(6,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_approved_by   uuid REFERENCES users(id);

COMMENT ON COLUMN sales.manual_discount_amount IS 'Remise manuelle du caissier (hors promotions et fidélité), G0-19';
COMMENT ON COLUMN sales.manual_discount_pct    IS 'Remise manuelle en % du montant après promotions, G0-19';
COMMENT ON COLUMN sales.discount_approved_by   IS 'Responsable ayant validé par PIN une remise au-delà du plafond du caissier, G0-19';
