-- 469 — Type d'article (nature), phase 3 multi-secteur.
--
-- Distinct de sale_type (jour/dlv/commande = cycle de vie boutique) : item_kind
-- décrit la NATURE de l'article, qui pilote la fiche (recette seulement si fabriqué,
-- stock masqué pour une prestation…) et l'approvisionnement (un article de revente
-- se commande au fournisseur, pas en production).
--   manufactured : fabriqué en interne (recette / nomenclature) — cas boulangerie.
--   resale       : acheté pour revente (négoce), sans recette.
--   service      : prestation, non stockée.
--   subscription : abonnement / service récurrent.
-- Défaut 'manufactured' : tous les produits Ofauria existants restent inchangés.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS item_kind VARCHAR(20) NOT NULL DEFAULT 'manufactured'
    CHECK (item_kind IN ('manufactured', 'resale', 'service', 'subscription'));

COMMENT ON COLUMN products.item_kind IS 'Nature de l''article (mig 469) : manufactured / resale / service / subscription. Pilote la fiche et l''approvisionnement ; distinct de sale_type (cycle de vie boutique).';
