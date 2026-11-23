-- ═══════════════════════════════════════════════════════════════════════
-- 657 — Coût propre à chaque article (lot A) et temps standard des gammes (lot B)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Lot A : le coût d'un plan était partagé entre ses articles par une seule clé
--   (poids, quantité…) : baguette et pain de mie d'un même plan sortaient au même
--   coût unitaire (2,46 DH) alors que le pain de mie consomme beurre, lait, sucre.
--   Lot B : sans pointage des étapes, aucune heure de main-d'œuvre ni heure machine
--   n'était connue ; les gammes portent pourtant un temps standard.
--
-- QUOI
--   1. fn_plan_item_std_minutes(ligne) : minutes standard de main-d'œuvre et de machine
--      d'une ligne d'après sa gamme (celle de la ligne, sinon la gamme active du produit) :
--      nb de fournées × (réglage + durée) + quantité ÷ base × temps unitaire ; une
--      opération sur un poste compte en heures machine.
--   2. fn_plan_cost_drivers : heures de main-d'œuvre et heures machine sommées ligne par
--      ligne, temps pointé de la ligne s'il existe, sinon temps standard de sa gamme.
--   3. v_plan_item_cost_share + production_share : part de chaque article dans le coût de
--      PRODUCTION (enregistrée par le calcul analytique ; sinon = share). Les lots de
--      produits finis sont valorisés au coût de production propre de leur article.
--
-- INVERSION
--   Re-créer fn_plan_cost_drivers (mig 655), v_plan_item_cost_share sans production_share
--   et fn_plan_item_unit_cost_v2 (mig 655) ; DROP FUNCTION fn_plan_item_std_minutes(uuid).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_plan_item_std_minutes(p_item uuid)
RETURNS TABLE (labor_min numeric, machine_min numeric)
LANGUAGE sql STABLE AS $$
  WITH it AS (
    SELECT COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric AS qty,
           COALESCE(ppi.routing_id, (SELECT r.id FROM routings r WHERE r.product_id = ppi.product_id AND r.is_active
                                      ORDER BY r.created_at DESC LIMIT 1)) AS routing_id
      FROM production_plan_items ppi WHERE ppi.id = p_item
  ), b AS (
    SELECT it.qty, it.routing_id, CEIL(it.qty / NULLIF(r.batch_size, 0)) AS batches
      FROM it JOIN routings r ON r.id = it.routing_id
  )
  SELECT ROUND(SUM(b.batches * (o.setup_min + o.duration_min) + b.qty / NULLIF(o.base_quantity, 0) * o.labor_min_per_unit), 2),
         ROUND(SUM(CASE WHEN o.work_center_id IS NOT NULL
                        THEN b.batches * (o.setup_min + o.duration_min) + b.qty / NULLIF(o.base_quantity, 0) * o.machine_min_per_unit
                        ELSE b.qty / NULLIF(o.base_quantity, 0) * o.machine_min_per_unit END), 2)
    FROM b JOIN routing_operations o ON o.routing_id = b.routing_id
   HAVING COUNT(*) > 0
$$;
COMMENT ON FUNCTION fn_plan_item_std_minutes(uuid) IS
  'Mig 657 : minutes standard (main-d''œuvre, machine) d''une ligne de plan d''après sa gamme. Aucune ligne si le produit n''a pas de gamme.';

CREATE OR REPLACE FUNCTION fn_plan_cost_drivers(p_store uuid, p_from date, p_to date, p_plan uuid DEFAULT NULL)
RETURNS TABLE (plan_id uuid, plan_date date, units numeric, weight_kg numeric, labour_hours numeric,
               machine_hours numeric, batches numeric, material_cost numeric, sales_value numeric)
