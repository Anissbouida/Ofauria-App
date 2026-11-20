-- 618 — Réévaluation au prix facturé : comparer au prix de RÉCEPTION, pas au coût du lot
-- (scénario 1, constat 82).
--
-- fn_stock_revaluation_preview (mig 446) calculait l'écart « prix facturé − coût du lot ».
-- Or le coût du lot contient les frais d'approche répartis à la réception (transport,
-- douane : ingredient_lots.unit_cost = prix reçu + frais). Une facture au prix du bon de
-- commande, sans le moindre écart, ressortait donc en écart négatif égal aux frais : la
-- validation les aurait effacés du coût du lot et du CMUP (chocolat de couverture :
-- lot 179,9997 DH, facture 139,9997 DH → −40 DH/kg, soit les 1 200 DH de frais).
--
-- Désormais l'écart est « prix facturé − prix de la ligne de réception »
-- (reception_voucher_items.unit_price, hors frais) ; il s'ajoute au coût du lot, qui garde
-- ses frais (le repository fait lot_unit_cost + unit_delta). Comme cet écart ne s'annule
-- plus une fois appliqué, un lot déjà réévalué pour cette facture est exclu
-- (stock_valuation_adjustments, unique par source et lot) : pas de double application, et
-- la liste des candidats ne le propose plus.
--
-- INVERSION : rejouer la définition de la mig 446.

CREATE OR REPLACE FUNCTION fn_stock_revaluation_preview(p_invoice_id uuid)
RETURNS TABLE (
  ingredient_lot_id  uuid,
  item_name          text,
  lot_unit_cost      numeric,
  invoice_unit_price numeric,
  unit_delta         numeric,
  qty_basis          numeric,
  qty_remaining      numeric,
  amount_to_stock    numeric,
  amount_to_variance numeric
) AS $$
  SELECT
    il.id,
    COALESCE(ing.name, pkg.name)                          AS item_name,
    il.unit_cost                                          AS lot_unit_cost,
    ii.unit_price                                         AS invoice_unit_price,
    round(ii.unit_price - rvi.unit_price, 4)              AS unit_delta,
    ii.quantity                                           AS qty_basis,
    LEAST(il.quantity_remaining, ii.quantity)             AS qty_remaining,
    round((ii.unit_price - rvi.unit_price) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_stock,
    round((ii.unit_price - rvi.unit_price) * ii.quantity, 2)
      - round((ii.unit_price - rvi.unit_price) * LEAST(il.quantity_remaining, ii.quantity), 2) AS amount_to_variance
  FROM invoice_items ii
  JOIN reception_voucher_items rvi ON rvi.id = ii.reception_voucher_item_id
  JOIN ingredient_lots il
    ON il.reception_voucher_item_id = ii.reception_voucher_item_id
  LEFT JOIN ingredients ing ON ing.id = il.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
  WHERE ii.invoice_id = p_invoice_id
    AND ii.unit_price IS NOT NULL
    AND rvi.unit_price IS NOT NULL
    AND abs(ii.unit_price - rvi.unit_price) > 0.0001
    AND NOT EXISTS (
      SELECT 1 FROM stock_valuation_adjustments sva
       WHERE sva.source_kind = 'invoice_price'
         AND sva.source_id = p_invoice_id
         AND sva.ingredient_lot_id = il.id);
$$ LANGUAGE sql STABLE;
