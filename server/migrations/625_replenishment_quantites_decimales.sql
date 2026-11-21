-- 625 — Demandes d'approvisionnement boutique : quantités décimales (scénario 2, constat 130).
--
-- POURQUOI
--   Les quantités de replenishment_request_items étaient des entiers. Un produit vendu au
--   poids (cornes de gazelle, fabriquées et stockées au kilo : 1,3 kg) faisait échouer TOUTE la
--   demande de mise en vitrine (500 « invalid input syntax for type integer: "1.3" ») : la
--   vitrine restait vide, aucune vente possible de la journée.
--
-- CE QUI CHANGE
--   Les 8 colonnes de quantité passent en numeric(12,3), comme product_store_stock.
--   Les valeurs existantes (entières) sont conservées telles quelles.
--
-- INVERSION
--   ALTER COLUMN ... TYPE integer USING round(...) sur les mêmes colonnes (perte des décimales).

ALTER TABLE replenishment_request_items
  ALTER COLUMN requested_quantity TYPE numeric(12,3),
  ALTER COLUMN fulfilled_quantity TYPE numeric(12,3),
  ALTER COLUMN qty_to_store       TYPE numeric(12,3),
  ALTER COLUMN qty_to_stock       TYPE numeric(12,3),
  ALTER COLUMN qty_received       TYPE numeric(12,3),
  ALTER COLUMN qty_from_stock     TYPE numeric(12,3),
  ALTER COLUMN qty_to_produce     TYPE numeric(12,3),
  ALTER COLUMN suggested_quantity TYPE numeric(12,3);