LANGUAGE sql STABLE AS $$
  WITH plans AS (
    SELECT pp.id, pp.plan_date::date AS plan_date
      FROM production_plans pp
     WHERE (p_plan IS NOT NULL AND pp.id = p_plan)
        OR (p_plan IS NULL AND pp.store_id IS NOT DISTINCT FROM p_store AND pp.plan_date >= p_from AND pp.plan_date < p_to
            AND pp.status IN ('in_progress', 'completed'))
  ),
  lines AS (
    SELECT ppi.id, ppi.plan_id, ppi.product_id, ppi.format_id, ppi.alt_recipe_id,
           COALESCE(ppi.actual_quantity, ppi.planned_quantity) AS qty
      FROM production_plan_items ppi JOIN plans ON plans.id = ppi.plan_id
     WHERE ppi.status <> 'cancelled'
  ),
  timed AS (
    SELECT pie.plan_item_id,
           SUM(pie.duree_reelle_min) / 60.0 AS labour_h,
           SUM(pie.duree_reelle_min) FILTER (WHERE pie.work_center_id IS NOT NULL) / 60.0 AS machine_h
      FROM production_item_etapes pie JOIN lines l ON l.id = pie.plan_item_id
     WHERE pie.status = 'completed' AND pie.duree_reelle_min > 0
     GROUP BY pie.plan_item_id
  ),
  hours AS (
    SELECT l.plan_id,
           SUM(COALESCE(NULLIF(t.labour_h, 0), s.labor_min / 60.0, 0)) AS labour_h,
           SUM(COALESCE(NULLIF(t.machine_h, 0), s.machine_min / 60.0, 0)) AS machine_h
      FROM lines l
      LEFT JOIN timed t ON t.plan_item_id = l.id
      LEFT JOIN LATERAL fn_plan_item_std_minutes(l.id) s ON true
     GROUP BY l.plan_id
  ),
  items AS (
    SELECT l.plan_id,
           SUM(l.qty) AS units,
           SUM(l.qty * COALESCE(rf.poids_cuit_g / 1000.0, r.piece_weight_kg, 0)) AS weight_kg,
           COUNT(*) AS batches,
           SUM(l.qty * COALESCE(p.price, 0)
               / CASE WHEN p.price_includes_tax THEN 1 + COALESCE(tc.rate, 0) / 100 ELSE 1 END) AS sales_value
      FROM lines l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN recipe_formats rf ON rf.id = l.format_id
      LEFT JOIN recipes r ON r.id = COALESCE(l.alt_recipe_id,
             (SELECT r2.id FROM recipes r2 WHERE r2.product_id = l.product_id AND r2.archived_at IS NULL LIMIT 1))
      LEFT JOIN LATERAL (SELECT t.rate FROM tax_codes t WHERE t.code = p.tax_code AND t.valid_from <= CURRENT_DATE
                          ORDER BY t.valid_from DESC LIMIT 1) tc ON true
     GROUP BY l.plan_id
  ),
  lots AS (
    SELECT plu.production_plan_id AS plan_id, plu.ingredient_id,
           SUM(plu.quantity_used * COALESCE(plu.unit_cost_at_use, il.unit_cost, 0)) AS total
      FROM production_lot_usage plu
      JOIN plans ON plans.id = plu.production_plan_id
      JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
     GROUP BY plu.production_plan_id, plu.ingredient_id
  ),
  fallback AS (
    SELECT it.production_plan_id AS plan_id, SUM(ABS(it.quantity_change) * COALESCE(i.unit_cost, 0)) AS total
      FROM inventory_transactions it
      JOIN plans ON plans.id = it.production_plan_id
      JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.type = 'production'
       AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.plan_id = it.production_plan_id AND l.ingredient_id = it.ingredient_id)
     GROUP BY it.production_plan_id
  ),
  mat AS (
    SELECT plan_id, SUM(total) AS total FROM (
      SELECT plan_id, total FROM lots UNION ALL SELECT plan_id, total FROM fallback) x
     GROUP BY plan_id
  )
  SELECT plans.id, plans.plan_date,
         COALESCE(items.units, 0), COALESCE(items.weight_kg, 0), ROUND(COALESCE(hours.labour_h, 0), 4),
         ROUND(COALESCE(hours.machine_h, 0), 4), COALESCE(items.batches, 0),
         ROUND(COALESCE(mat.total, 0), 2), ROUND(COALESCE(items.sales_value, 0), 2)
    FROM plans
    LEFT JOIN items ON items.plan_id = plans.id
    LEFT JOIN hours ON hours.plan_id = plans.id
    LEFT JOIN mat ON mat.plan_id = plans.id
$$;
COMMENT ON FUNCTION fn_plan_cost_drivers(uuid, date, date, uuid) IS
  'Mig 655/657 : unités d''œuvre par plan — units, weight_kg, labour_hours et machine_hours (temps pointé de chaque ligne, sinon temps standard de sa gamme), batches (lignes), material_cost (lots consommés), sales_value (quantité × prix HT).';

-- Part de chaque article dans le coût de PRODUCTION (valorisation des lots).
CREATE OR REPLACE VIEW v_plan_item_cost_share AS
SELECT ppi.plan_id,
       ppi.id AS plan_item_id,
       ppi.product_id,
       COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric AS quantity,
       CASE WHEN pcr.detail_repartition ? 'items' THEN COALESCE(ra.share, 0)
            ELSE COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric
                 / NULLIF(SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) OVER (PARTITION BY ppi.plan_id), 0)::numeric
       END AS share,
       COALESCE(pcr.detail_repartition ? 'items', false) AS unified,
       CASE WHEN pcr.detail_repartition ? 'items' THEN COALESCE(ra.production_share, ra.share, 0)
            ELSE COALESCE(ppi.actual_quantity, ppi.planned_quantity)::numeric
                 / NULLIF(SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) OVER (PARTITION BY ppi.plan_id), 0)::numeric
       END AS production_share
  FROM production_plan_items ppi
  JOIN production_cout_reel pcr ON pcr.plan_id = ppi.plan_id
  LEFT JOIN LATERAL (
    SELECT (e->>'share')::numeric AS share, (e->>'production_share')::numeric AS production_share
      FROM jsonb_array_elements(pcr.detail_repartition->'items') e
     WHERE e->>'plan_item_id' = ppi.id::text
     LIMIT 1
  ) ra ON pcr.detail_repartition ? 'items'
 WHERE NOT (COALESCE(pcr.detail_repartition ? 'items', false) AND ppi.status = 'cancelled');
COMMENT ON VIEW v_plan_item_cost_share IS
  'Part de chaque article dans le coût de son plan : share (coût de revient, cout_total) et production_share (coût de production, cout_production — valeur des lots ; mig 657, calcul analytique par article). G0-23';

CREATE OR REPLACE FUNCTION fn_plan_item_unit_cost_v2(p_plan_item UUID, p_product UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ROUND(cr.cout_production * s.production_share / NULLIF(s.quantity, 0), 4)
       FROM v_plan_item_cost_share s
       JOIN production_cout_reel cr ON cr.plan_id = s.plan_id AND cr.cout_production > 0
      WHERE s.plan_item_id = p_plan_item AND s.unified AND s.production_share > 0),
    fn_plan_item_unit_cost(p_plan_item, p_product))
$$;
