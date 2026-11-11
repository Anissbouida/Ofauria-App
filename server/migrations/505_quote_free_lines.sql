-- Phase 11 (D3-24) — lignes libres et sections de devis.
--
-- Avant : quote_items.product_id NOT NULL → impossible de chiffrer une ligne
-- sans article, ni de structurer un devis en lots (sections). Désormais trois
-- types de ligne : 'product' (article du catalogue, prix résolu), 'free' (texte
-- libre + prix saisi, sans article) et 'section' (titre de lot, sans montant).
-- Additif : product_id devient nullable, line_type par défaut 'product' → les
-- lignes existantes restent des lignes article inchangées.
--
-- PÉRIMÈTRE : lignes libres/sections dans le DEVIS uniquement. La conversion en
-- commande ignore les sections et refuse les lignes libres (order_items exige
-- un article) : l'utilisateur les remplace par des articles avant de convertir.

ALTER TABLE quote_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'product';

ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS chk_quote_item_line_type;
ALTER TABLE quote_items ADD CONSTRAINT chk_quote_item_line_type
  CHECK (line_type IN ('product', 'free', 'section'));

-- Une ligne article a un produit ; une ligne libre/section n'en a pas.
ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS chk_quote_item_product;
ALTER TABLE quote_items ADD CONSTRAINT chk_quote_item_product
  CHECK ((line_type = 'product') = (product_id IS NOT NULL));

-- Quantité strictement positive, sauf pour une section (titre sans montant).
ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS quote_items_quantity_check;
ALTER TABLE quote_items ADD CONSTRAINT chk_quote_item_quantity
  CHECK (line_type = 'section' OR quantity > 0);
