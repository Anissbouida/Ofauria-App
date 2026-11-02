-- 425 — Localisation des lots matière : emplacement par défaut (épic labo L1, partie 3)
--
-- POURQUOI
--   stock_locations + ingredient_lots.location_id existent (mig 424) mais les
--   lots déjà en base n'ont pas d'emplacement. On localise les lots actifs sur
--   l'Économat de leur magasin — zone d'entrée physique par défaut — pour que
--   l'inventaire par emplacement et le suivi « où est le lot » partent d'un état
--   cohérent. Les nouvelles réceptions posent cet emplacement à la création
--   (reception-voucher.repository).
--
-- IDEMPOTENT : ne touche que les lots actifs sans emplacement.
-- INVERSION : UPDATE ingredient_lots SET location_id = NULL WHERE ... (aucune,
--   la donnée est une localisation par défaut, pas une information perdue).

UPDATE ingredient_lots il
SET location_id = loc.id
FROM stock_locations loc
WHERE il.location_id IS NULL
  AND il.status = 'active'
  AND loc.store_id = il.store_id
  AND loc.code = 'ECONOMAT'
  AND loc.is_active;
