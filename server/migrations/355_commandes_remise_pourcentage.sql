-- Migration 355 : remise de commande en pourcentage
--
-- POURQUOI
--   La remise d'une commande se saisit en % (comme la remise client et la remise
--   du personnel), pas en dirhams. Pour un professionnel, la TVA se calcule sur
--   le HT APRÈS remise (elle était calculée avant remise : 980 HT − 25 de remise
--   donnait 196 de TVA au lieu de 191) ; et le BL / la facture doivent porter
--   des prix remisés, sinon la remise de la commande était perdue à la livraison.
--
-- PORTEE
--   1. orders.discount_pct : taux de remise saisi (discount_amount reste le
--      montant calculé, utilisé par la caisse et les rapports).
--   2. Reprise : taux déduit des remises existantes (montant / sous-total).
--   3. Commandes de professionnels encore ouvertes (ni terminées ni annulées)
--      avec remise : TVA et total recalculés sur le HT remisé.
--
-- INVERSION
--   ALTER TABLE orders DROP COLUMN discount_pct;
--   (les TVA recalculées en 3 ne sont pas restaurées : elles étaient fausses)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5, 2);

UPDATE orders
   SET discount_pct = ROUND(discount_amount / subtotal * 100, 2)
 WHERE discount_pct IS NULL AND COALESCE(discount_amount, 0) > 0 AND subtotal > 0;

WITH fixed AS (
  SELECT o.id,
         ROUND(SUM(ROUND(oi.subtotal * (1 - o.discount_amount / o.subtotal) * COALESCE(oi.tva_rate, 0)) / 100), 2) AS tax
    FROM orders o
    JOIN customers c ON c.id = o.customer_id AND COALESCE(c.customer_type, 'particulier') <> 'particulier'
    JOIN order_items oi ON oi.order_id = o.id
   WHERE o.status NOT IN ('completed', 'cancelled') AND COALESCE(o.discount_amount, 0) > 0 AND o.subtotal > 0
   GROUP BY o.id
)
UPDATE orders o
   SET tax_amount = f.tax, total = o.subtotal - o.discount_amount + f.tax
  FROM fixed f
 WHERE f.id = o.id;
