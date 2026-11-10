-- Migration 480 : ventilation de la TVA par article au comptoir.
--
-- Phase 5.2 (feuille de route multi-secteur). Jusqu'ici la caisse posait
-- `tax_amount = 0` en dur (sale.controller.ts) : aucune TVA n'était ventilée,
-- même quand l'article porte un code TVA. Le prix du comptoir est le prix payé
-- (TTC) ; la TVA y est incluse. On stocke désormais, par ligne de ticket, le
-- taux appliqué et le montant de TVA *contenu* dans le prix encaissé, dérivé du
-- taux du code TVA de l'article (mig 473) : TVA = TTC - TTC / (1 + taux).
--
-- Le total encaissé ne change pas : la TVA est une ventilation du prix affiché,
-- pas un ajout. sales.tax_amount (déjà présent, mig 011) porte la somme des TVA
-- de ligne.
--
-- Défaut 0 : les tickets historiques et les articles sans code TVA (cas Ofauria,
-- taux 0) restent à TVA nulle — aucune régression.

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sale_items.tax_rate IS
  'Taux de TVA appliqué à la ligne au moment de la vente (mig 480), figé. 0 si article sans code TVA.';
COMMENT ON COLUMN sale_items.tax_amount IS
  'Montant de TVA contenu dans le sous-total TTC de la ligne (mig 480) : subtotal - subtotal/(1+tax_rate/100). Ventilation, pas un ajout au total.';
