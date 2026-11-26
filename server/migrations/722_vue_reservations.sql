-- 722 — Vue unique des réservations de stock (feuille de route, étape 2.6).
--
-- Deux réservations existent : produits réservés par les commandes clients (mig 389) et
-- matières réservées par les ordres de fabrication (réservation de matière). Une seule vue
-- les présente avec l'origine, le stock et le disponible (stock − réservé de l'article),
-- calculés au même endroit pour tous les écrans.
CREATE OR REPLACE VIEW v_stock_reservations AS
WITH r AS (
  SELECT 'commande'::text AS origin, osr.id, osr.store_id, 'product'::text AS item_kind, osr.product_id AS item_id,
         osr.quantity, osr.created_at, o.order_number AS reference, o.id AS source_id
    FROM order_stock_reservations osr JOIN orders o ON o.id = osr.order_id
   WHERE osr.status = 'reserved'
  UNION ALL
  SELECT 'ordre_fabrication', mr.id, mr.store_id, 'ingredient', mr.ingredient_id, mr.quantity, mr.created_at,
         COALESCE(p.of_number, to_char(p.plan_date, 'DD/MM/YYYY')), p.id
    FROM material_reservations mr JOIN production_plans p ON p.id = mr.plan_id
   WHERE mr.status = 'reservee'
)
SELECT r.*,
       COALESCE(pr.name, i.name) AS item_name,
       COALESCE(pr.sale_unit, i.unit) AS unit,
       CASE r.item_kind
         WHEN 'product' THEN (SELECT COALESCE(SUM(s.stock_quantity), 0) FROM product_store_stock s WHERE s.product_id = r.item_id AND s.store_id IS NOT DISTINCT FROM r.store_id)
         ELSE (SELECT COALESCE(SUM(inv.current_quantity), 0) FROM inventory inv WHERE inv.ingredient_id = r.item_id AND inv.store_id IS NOT DISTINCT FROM r.store_id)
       END AS stock_quantity,
       SUM(r.quantity) OVER (PARTITION BY r.item_kind, r.item_id, r.store_id) AS reserved_total
  FROM r
  LEFT JOIN products pr ON r.item_kind = 'product' AND pr.id = r.item_id
  LEFT JOIN ingredients i ON r.item_kind = 'ingredient' AND i.id = r.item_id;
