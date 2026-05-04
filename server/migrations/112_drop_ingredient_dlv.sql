-- Rollback partiel : pour les ingrédients on ne distingue PAS DLC vs DLV
-- (contrairement aux produits finis où la DDE/DLV en vitrine fait sens).
-- On supprime les colonnes liées à la DLV après ouverture.
-- On garde first_opened_at (audit, traçabilité de l'ouverture).

-- Drop la vue d'abord car elle reference effective_expiry_after_opening
DROP VIEW IF EXISTS v_ingredient_stock;

ALTER TABLE ingredient_lots
  DROP COLUMN IF EXISTS effective_expiry_after_opening;

ALTER TABLE ingredients
  DROP COLUMN IF EXISTS shelf_life_after_opening_days;

-- Re-cree la vue v_ingredient_stock sans la colonne supprimee
CREATE VIEW v_ingredient_stock AS
SELECT
  i.id as ingredient_id,
  l.store_id,
  COALESCE(SUM(l.economat_quantity), 0) as economat_total,
  COALESCE(SUM(l.pesage_quantity), 0) as pesage_total,
  COALESCE(SUM(l.economat_quantity + l.pesage_quantity), 0) as total_stock,
  COUNT(*) FILTER (WHERE l.economat_quantity > 0) as economat_lots_count,
  COUNT(*) FILTER (WHERE l.pesage_quantity > 0) as pesage_lots_count,
  MIN(l.expiration_date) FILTER (WHERE l.economat_quantity > 0) as economat_nearest_dlc,
  MIN(l.expiration_date) FILTER (WHERE l.pesage_quantity > 0) as pesage_nearest_dlc
FROM ingredients i
LEFT JOIN ingredient_lots l ON l.ingredient_id=i.id AND l.status='active'
GROUP BY i.id, l.store_id;
