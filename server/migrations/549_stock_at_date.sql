-- G5-01 (plan d'action 2026-11) — stock matière à une date, contrôle du journal, verrou
-- des périodes de stock clôturées.
--
-- 1. fn_stock_at(date, établissement) : quantité, coût et valeur par article à la fin
--    de la date (heure de Casablanca). Méthode : stock courant MOINS les mouvements
--    journalisés après la date (rejeu à rebours). Le résultat est exact au présent et
--    juste pour toute période dont les mouvements sont journalisés ; un mouvement non
--    journalisé fausse les dates antérieures — d'où le contrôle (2).
--    Coût à la date : le coût unitaire (CMUP) en vigueur ce jour-là, reconstitué depuis
--    le journal des fiches achats (purchasing_master_audit, changements de unit_cost) ;
--    sans changement après la date, le coût actuel.
--    p_store NULL = tous les établissements (une ligne par article).
--
-- 2. fn_stock_journal_gaps(établissement) : articles dont la somme des mouvements ne
--    donne pas le stock courant (mouvements non journalisés, reprises de données).
--
-- 3. Verrou : une fois le jour de clôture passé (stock_closings statut « closed »),
--    aucun mouvement ne peut être daté dans la période close (insertion ou
--    modification de inventory_transactions). Le jour même de la clôture, l'activité
--    continue (la clôture est une photo de fin de journée).
--
-- INVERSION :
--   DROP TRIGGER trg_inventory_tx_period_lock ON inventory_transactions;
--   DROP FUNCTION trg_fn_inventory_tx_period_lock(), fn_stock_journal_gaps(uuid), fn_stock_at(date, uuid);

CREATE OR REPLACE FUNCTION fn_stock_at(p_date date, p_store uuid DEFAULT NULL)
RETURNS TABLE (ingredient_id uuid, ingredient_name text, unit text, quantity numeric, unit_cost numeric, value numeric)
LANGUAGE sql STABLE AS $$
  WITH limit_ts AS (SELECT ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Casablanca') AS ts),
  cur AS (
    SELECT i.ingredient_id, SUM(i.current_quantity) AS qty
      FROM inventory i
     WHERE p_store IS NULL OR i.store_id = p_store
     GROUP BY i.ingredient_id
  ),
  later AS (
    SELECT t.ingredient_id, SUM(t.quantity_change) AS qty
      FROM inventory_transactions t, limit_ts
     WHERE t.created_at >= limit_ts.ts AND (p_store IS NULL OR t.store_id = p_store)
     GROUP BY t.ingredient_id
  ),
  cost_at AS (
    SELECT DISTINCT ON (a.record_id) a.record_id AS ingredient_id, (a.diff -> 'unit_cost' ->> 'old')::numeric AS cost
      FROM purchasing_master_audit a, limit_ts
     WHERE a.table_name = 'ingredients' AND a.diff ? 'unit_cost' AND a.changed_at >= limit_ts.ts
     ORDER BY a.record_id, a.changed_at ASC, a.id ASC
  )
  SELECT g.id, g.name::text, g.unit::text,
         ROUND(COALESCE(cur.qty, 0) - COALESCE(later.qty, 0), 4) AS quantity,
         COALESCE(cost_at.cost, g.unit_cost) AS unit_cost,
         ROUND((COALESCE(cur.qty, 0) - COALESCE(later.qty, 0)) * COALESCE(cost_at.cost, g.unit_cost), 2) AS value
    FROM ingredients g
    LEFT JOIN cur ON cur.ingredient_id = g.id
    LEFT JOIN later ON later.ingredient_id = g.id
    LEFT JOIN cost_at ON cost_at.ingredient_id = g.id
   WHERE cur.ingredient_id IS NOT NULL OR later.ingredient_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION fn_stock_journal_gaps(p_store uuid DEFAULT NULL)
RETURNS TABLE (ingredient_id uuid, ingredient_name text, unit text, store_id uuid, current_quantity numeric, journal_quantity numeric, gap numeric)
LANGUAGE sql STABLE AS $$
  WITH mv AS (
    SELECT t.ingredient_id, t.store_id, SUM(t.quantity_change) AS q FROM inventory_transactions t GROUP BY 1, 2
  )
  SELECT i.ingredient_id, g.name::text, g.unit::text, i.store_id, i.current_quantity,
         COALESCE(mv.q, 0), ROUND(i.current_quantity - COALESCE(mv.q, 0), 4)
    FROM inventory i
    JOIN ingredients g ON g.id = i.ingredient_id
    LEFT JOIN mv ON mv.ingredient_id = i.ingredient_id AND mv.store_id IS NOT DISTINCT FROM i.store_id
   WHERE (p_store IS NULL OR i.store_id = p_store)
     AND ABS(i.current_quantity - COALESCE(mv.q, 0)) > 0.0005;
$$;

CREATE OR REPLACE FUNCTION trg_fn_inventory_tx_period_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_day   date := (NEW.created_at AT TIME ZONE 'Africa/Casablanca')::date;
  v_today date := (now() AT TIME ZONE 'Africa/Casablanca')::date;
  v_close record;
BEGIN
  SELECT c.closing_date, c.period_label INTO v_close
    FROM stock_closings c
   WHERE c.status = 'closed' AND c.closing_date < v_today AND c.closing_date >= v_day
     AND (c.store_id IS NULL OR NEW.store_id IS NULL OR c.store_id = NEW.store_id)
   ORDER BY c.closing_date DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PERIODE_STOCK_CLOSE: mouvement daté du % dans la période de stock clôturée « % » (au %)',
      to_char(v_day, 'DD/MM/YYYY'), v_close.period_label, to_char(v_close.closing_date, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inventory_tx_period_lock ON inventory_transactions;
CREATE TRIGGER trg_inventory_tx_period_lock
  BEFORE INSERT OR UPDATE OF created_at, quantity_change, ingredient_id, store_id ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_fn_inventory_tx_period_lock();
