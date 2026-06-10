-- Migration 150 : ajout du type de vente 'special' (B2B / gros client).
--
-- Contexte : les ventes B2B (cafes, hotels, restaurants qui achetent en gros)
-- se negocient avec des prix unitaires differents du tarif vitrine. Elles
-- sont saisies depuis un formulaire admin/manager dedie (back-office), pas
-- depuis le POS, et ne touchent pas au stock vitrine (la marchandise sort
-- via les bons de sortie / production directe).
--
-- On etend simplement la CHECK constraint existante. Le reste de l'infra
-- (sale_items.unit_price deja DECIMAL libre, payment_status, etc.) supporte
-- nativement les prix custom : il suffisait d'autoriser le type.

BEGIN;

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_sale_type_check;
ALTER TABLE sales ADD CONSTRAINT sales_sale_type_check
  CHECK (sale_type IN ('standard', 'advance', 'delivery', 'special'));

COMMENT ON COLUMN sales.sale_type IS
  'standard = POS vitrine. advance = avance sur commande. delivery = solde commande. special = B2B gros client avec prix negocies.';

COMMIT;
