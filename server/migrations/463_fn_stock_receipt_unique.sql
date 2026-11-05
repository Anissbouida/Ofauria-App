-- L3 inc 5 (analyse d'écart P2P) — entrée en stock unique : fn_stock_receipt.
--
-- POURQUOI
--   Plusieurs chemins font entrer du stock, de façon incohérente :
--     • réception (reception-voucher.repository) : coût réel + CMUP recalculé — OK.
--     • restock direct (inventory.controller) : lot au CMUP courant, pas de recalcul.
--     • ajustement positif (services/stock-adjust) : lot à coût NULL, AUCUN CMUP.
--   Le dernier est le trou : un ajustement positif crée un lot sans coût, qui
--   fausse ensuite la valorisation et le coût de revient.
--
-- QUOI
--   Une fonction d'entrée en stock qui EXIGE un coût (jamais NULL — à défaut le CMUP
--   courant) et recalcule le CMUP en moyenne pondérée, comme à la réception. Les
--   chemins « restock » et « ajustement positif » passent par elle (câblage applicatif).
--   La réception garde pour l'instant son chemin éprouvé (unification ultérieure avec
--   test de parité, ce chemin étant critique et déjà correct).
--
-- INVARIANT : entrer au CMUP courant laisse le CMUP inchangé (v_cost = v_old).
--
-- INVERSION : DROP FUNCTION fn_stock_receipt(...); (et re-câbler les appelants).

CREATE OR REPLACE FUNCTION fn_stock_receipt(
  p_ingredient   uuid,
  p_store        uuid,
  p_qty          numeric,
  p_unit_cost    numeric DEFAULT NULL,   -- NULL → CMUP courant (jamais NULL au final)
  p_lot_number   text    DEFAULT NULL,   -- NULL → numéro par défaut (LI-AAMMJJ-NNNNN)
  p_supplier_lot text    DEFAULT NULL,
  p_notes        text    DEFAULT NULL,
  p_manufactured date    DEFAULT NULL,
  p_expiration   date    DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_old numeric; v_cost numeric; v_before numeric; v_lot uuid; v_new numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'fn_stock_receipt : quantité d''entrée strictement positive requise (reçu %)', p_qty;
  END IF;
  -- Verrou de l'article : sérialise le calcul du CMUP avec les autres entrées.
  SELECT unit_cost INTO v_old FROM ingredients WHERE id = p_ingredient FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fn_stock_receipt : ingrédient % introuvable', p_ingredient; END IF;
  -- Coût d'entrée : jamais NULL — à défaut, le coût moyen courant, sinon 0.
  v_cost := round(COALESCE(p_unit_cost, v_old, 0), 4);
  -- Stock valorisable AVANT l'entrée (lots actifs ; unit_cost est global à l'article).
  SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0) INTO v_before
    FROM ingredient_lots WHERE ingredient_id = p_ingredient AND status = 'active';
  -- Entrée du lot en zone économat, statut actif. L'inventaire est synchronisé par trigger.
  INSERT INTO ingredient_lots
    (ingredient_id, store_id, lot_number, supplier_lot_number, quantity_received, quantity_remaining,
     economat_quantity, pesage_quantity, unit_cost, manufactured_date, expiration_date, received_at, status, notes)
  VALUES
    (p_ingredient, p_store, COALESCE(p_lot_number, fn_next_lot_number(CURRENT_DATE)), p_supplier_lot,
     p_qty, p_qty, p_qty, 0, v_cost, p_manufactured, p_expiration, CURRENT_DATE, 'active', p_notes)
  RETURNING id INTO v_lot;
  -- CMUP après entrée (moyenne pondérée) : inchangé si on entre au coût moyen courant.
  IF v_before > 0 AND v_old IS NOT NULL AND v_old > 0 THEN
    v_new := round((v_before * v_old + p_qty * v_cost) / (v_before + p_qty), 4);
  ELSE
    v_new := v_cost;
  END IF;
  UPDATE ingredients SET unit_cost = v_new WHERE id = p_ingredient;
  RETURN v_lot;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_stock_receipt(uuid, uuid, numeric, numeric, text, text, text, date, date) IS
  'Entrée en stock unique (L3 P2P inc 5, mig 463) : crée un lot avec un coût garanti (défaut = CMUP courant) et recalcule le CMUP. Utilisée par le restock direct et l''ajustement positif ; la réception garde son chemin dédié.';
