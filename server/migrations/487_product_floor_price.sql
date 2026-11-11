-- Phase 6.4 — Prix plancher par article.
--
-- Un prix de vente sous le plancher est réservé à la direction (approbation). Les
-- plafonds de remise par rôle existent déjà (mig 443) ; ce lot ajoute le plancher,
-- appliqué dans la validation des lignes (priceLines) pour les commandes et les devis.
--
-- Additif : floor_price NULL = pas de plancher, aucun changement pour Ofauria.
ALTER TABLE products ADD COLUMN IF NOT EXISTS floor_price NUMERIC(12,4);
COMMENT ON COLUMN products.floor_price IS
  'Prix plancher (phase 6.4) : en dessous, une vente/un devis exige l''approbation de la direction.';
