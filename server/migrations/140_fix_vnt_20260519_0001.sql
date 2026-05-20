-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 140 : Correction de la vente VNT-20260519-0001 (FEKKAS RAISIN)
--
-- FEKKAS RAISIN est un produit vendu au poids (150 DH/kg). A l'encaissement,
-- le poids a ete saisi en grammes au lieu de kilogrammes : "5" a ete interprete
-- comme 5 g au lieu de 5 kg.
--   Enregistre : 5 g    -> (5 / 1000) x 150 = 0,75 DH
--   Reel       : 5000 g -> (5000 / 1000) x 150 = 750,00 DH
--
-- Cette migration recale la ligne de vente, les totaux de la vente, et le stock
-- vitrine (4995 g supplementaires sont physiquement partis avec le client).
-- Garde-fou d'idempotence : ne corrige que si la ligne est encore a 5 g.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_sale_id       UUID;
  v_store_id      UUID;
  v_user_id       UUID;
  v_item_id       UUID;
  v_product_id    UUID;
  v_old_qty       INT;
  v_vitrine_after NUMERIC;
BEGIN
  -- Localise la vente
  SELECT s.id, s.store_id, s.user_id
    INTO v_sale_id, v_store_id, v_user_id
  FROM sales s
  WHERE s.sale_number = 'VNT-20260519-0001';

  IF v_sale_id IS NULL THEN
    RAISE NOTICE 'VNT-20260519-0001 absente de cette base — aucune correction.';
    RETURN;
  END IF;

  -- Localise la ligne FEKKAS RAISIN de cette vente
  SELECT si.id, si.product_id, si.quantity
    INTO v_item_id, v_product_id, v_old_qty
  FROM sale_items si
  JOIN products p ON p.id = si.product_id
  WHERE si.sale_id = v_sale_id AND p.name = 'FEKKAS RAISIN';

  -- Idempotence : on ne corrige que la donnee erronee (encore a 5 g).
  IF v_item_id IS NULL OR v_old_qty <> 5 THEN
    RAISE NOTICE 'Ligne FEKKAS RAISIN introuvable ou deja corrigee (qty=%) — aucune action.', v_old_qty;
    RETURN;
  END IF;

  -- 1. Corrige la ligne de vente : 5 g -> 5000 g (5 kg). unit_price (DH/kg)
  --    et unit ('g') etaient deja corrects.
  UPDATE sale_items
     SET quantity = 5000,
         subtotal = ROUND((5000.0 / 1000) * unit_price, 2)
   WHERE id = v_item_id;

  -- 2. Recalcule les totaux de la vente depuis ses lignes
  UPDATE sales s
     SET subtotal = sub.s,
         total    = sub.s - s.discount_amount + s.tax_amount
  FROM (SELECT COALESCE(SUM(subtotal), 0) AS s FROM sale_items WHERE sale_id = v_sale_id) sub
  WHERE s.id = v_sale_id;

  -- 3. Corrige le stock vitrine : 4995 g de plus sont sortis avec le client
  IF v_store_id IS NOT NULL THEN
    UPDATE product_store_stock
       SET vitrine_quantity = GREATEST(vitrine_quantity - 4995, 0),
           updated_at = NOW()
     WHERE product_id = v_product_id AND store_id = v_store_id
    RETURNING vitrine_quantity INTO v_vitrine_after;

    -- 4. Journalise la correction de stock (piste d'audit)
    INSERT INTO product_stock_transactions
      (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
    VALUES
      (v_product_id, 'adjustment', -4995, COALESCE(v_vitrine_after, 0),
       'Correction VNT-20260519-0001 : poids saisi 5 g au lieu de 5 kg (FEKKAS RAISIN)',
       v_sale_id, v_user_id, v_store_id);
  ELSE
    RAISE NOTICE 'Vente sans store_id — stock vitrine non corrige.';
  END IF;

  RAISE NOTICE 'VNT-20260519-0001 corrigee : 5 g -> 5000 g, total 0,75 -> 750,00 DH, vitrine -4995 g.';
END $$;

COMMIT;
