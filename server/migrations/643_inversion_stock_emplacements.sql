-- 643 — Magasin générique, tâche 2 : inversion de la source de vérité du stock matière
-- (plan d'exécution multi-industries, étape 8).
--
-- POURQUOI
--   Depuis la mig 570, les zones du lot (economat_quantity, pesage_quantity) étaient la source
--   écrite et la table ingredient_lot_locations n'en était qu'un reflet : impossible de ranger
--   un lot dans plus de deux endroits, ni de décrire un magasin sans « économat » ni « pesage ».
--
-- CE QUI CHANGE
--   - ingredient_lot_locations devient la table ÉCRITE. Les mouvements passent par :
--       fn_lot_move_role(lot, rôle origine, rôle destination, qté, motif, utilisateur)
--       fn_lot_take(lot, qté, rôle)       sortie de stock depuis les emplacements d'un rôle
--       fn_lot_put(lot, qté, rôle)        entrée dans l'emplacement du rôle
--       fn_lot_clear(lot)                 remise à zéro (annulation d'une réception)
--     Chacune recalcule ensuite les zones du lot (fn_lot_recompute_zones) : pesage = somme des
--     emplacements de rôle « en-cours ouvert », économat = somme des autres. Les zones sont
--     désormais des valeurs DÉRIVÉES, maintenues un cycle pour les ~140 lectures existantes.
--   - Le reflet de la mig 570 (fn_sync_lot_locations) reste pour les écritures historiques
--     (création d'un lot, fonctions SQL anciennes) mais applique désormais des ÉCARTS au lieu
--     d'écraser : une part rangée ailleurs (froid, quarantaine) n'est plus effacée. Il se tait
--     quand la modification vient du recalcul (variable de session kalum.lot_zones_from_locations).
--   - Les emplacements par défaut sont trouvés par rôle (mig 642), plus par code.
--   Aucune quantité ne bouge à l'application : invariant vérifié avant (Σ emplacements = zones).
--
-- RETOUR ARRIÈRE
--   Réappliquer fn_sync_lot_locations de la mig 570 ; DROP FUNCTION fn_lot_move_role, fn_lot_take,
--   fn_lot_put, fn_lot_clear, fn_lot_recompute_zones, fn_lot_role_location, fn_lot_location_add,
--   fn_store_default_locations.

-- Emplacements de base d'un établissement (réserve, en-cours ouvert), créés s'ils manquent.
CREATE OR REPLACE FUNCTION fn_store_default_locations(p_store UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_store IS NULL THEN RETURN; END IF;
  IF fn_store_location(p_store, 'reserve') IS NULL THEN
    INSERT INTO stock_locations (store_id, code, name, type, role, role_default)
    VALUES (p_store, 'ECONOMAT', 'Économat (sec)', 'sec', 'reserve',
            NOT EXISTS (SELECT 1 FROM stock_locations WHERE store_id = p_store AND role = 'reserve' AND role_default))
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
  IF fn_store_location(p_store, 'en_cours_ouvert') IS NULL THEN
    INSERT INTO stock_locations (store_id, code, name, type, role, role_default)
    VALUES (p_store, 'PESAGE', 'Zone de pesage', 'pesage', 'en_cours_ouvert',
            NOT EXISTS (SELECT 1 FROM stock_locations WHERE store_id = p_store AND role = 'en_cours_ouvert' AND role_default))
    ON CONFLICT (store_id, code) DO NOTHING;
  END IF;
END $$;

-- Emplacement d'un lot pour un rôle : en-cours ouvert = celui de l'établissement ; réserve = le
-- rangement du lot (location_id) s'il n'est pas un en-cours, sinon la réserve de l'établissement.
CREATE OR REPLACE FUNCTION fn_lot_role_location(p_lot UUID, p_role TEXT) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_store UUID; v_loc UUID; v_out UUID;
BEGIN
  SELECT store_id, location_id INTO v_store, v_loc FROM ingredient_lots WHERE id = p_lot;
  IF v_store IS NULL THEN RETURN NULL; END IF;
  PERFORM fn_store_default_locations(v_store);
  IF p_role = 'reserve' THEN
    SELECT l.id INTO v_out FROM stock_locations l WHERE l.id = v_loc AND l.role <> 'en_cours_ouvert' AND l.is_active;
    IF v_out IS NOT NULL THEN RETURN v_out; END IF;
  END IF;
  RETURN fn_store_location(v_store, p_role);
END $$;

-- Zones du lot recalculées depuis les emplacements (valeurs dérivées).
CREATE OR REPLACE FUNCTION fn_lot_recompute_zones(p_lot UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('kalum.lot_zones_from_locations', 'on', true);
  UPDATE ingredient_lots il SET
    pesage_quantity = COALESCE((SELECT sum(ll.quantity) FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
                                 WHERE ll.ingredient_lot_id = il.id AND sl.role = 'en_cours_ouvert'), 0),
    economat_quantity = COALESCE((SELECT sum(ll.quantity) FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
                                   WHERE ll.ingredient_lot_id = il.id AND sl.role <> 'en_cours_ouvert'), 0)
   WHERE il.id = p_lot AND il.store_id IS NOT NULL;  -- lot sans établissement : zones écrites directement
  PERFORM set_config('kalum.lot_zones_from_locations', 'off', true);
END $$;

-- Ajoute (ou retire) une quantité dans un emplacement ; refuse un solde négatif.
CREATE OR REPLACE FUNCTION fn_lot_location_add(p_lot UUID, p_location UUID, p_delta NUMERIC) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_new NUMERIC;
BEGIN
  INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at)
  VALUES (p_lot, p_location, GREATEST(p_delta, 0), now())
  ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = GREATEST(ingredient_lot_locations.quantity + p_delta, 0), updated_at = now()
  RETURNING quantity INTO v_new;
END $$;

-- Sortie depuis les emplacements d'un rôle (en-cours ouvert : la zone de pesage ; autre rôle :
-- toute la réserve du lot, son rangement d'abord). p_recompute = false quand l'appelant enchaîne.
CREATE OR REPLACE FUNCTION fn_lot_take(p_lot UUID, p_qty NUMERIC, p_role TEXT, p_recompute BOOLEAN DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_left NUMERIC := p_qty; v_take NUMERIC; v_store UUID; v_first UUID;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  SELECT store_id INTO v_store FROM ingredient_lots WHERE id = p_lot;
  IF v_store IS NULL THEN
    UPDATE ingredient_lots SET
      economat_quantity = economat_quantity - CASE WHEN p_role <> 'en_cours_ouvert' THEN p_qty ELSE 0 END,
      pesage_quantity = pesage_quantity - CASE WHEN p_role = 'en_cours_ouvert' THEN p_qty ELSE 0 END
     WHERE id = p_lot;
    RETURN;
  END IF;
  v_first := fn_lot_role_location(p_lot, p_role);
  FOR r IN
    SELECT ll.location_id, ll.quantity FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
     WHERE ll.ingredient_lot_id = p_lot AND ll.quantity > 0
       AND ((p_role = 'en_cours_ouvert' AND sl.role = 'en_cours_ouvert') OR (p_role <> 'en_cours_ouvert' AND sl.role <> 'en_cours_ouvert'))
     ORDER BY (ll.location_id = v_first) DESC, ll.quantity DESC
     FOR UPDATE OF ll
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(r.quantity, v_left);
    UPDATE ingredient_lot_locations SET quantity = quantity - v_take, updated_at = now()
     WHERE ingredient_lot_id = p_lot AND location_id = r.location_id;
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0.00005 THEN
    RAISE EXCEPTION 'STOCK_EMPLACEMENT_INSUFFISANT: quantité insuffisante (rôle %, manque %)', p_role, v_left;
  END IF;
  IF p_recompute THEN PERFORM fn_lot_recompute_zones(p_lot); END IF;
END $$;

-- Mouvement entre deux rôles (ouverture d'un contenant, retour en réserve…), tracé.
CREATE OR REPLACE FUNCTION fn_lot_move_role(p_lot UUID, p_from TEXT, p_to TEXT, p_qty NUMERIC, p_motif TEXT, p_user UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_from UUID; v_to UUID; v_store UUID;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  SELECT store_id INTO v_store FROM ingredient_lots WHERE id = p_lot;
  IF v_store IS NULL THEN
    -- Lot sans établissement (aucun emplacement) : écriture directe des zones, comme avant.
    UPDATE ingredient_lots SET
      economat_quantity = economat_quantity + CASE WHEN p_to <> 'en_cours_ouvert' THEN p_qty ELSE 0 END - CASE WHEN p_from <> 'en_cours_ouvert' THEN p_qty ELSE 0 END,
      pesage_quantity = pesage_quantity + CASE WHEN p_to = 'en_cours_ouvert' THEN p_qty ELSE 0 END - CASE WHEN p_from = 'en_cours_ouvert' THEN p_qty ELSE 0 END
     WHERE id = p_lot;
    RETURN;
  END IF;
  v_from := fn_lot_role_location(p_lot, p_from);
  v_to := fn_lot_role_location(p_lot, p_to);
  PERFORM fn_lot_take(p_lot, p_qty, p_from, false);
  PERFORM fn_lot_location_add(p_lot, v_to, p_qty);
  INSERT INTO stock_location_moves (ingredient_lot_id, from_location_id, to_location_id, quantite, motif, moved_by)
  VALUES (p_lot, v_from, v_to, p_qty, p_motif, p_user);
  PERFORM fn_lot_recompute_zones(p_lot);
END $$;

-- Entrée dans l'emplacement d'un rôle.
CREATE OR REPLACE FUNCTION fn_lot_put(p_lot UUID, p_qty NUMERIC, p_role TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_store UUID;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  SELECT store_id INTO v_store FROM ingredient_lots WHERE id = p_lot;
  IF v_store IS NULL THEN
    UPDATE ingredient_lots SET
      economat_quantity = economat_quantity + CASE WHEN p_role <> 'en_cours_ouvert' THEN p_qty ELSE 0 END,
      pesage_quantity = pesage_quantity + CASE WHEN p_role = 'en_cours_ouvert' THEN p_qty ELSE 0 END
     WHERE id = p_lot;
    RETURN;
  END IF;
  PERFORM fn_lot_location_add(p_lot, fn_lot_role_location(p_lot, p_role), p_qty);
  PERFORM fn_lot_recompute_zones(p_lot);
END $$;

-- Remise à zéro de tous les emplacements d'un lot.
CREATE OR REPLACE FUNCTION fn_lot_clear(p_lot UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_store UUID;
BEGIN
  SELECT store_id INTO v_store FROM ingredient_lots WHERE id = p_lot;
  IF v_store IS NULL THEN
    UPDATE ingredient_lots SET economat_quantity = 0, pesage_quantity = 0 WHERE id = p_lot;
    RETURN;
  END IF;
  UPDATE ingredient_lot_locations SET quantity = 0, updated_at = now() WHERE ingredient_lot_id = p_lot AND quantity <> 0;
  PERFORM fn_lot_recompute_zones(p_lot);
END $$;

-- Reflet des écritures historiques sur les zones : ÉCARTS appliqués aux emplacements.
CREATE OR REPLACE FUNCTION fn_sync_lot_locations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_store UUID := NEW.store_id; v_pes UUID; v_eco UUID;
        d_eco NUMERIC; d_pes NUMERIC; v_left NUMERIC; v_take NUMERIC; r RECORD; v_sum NUMERIC;
BEGIN
  -- Modification venue du recalcul depuis les emplacements : rien à refléter.
  IF current_setting('kalum.lot_zones_from_locations', true) = 'on' THEN RETURN NEW; END IF;
  IF v_store IS NULL THEN RETURN NEW; END IF;
  PERFORM fn_store_default_locations(v_store);
  v_pes := fn_store_location(v_store, 'en_cours_ouvert');
  SELECT COALESCE(
           (SELECT l.id FROM stock_locations l WHERE l.id = NEW.location_id AND l.role <> 'en_cours_ouvert'),
           fn_store_location(v_store, 'reserve')) INTO v_eco;
  IF v_eco IS NULL OR v_pes IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' OR OLD.store_id IS DISTINCT FROM NEW.store_id THEN
    DELETE FROM ingredient_lot_locations WHERE ingredient_lot_id = NEW.id AND location_id NOT IN (v_eco, v_pes);
    INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at)
    VALUES (NEW.id, v_eco, GREATEST(COALESCE(NEW.economat_quantity, 0), 0), NOW()),
           (NEW.id, v_pes, GREATEST(COALESCE(NEW.pesage_quantity, 0), 0), NOW())
    ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
    RETURN NEW;
  END IF;

  -- Rangement changé sans mouvement de quantité : la part « réserve » suit le lot.
  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    SELECT COALESCE(sum(ll.quantity), 0) INTO v_sum FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
     WHERE ll.ingredient_lot_id = NEW.id AND sl.role <> 'en_cours_ouvert';
    UPDATE ingredient_lot_locations ll SET quantity = 0, updated_at = NOW()
      FROM stock_locations sl WHERE sl.id = ll.location_id AND ll.ingredient_lot_id = NEW.id AND sl.role <> 'en_cours_ouvert' AND ll.location_id <> v_eco;
    INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at) VALUES (NEW.id, v_eco, v_sum, NOW())
    ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
  END IF;

  d_pes := COALESCE(NEW.pesage_quantity, 0) - COALESCE(OLD.pesage_quantity, 0);
  d_eco := COALESCE(NEW.economat_quantity, 0) - COALESCE(OLD.economat_quantity, 0);
  IF abs(d_pes) > 0.00005 THEN PERFORM fn_lot_location_add(NEW.id, v_pes, d_pes); END IF;
  IF d_eco > 0.00005 THEN
    PERFORM fn_lot_location_add(NEW.id, v_eco, d_eco);
  ELSIF d_eco < -0.00005 THEN
    v_left := -d_eco;
    FOR r IN
      SELECT ll.location_id, ll.quantity FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
       WHERE ll.ingredient_lot_id = NEW.id AND ll.quantity > 0 AND sl.role <> 'en_cours_ouvert'
       ORDER BY (ll.location_id = v_eco) DESC, ll.quantity DESC
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(r.quantity, v_left);
      UPDATE ingredient_lot_locations SET quantity = quantity - v_take, updated_at = NOW() WHERE ingredient_lot_id = NEW.id AND location_id = r.location_id;
      v_left := v_left - v_take;
    END LOOP;
  END IF;

  -- Filet : si les emplacements ne redonnent pas les zones (écriture incohérente), on repart des zones.
  SELECT COALESCE(sum(ll.quantity), 0) INTO v_sum FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
   WHERE ll.ingredient_lot_id = NEW.id AND sl.role <> 'en_cours_ouvert';
  IF abs(v_sum - GREATEST(COALESCE(NEW.economat_quantity, 0), 0)) > 0.00005 THEN
    DELETE FROM ingredient_lot_locations ll USING stock_locations sl
     WHERE sl.id = ll.location_id AND ll.ingredient_lot_id = NEW.id AND sl.role <> 'en_cours_ouvert' AND ll.location_id <> v_eco;
    INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at)
    VALUES (NEW.id, v_eco, GREATEST(COALESCE(NEW.economat_quantity, 0), 0), NOW())
    ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
  END IF;
  SELECT COALESCE(sum(ll.quantity), 0) INTO v_sum FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
   WHERE ll.ingredient_lot_id = NEW.id AND sl.role = 'en_cours_ouvert';
  IF abs(v_sum - GREATEST(COALESCE(NEW.pesage_quantity, 0), 0)) > 0.00005 THEN
    DELETE FROM ingredient_lot_locations ll USING stock_locations sl
     WHERE sl.id = ll.location_id AND ll.ingredient_lot_id = NEW.id AND sl.role = 'en_cours_ouvert' AND ll.location_id <> v_pes;
    INSERT INTO ingredient_lot_locations (ingredient_lot_id, location_id, quantity, updated_at)
    VALUES (NEW.id, v_pes, GREATEST(COALESCE(NEW.pesage_quantity, 0), 0), NOW())
    ON CONFLICT (ingredient_lot_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
  END IF;

  -- Transfert réserve ↔ en-cours par une écriture historique : mouvement entre emplacements.
  IF abs(d_eco + d_pes) < 0.0001 AND abs(d_pes) > 0.0001 THEN
    INSERT INTO stock_location_moves (ingredient_lot_id, from_location_id, to_location_id, quantite, motif)
    VALUES (NEW.id, CASE WHEN d_pes > 0 THEN v_eco ELSE v_pes END, CASE WHEN d_pes > 0 THEN v_pes ELSE v_eco END,
            abs(d_pes), CASE WHEN d_pes > 0 THEN 'transfert' ELSE 'retour' END);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW v_lot_location_balance AS
SELECT il.id AS ingredient_lot_id, il.quantity_remaining, il.economat_quantity + il.pesage_quantity AS zones_total,
       COALESCE(SUM(ll.quantity), 0) AS locations_total
  FROM ingredient_lots il LEFT JOIN ingredient_lot_locations ll ON ll.ingredient_lot_id = il.id
 GROUP BY il.id;
COMMENT ON VIEW v_lot_location_balance IS 'Étape 8 (mig 643) : Σ emplacements (source) = zones (dérivées) = quantité restante, lot par lot.';
