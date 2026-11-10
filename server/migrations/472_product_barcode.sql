-- Migration 472 : code-barres sur l'article
--
-- Phase 3.5 (ERP multi-secteur) — un article peut porter un code-barres scanné
-- en caisse (EAN-13, UPC, code 128…). Jusqu'ici la caisse détournait
-- products.sku (une référence de GESTION, clé Loyverse/réconciliation) comme
-- code scannable. On sépare les deux, comme un ERP standard (Odoo : barcode vs
-- default_code) : le SKU reste la référence interne, le barcode est le code
-- physique scanné.
--
-- Colonne nullable : la plupart des articles (pâtisserie fraîche au poids,
-- prestations) n'ont pas de code-barres. L'unicité n'est imposée que sur les
-- codes réellement renseignés (index partiel) : deux articles ne peuvent pas
-- partager un même code scannable, mais autant d'articles qu'on veut peuvent
-- rester sans code.

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';
