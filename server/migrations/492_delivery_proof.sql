-- Phase 7.6 — Preuve de livraison : signature, heure réelle, réserves.
--
-- À la réception, le BL peut porter une signature (image encodée), l'heure réelle de
-- livraison et des réserves (marchandise manquante, abîmée…) : un litige de livraison se
-- rattache ainsi au BL. Additif : colonnes nullables, aucun BL existant modifié.
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS pod_signature TEXT;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS pod_reserves TEXT;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
COMMENT ON COLUMN delivery_notes.pod_reserves IS 'Réserves à la livraison (phase 7.6) : rattache un litige au BL.';
