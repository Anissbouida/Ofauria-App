-- 598 — G0-23 (plan d'action 2026-11) : les rapports de marge lisent le coût unifié.
--
-- Le coût de revient d'un plan n'a qu'une définition (computePlanCost → cout_total,
-- mig 527/584) et qu'une répartition entre ses articles (allocate, clé de la
-- politique production.cost_allocation_key : poids, quantité, valeur de vente,
-- manuelle — M3-05). Mais les rapports et le coût des lots en faisaient chacun une autre :
--   - rapports de marge (coût matière, menu engineering) : cout_matieres au prorata
--     des QUANTITÉS, articles annulés compris ;
--   - coût figé des lots de produits finis (fn_plan_item_unit_cost, mig 452) : cout_total
--     au prorata du coût THÉORIQUE des lignes.
-- Une même pièce avait donc trois coûts selon l'écran.
--
-- 1. production_cout_reel.detail_repartition : la répartition calculée par allocate()
--    est enregistrée avec le coût (part de chaque article, non arrondie).
-- 2. v_plan_item_cost_share : part de chaque article dans le coût de son plan — la
--    répartition enregistrée, sinon (plan chiffré avant cette migration et pas
--    recalculé depuis) l'ancien prorata des quantités, à l'identique : aucun chiffre
--    existant ne bouge tant que le plan n'est pas recalculé.
-- 3. Coût des lots : nouvelle fonction fn_plan_item_unit_cost_v2 (part enregistrée ×
--    cout_total / quantité ; sinon l'ancienne fn_plan_item_unit_cost, inchangée). Les
--    deux déclencheurs sont rebranchés sur de NOUVELLES fonctions (jamais de
--    CREATE OR REPLACE d'une fonction ancienne : propriétaire différent en prod). Le
--    recalcul suit aussi les emballages, la façon et la répartition (oubliés en 452).
--
-- INVERSION :
--   DROP TRIGGER IF EXISTS trg_plan_cost_to_lots_v2 ON production_cout_reel;
--   DROP TRIGGER IF EXISTS trg_lot_cost_fill_v2 ON product_lots;
--   CREATE TRIGGER trg_lot_cost_fill BEFORE INSERT ON product_lots FOR EACH ROW EXECUTE FUNCTION fn_lot_cost_fill();
--   CREATE TRIGGER trg_plan_cost_to_lots AFTER INSERT OR UPDATE OF cout_matieres, cout_main_oeuvre, cout_energie, cout_charges_fixes
--     ON production_cout_reel FOR EACH ROW EXECUTE FUNCTION fn_plan_cost_to_lots();
--   DROP FUNCTION IF EXISTS fn_plan_cost_to_lots_v2(); DROP FUNCTION IF EXISTS fn_lot_cost_fill_v2();
--   DROP FUNCTION IF EXISTS fn_plan_item_unit_cost_v2(uuid, uuid);
--   DROP VIEW IF EXISTS v_plan_item_cost_share;
--   ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS detail_repartition;
--   (les coûts de lots recalculés entre-temps gardent leur valeur ; un recalcul du plan
--    les remet sur l'ancienne règle)

ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS detail_repartition jsonb;
COMMENT ON COLUMN production_cout_reel.detail_repartition IS
  'Répartition du coût du plan entre ses articles, calculée par allocate() (clé production.cost_allocation_key) : {key, applied, fallback, items:[{plan_item_id, quantity, share, cost, unit_cost}]}. share = part non arrondie (0..1). NULL = plan chiffré avant la mig 598. G0-23';

CREATE VIEW v_plan_item_cost_share AS
SELECT ppi.plan_id,
       ppi.id AS plan_item_id,
       ppi.product_id,
       COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric AS quantity,
       CASE WHEN pcr.detail_repartition ? 'items' THEN COALESCE(ra.share, 0)
            ELSE COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric
                 / NULLIF(SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) OVER (PARTITION BY ppi.plan_id), 0)::numeric
       END AS share,
       COALESCE(pcr.detail_repartition ? 'items', false) AS unified
  FROM production_plan_items ppi
  JOIN production_cout_reel pcr ON pcr.plan_id = ppi.plan_id
  LEFT JOIN LATERAL (
    SELECT (e->>'share')::numeric AS share
      FROM jsonb_array_elements(pcr.detail_repartition->'items') e
     WHERE e->>'plan_item_id' = ppi.id::text
     LIMIT 1
  ) ra ON pcr.detail_repartition ? 'items'
 -- Répartition enregistrée : les articles annulés en sont exclus (part nulle, quantité
 -- non comptée). Ancien prorata : tous les articles, comme les rapports le faisaient.
 WHERE NOT (COALESCE(pcr.detail_repartition ? 'items', false) AND ppi.status = 'cancelled');
COMMENT ON VIEW v_plan_item_cost_share IS
  'Part de chaque article dans le coût de revient de son plan : répartition enregistrée par computePlanCost (unified), sinon prorata des quantités (plans chiffrés avant la mig 598). Coût de l''article = share × cout_total (ou × un terme du coût). G0-23';

CREATE FUNCTION fn_plan_item_unit_cost_v2(p_plan_item UUID, p_product UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ROUND(cr.cout_total * s.share / NULLIF(s.quantity, 0), 4)
       FROM v_plan_item_cost_share s
       JOIN production_cout_reel cr ON cr.plan_id = s.plan_id AND cr.cout_total > 0
      WHERE s.plan_item_id = p_plan_item AND s.unified AND s.share > 0),
    fn_plan_item_unit_cost(p_plan_item, p_product))
$$;

CREATE FUNCTION fn_lot_cost_fill_v2() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN NEW.unit_cost := fn_plan_item_unit_cost_v2(NEW.plan_item_id, NEW.product_id); END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION fn_plan_cost_to_lots_v2() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_lots pl SET unit_cost = fn_plan_item_unit_cost_v2(pl.plan_item_id, pl.product_id)
   WHERE pl.production_plan_id = NEW.plan_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_lot_cost_fill ON product_lots;
DROP TRIGGER IF EXISTS trg_lot_cost_fill_v2 ON product_lots;
CREATE TRIGGER trg_lot_cost_fill_v2 BEFORE INSERT ON product_lots
  FOR EACH ROW EXECUTE FUNCTION fn_lot_cost_fill_v2();

DROP TRIGGER IF EXISTS trg_plan_cost_to_lots ON production_cout_reel;
DROP TRIGGER IF EXISTS trg_plan_cost_to_lots_v2 ON production_cout_reel;
CREATE TRIGGER trg_plan_cost_to_lots_v2
  AFTER INSERT OR UPDATE OF cout_matieres, cout_emballages, cout_main_oeuvre, cout_energie, cout_charges_fixes,
                            cout_sous_traitance, detail_repartition
  ON production_cout_reel FOR EACH ROW EXECUTE FUNCTION fn_plan_cost_to_lots_v2();
